// Generación automática de CFDI (factura real) vía Facturapi cuando se
// confirma un pago. Usa el mismo formato que la importación manual de CFDI
// (ver app/facturas-admin/importar) para que el resto de la app (estado de
// cuenta, reportes) no necesite cambios. Nunca truena: si algo falla, el
// pago sigue su curso y se deja un aviso para facturar a mano.

import Facturapi from "facturapi";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarDatosFiscales, esPublicoGeneral } from "@/lib/datosFiscales";
import type { CfdiConcepto, CfdiImpuesto } from "@/lib/cfdi";

type Admin = ReturnType<typeof createAdminClient>;

const facturapi = new Facturapi(process.env.FACTURAPI_API_KEY || "");

// SAT c_ClaveProdServ / c_ClaveUnidad para renta de espacio de oficina/coworking.
const CLAVE_PROD_SERV = "80131500";
const CLAVE_UNIDAD = "E48";

// Openpay no distingue crédito/débito en `method`, solo "card" o "bank_account".
// "cash" lo usa el marcado manual de staff sin comprobante (pago en efectivo).
export function formaPagoDesdeMetodoOpenpay(metodo?: string | null): string {
  if (metodo === "bank_account") return "03";
  if (metodo === "cash") return "01";
  return "04";
}

async function bufferDeDescarga(descarga: any): Promise<Buffer> {
  if (descarga && typeof descarga.arrayBuffer === "function") {
    return Buffer.from(await descarga.arrayBuffer());
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const partes: Buffer[] = [];
    descarga.on("data", (parte: any) => partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte)));
    descarga.on("end", () => resolve(Buffer.concat(partes)));
    descarga.on("error", reject);
  });
}

