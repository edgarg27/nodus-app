// Generación de CFDI (factura real) vía Facturapi. Hay dos caminos:
//   - Automático al confirmarse un pago (generarFacturaAutomatica): PUE, la
//     factura nace ya pagada.
//   - Desde un cobro pendiente (lib/facturarCobro.ts): PPD, la factura se emite
//     antes del pago y después se cubre con un complemento de pago.
// Ambos usan timbrarCfdi() y guardan el resultado con el mismo formato que la
// importación manual de CFDI (ver app/facturas-admin/importar) para que el
// resto de la app (estado de cuenta, reportes) no necesite cambios. Nunca
// truena el pago: si algo falla, el pago sigue su curso y se deja un aviso.

import Facturapi from "facturapi";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarDatosFiscales, esPublicoGeneral, usosParaTipo } from "@/lib/datosFiscales";
import type { CfdiConcepto, CfdiImpuesto } from "@/lib/cfdi";
import { tipoCobroAdicional } from "@/lib/adicionales";

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

// El SDK de Facturapi expone downloadXml/downloadPdf como stream, pero bajo el
// empaquetado de Next.js (webpack) ese stream llega ya consumido ("Body is
// unusable: Body has already been read"). Se evita el problema por completo
// pidiendo una URL firmada y descargándola nosotros mismos con fetch normal.
async function bufferDesdeUrlFirmada(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga falló con estado ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
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

export type DatosFiscalesCliente = {
  email?: string | null;
  rfc?: string | null;
  nombre_fiscal?: string | null;
  regimen_fiscal?: string | null;
  cp_fiscal?: string | null;
  uso_cfdi?: string | null;
};

export type ParametrosCfdi = {
  cliente: DatosFiscalesCliente;
  concepto: string | null;
  monto: number;
  adicionalTipo?: string | null;
  // PUE: se paga en el momento (factura ya pagada). PPD: pago diferido, se emite
  // antes del pago y se cubre después con un complemento de pago.
  metodo: "PUE" | "PPD";
  formaPago: string;
  // Para los registros de error.
  etiqueta: string;
  // Facturapi no emite dos veces con la misma llave: evita facturas dobles si dos
  // personas (o dos clics) piden lo mismo a la vez.
  idempotencyKey?: string;
};

// Error con mensaje pensado para mostrarse tal cual al personal.
export class ErrorFacturacion extends Error {}

// Emite el CFDI en Facturapi, guarda XML/PDF y devuelve los datos listos para
// la tabla `facturas`. No toca la base de datos de facturas ni de pagos.
export async function timbrarCfdi(admin: Admin, p: ParametrosCfdi) {
  const { cliente } = p;
  if (!cliente.rfc || !cliente.nombre_fiscal || !cliente.regimen_fiscal || !cliente.cp_fiscal) {
    throw new ErrorFacturacion("el cliente no tiene datos fiscales completos");
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
  if (publicoGeneral && p.metodo === "PPD") {
    throw new ErrorFacturacion("a público en general solo se le factura al cobrar (no admite pago diferido)");
  }
  // Un uso que ya no existe en CFDI 4.0 (p. ej. "P01") o que no aplica al tipo de persona haría
  // que el SAT rechace la factura: se cae a G03 en vez de dejar al cliente sin factura.
  const usoCfdi = usosParaTipo(datos.rfc.length === 12 ? "moral" : "fisica").some((u) => u.clave === datos.uso_cfdi) ? datos.uso_cfdi : "G03";
  // Los cobros adicionales (copias, frituras…) llevan su propia clave del SAT.
  const claveSat = tipoCobroAdicional(p.adicionalTipo);
  const prodServ = claveSat?.satProdServ || CLAVE_PROD_SERV;
  const unidad = claveSat?.satUnidad || CLAVE_UNIDAD;

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
          description: p.concepto || "Servicios Nodus Flex Center",
          product_key: prodServ,
          unit_key: unidad,
          price: Number(p.monto),
          tax_included: true,
          taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa" }],
        },
      },
    ],
    payment_form: p.formaPago,
    payment_method: p.metodo,
    use: usoCfdi,
    ...(p.idempotencyKey ? { idempotency_key: p.idempotencyKey } : {}),
    // El SAT exige el nodo "Información Global" cuando el receptor es
    // público en general (XAXX010101000): se factura como resumen diario.
    ...(publicoGeneral
      ? { global: { periodicity: "day", months: String(hoy.getMonth() + 1).padStart(2, "0"), year: hoy.getFullYear() } }
      : {}),
  });

  const [xmlBuf, pdfBuf] = await Promise.all([
    facturapi.invoices
      .downloadXmlUrl(invoice.id)
      .then((firmada: any) => bufferDesdeUrlFirmada(firmada.url))
      .catch((err: any) => {
        console.error(`[facturapi] ${p.etiqueta}: no se pudo descargar el XML:`, err?.message || err);
        return null;
      }),
    facturapi.invoices
      .downloadPdfUrl(invoice.id)
      .then((firmada: any) => bufferDesdeUrlFirmada(firmada.url))
      .catch((err: any) => {
        console.error(`[facturapi] ${p.etiqueta}: no se pudo descargar el PDF:`, err?.message || err);
        return null;
      }),
  ]);
  const base = String(invoice.uuid || invoice.id).slice(0, 8);
  const [xmlUrl, archivoUrl] = await Promise.all([
    xmlBuf ? subirArchivoFactura(admin, base, xmlBuf, "xml") : Promise.resolve(null),
    pdfBuf ? subirArchivoFactura(admin, base, pdfBuf, "pdf") : Promise.resolve(null),
  ]);

  const item = invoice.items?.[0];
  const importeConcepto = item?.product?.price ? item.product.price * (item.quantity || 1) : Number(p.monto);
  const conceptos: CfdiConcepto[] = [
    {
      descripcion: item?.product?.description || p.concepto || "",
      cantidad: item?.quantity || 1,
      valorUnitario: item?.product?.price || Number(p.monto),
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
    facturapi_id: invoice.id,
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

  return { invoice, datosFactura };
}

export async function generarFacturaAutomatica(admin: Admin, pagoId: string, metodoOpenpay?: string | null): Promise<void> {
  const { data: pago } = await admin
    .from("pagos")
    .select("id, user_id, monto, concepto, factura_id, adicional_tipo")
    .eq("id", pagoId)
    .maybeSingle();
  if (!pago) return;

  const { data: cliente } = await admin
    .from("profiles")
    .select("nombre, email, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi, centro")
    .eq("id", pago.user_id)
    .maybeSingle();

  try {
    let facturaExistente: { id: string; uuid_cfdi: string | null; metodo_pago: string | null; folio: string | null } | null = null;
    if (pago.factura_id) {
      const { data } = await admin.from("facturas").select("id, uuid_cfdi, metodo_pago, folio").eq("id", pago.factura_id).maybeSingle();
      facturaExistente = data;
      if (facturaExistente?.uuid_cfdi) {
        // Ya facturado (webhook + verificación pueden coincidir): no se duplica. Si la factura
        // se emitió a pago diferido (PPD), este pago todavía necesita su complemento de pago.
        if (facturaExistente.metodo_pago === "PPD" && cliente?.centro) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            tipo: "complemento_pago_pendiente",
            mensaje: `El cliente ${cliente.nombre || ""} pagó la factura ${facturaExistente.folio || ""} (pago diferido): falta emitir su complemento de pago.`,
          });
        }
        return;
      }
    }

    if (!cliente?.rfc || !cliente.nombre_fiscal || !cliente.regimen_fiscal || !cliente.cp_fiscal) {
      await avisarFacturaFallida(admin, pago.id, cliente?.centro || null, "el cliente no tiene datos fiscales completos");
      return;
    }

    const { invoice, datosFactura } = await timbrarCfdi(admin, {
      cliente,
      concepto: pago.concepto,
      monto: Number(pago.monto),
      adicionalTipo: pago.adicional_tipo,
      metodo: "PUE",
      formaPago: formaPagoDesdeMetodoOpenpay(metodoOpenpay),
      etiqueta: `pago ${pagoId}`,
    });

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