async function subirArchivoFactura(admin: Admin, nombreBase: string, buffer: Buffer, ext: "xml" | "pdf") {
  const fileName = `facturapi-${nombreBase}-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("facturas")
    .upload(fileName, buffer, { contentType: ext === "xml" ? "text/xml" : "application/pdf", upsert: true });
  if (error) return null;
  const { data } = admin.storage.from("facturas").getPublicUrl(fileName);
  return data.publicUrl;
}

async function avisarFacturaFallida(admin: Admin, pagoId: string, centro: string | null, motivo: string) {
  if (!centro) return;
  await admin.from("notificaciones").insert({
    centro,
    tipo: "factura_automatica_fallida",
    mensaje: `No se pudo generar la factura automática del pago ${pagoId}: ${motivo}. Factúralo a mano desde Facturas › Importar CFDI.`,
  });
}

export async function generarFacturaAutomatica(admin: Admin, pagoId: string, metodoOpenpay?: string | null): Promise<void> {
  const { data: pago } = await admin
    .from("pagos")
    .select("id, user_id, monto, concepto, factura_id")
    .eq("id", pagoId)
    .maybeSingle();
  if (!pago) return;

  const { data: cliente } = await admin
    .from("profiles")
    .select("nombre, email, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi, centro")
    .eq("id", pago.user_id)
    .maybeSingle();

  try {
    let facturaExistente: { id: string; uuid_cfdi: string | null } | null = null;
    if (pago.factura_id) {
      const { data } = await admin.from("facturas").select("id, uuid_cfdi").eq("id", pago.factura_id).maybeSingle();
      facturaExistente = data;
      if (facturaExistente?.uuid_cfdi) return; // ya facturado, evita duplicar (webhook + verificación pueden coincidir)
    }

    if (!cliente?.rfc || !cliente.nombre_fiscal || !cliente.regimen_fiscal || !cliente.cp_fiscal) {
      await avisarFacturaFallida(admin, pago.id, cliente?.centro || null, "el cliente no tiene datos fiscales completos");
      return;
    }

    const datos = normalizarDatosFiscales({
      rfc: cliente.rfc,
      nombre_fiscal: cliente.nombre_fiscal,
      regimen_fiscal: cliente.regimen_fiscal,
      cp_fiscal: cliente.cp_fiscal,
      uso_cfdi: cliente.uso_cfdi || "G03",
    });

    const hoy = new Date();
    const publicoGeneral = esPublicoGeneral(datos.rfc);

    const invoice: any = await facturapi.invoices.create({
      customer: {
        legal_name: datos.nombre_fiscal,
        tax_id: datos.rfc,
        tax_system: datos.regimen_fiscal,
        email: cliente.email || undefined,
        address: { zip: datos.cp_fiscal },
      },
      items: [
        {
          quantity: 1,
          product: {
            description: pago.concepto || "Servicios Nodus Flex Center",
            product_key: CLAVE_PROD_SERV,
            unit_key: CLAVE_UNIDAD,
            price: Number(pago.monto),
            tax_included: true,
            taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa" }],
          },
        },
      ],
      payment_form: formaPagoDesdeMetodoOpenpay(metodoOpenpay),
      payment_method: "PUE",
      use: datos.uso_cfdi,
      // El SAT exige el nodo "Información Global" cuando el receptor es
      // público en general (XAXX010101000): se factura como resumen diario.
      ...(publicoGeneral
        ? { global: { periodicity: "day", months: String(hoy.getMonth() + 1).padStart(2, "0"), year: hoy.getFullYear() } }
        : {}),
    });

    const [xmlBuf, pdfBuf] = await Promise.all([
      facturapi.invoices
        .downloadXml(invoice.id)
        .then(bufferDeDescarga)
        .catch(() => null),
      facturapi.invoices
        .downloadPdf(invoice.id)
        .then(bufferDeDescarga)
        .catch(() => null),
    ]);
    const base = String(invoice.uuid || invoice.id).slice(0, 8);
    const [xmlUrl, archivoUrl] = await Promise.all([
      xmlBuf ? subirArchivoFactura(admin, base, xmlBuf, "xml") : Promise.resolve(null),
      pdfBuf ? subirArchivoFactura(admin, base, pdfBuf, "pdf") : Promise.resolve(null),
    ]);

    const item = invoice.items?.[0];
    const importeConcepto = item?.product?.price ? item.product.price * (item.quantity || 1) : Number(pago.monto);
    const conceptos: CfdiConcepto[] = [
      {
        descripcion: item?.product?.description || pago.concepto || "",
        cantidad: item?.quantity || 1,
        valorUnitario: item?.product?.price || Number(pago.monto),
        importe: importeConcepto,
      },
    ];
    // Facturapi no regresa el importe ya calculado por impuesto (solo la tasa),
    // así que se calcula a partir del precio con IVA incluido.
    const impuestosItem = item?.product?.taxes || [];
    const tasaIva = impuestosItem.find((t: any) => t.type === "IVA" && !t.withholding)?.rate ?? 0.16;
    const subtotalCalc = Math.round((importeConcepto / (1 + tasaIva)) * 100) / 100;
    const ivaTotal = Math.round((importeConcepto - subtotalCalc) * 100) / 100;
    const impuestos: CfdiImpuesto[] = impuestosItem.map((t: any) => ({
      tipo: t.withholding ? "retencion" : "traslado",
      impuesto: t.type,
      tasaOCuota: String(t.rate),
      importe: t.withholding ? 0 : ivaTotal,
    }));

    const datosFactura = {
      uuid_cfdi: invoice.uuid,
      serie: invoice.series || null,
      folio_fiscal: String(invoice.folio_number ?? ""),
      rfc_emisor: invoice.issuer_info?.tax_id || null,
      nombre_emisor: invoice.issuer_info?.legal_name || null,
      rfc_receptor: datos.rfc,
      nombre_receptor: datos.nombre_fiscal,
      subtotal: subtotalCalc,
      iva: ivaTotal,
      retenciones: 0,
      moneda: invoice.currency || "MXN",
      tipo_comprobante: invoice.type || "I",
      forma_pago: invoice.payment_form,
      metodo_pago: invoice.payment_method,
      uso_cfdi: invoice.use,
      conceptos,
      impuestos,
      xml_url: xmlUrl,
      archivo_url: archivoUrl,
      fuente: "facturapi_auto",
    };

    if (facturaExistente) {
      await admin.from("facturas").update(datosFactura).eq("id", facturaExistente.id);
    } else {
      const hoyISO = new Date().toISOString().split("T")[0];
      const { data: nuevaFactura } = await admin
        .from("facturas")
        .insert({
          user_id: pago.user_id,
          folio: `${invoice.series || "F"}${invoice.folio_number ?? ""}`,
          concepto: pago.concepto || "Pago Nodus",
          monto: pago.monto,
          fecha_emision: hoyISO,
          fecha_vencimiento: hoyISO,
          estado: "pagada",
          centro: cliente.centro || null,
          ...datosFactura,
        })
        .select("id")
        .single();
      if (nuevaFactura?.id) {
        await admin.from("pagos").update({ factura_id: nuevaFactura.id }).eq("id", pago.id);
      }
    }
  } catch (err: any) {
    console.error(`[facturapi] pago ${pagoId}:`, err?.message || err);
    await avisarFacturaFallida(admin, pago.id, cliente?.centro || null, err?.message || "error desconocido");
  }
}
