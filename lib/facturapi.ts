// Generación de CFDI (factura real) vía Facturapi. Como en ZORA, la factura la hace finanzas: integra los cobros
// del cliente en un estado de cuenta y lo timbra (lib/facturarCobro.ts): PUE si ya se pagó, PPD si se paga después.
// Lo único automático es el complemento de pago de una factura PPD cuando el cliente paga (complementoAlPagar).
// Todo usa timbrarCfdi() y guarda el resultado con el mismo formato que la
// importación manual de CFDI (ver app/facturas-admin/importar) para que el
// resto de la app (estado de cuenta, reportes) no necesite cambios. Nunca
// truena el pago: si algo falla, el pago sigue su curso y se deja un aviso.

import Facturapi from "facturapi";
import { esFacturaSimulada } from "@/lib/facturaSimulada";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarDatosFiscales, esPublicoGeneral, usosParaTipo } from "@/lib/datosFiscales";
import type { CfdiConcepto, CfdiImpuesto } from "@/lib/cfdi";
import { servicioPorClave } from "@/lib/catalogoServicios";
import { serieCentro } from "@/lib/centros";
import { esClienteCoworking } from "@/lib/coworking";

type Admin = ReturnType<typeof createAdminClient>;

const facturapi = new Facturapi(process.env.FACTURAPI_API_KEY || "");
export const clienteFacturapi = facturapi;

// SAT c_ClaveProdServ / c_ClaveUnidad por omisión: arrendamiento de oficina privada (cuando el cobro
// no trae un tipo de servicio; la renta de un cliente de Coworking usa la de Coworking, ver tipoPorOmision).
const CLAVE_PROD_SERV = "80131502";
const CLAVE_UNIDAD = "E48";

// Código postal del domicilio del emisor en Facturapi: es el "lugar de expedición" y, en CFDI 4.0,
// el código postal que debe llevar el receptor "público en general".
let cpExpedicion: string | null = null;
export async function cpLugarExpedicion(): Promise<string> {
  if (cpExpedicion) return cpExpedicion;
  const org: any = await facturapi.organizations.me();
  const zip = org?.legal?.address?.zip;
  if (!zip) throw new ErrorFacturacion("No se pudo leer el código postal del emisor en Facturapi");
  cpExpedicion = String(zip);
  return cpExpedicion;
}

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
export async function bufferDesdeUrlFirmada(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga falló con estado ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function subirArchivoFactura(admin: Admin, nombreBase: string, buffer: Buffer, ext: "xml" | "pdf") {
  const fileName = `facturapi-${nombreBase}-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("facturas")
    .upload(fileName, buffer, { contentType: ext === "xml" ? "text/xml" : "application/pdf", upsert: true });
  if (error) return null;
  const { data } = admin.storage.from("facturas").getPublicUrl(fileName);
  return data.publicUrl;
}

// Tipo de servicio con el que se timbra un cobro: el que trae, o, si no trae (la renta mensual),
// el del espacio del cliente: Coworking si tiene un contrato vigente de Coworking; si no, oficina privada.
export async function tipoPorOmision(admin: Admin, userId: string | null | undefined, tipo: string | null | undefined): Promise<string | null> {
  if (tipo) return tipo;
  if (!userId) return null;
  try {
    return (await esClienteCoworking(admin as any, userId)) ? "coworking" : null;
  } catch {
    return null;
  }
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
  // Varios conceptos en una sola factura (p. ej. dos adicionales distintos): una línea por concepto, cada una con
  // la clave del SAT de su servicio. Si no se manda, es una sola línea con `concepto`, `monto` y `adicionalTipo`.
  lineas?: { concepto: string; monto: number; adicionalTipo?: string | null }[];
  // PUE: se paga en el momento (factura ya pagada). PPD: pago diferido, se emite
  // antes del pago y se cubre después con un complemento de pago.
  metodo: "PUE" | "PPD";
  formaPago: string;
  // Condiciones de pago que se imprimen en la factura (p. ej. "Contado").
  condiciones?: string;
  // CFDI relacionados (tipo de relación del SAT y los UUID de las facturas relacionadas).
  relacion?: { tipo: string; uuids: string[] };
  // Periodicidad de la información global (solo público en general): day, week, fortnight, month o two_months.
  periodicidad?: string;
  // Número de cuenta con el que se pagó (transferencia): se imprime en el PDF de la factura.
  cuentaPago?: string;
  // Para los registros de error.
  etiqueta: string;
  // Facturapi no emite dos veces con la misma llave: evita facturas dobles si dos
  // personas (o dos clics) piden lo mismo a la vez.
  idempotencyKey?: string;
  // Serie de la factura (cada centro tiene la suya, ver lib/centros.ts); el folio cuenta por serie.
  serie?: string | null;
};

// Error con mensaje pensado para mostrarse tal cual al personal.
export class ErrorFacturacion extends Error {}

// Valida y arma lo que se manda a Facturapi. Lo usan el timbrado y la vista previa en PDF, para que la previa sea
// exactamente la factura que se emitiría.
async function prepararFactura(admin: Admin, p: ParametrosCfdi) {
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
  const lineas = p.lineas && p.lineas.length > 0 ? p.lineas : [{ concepto: p.concepto || "", monto: Number(p.monto), adicionalTipo: p.adicionalTipo }];
  const itemsNuevos = [];
  for (const l of lineas) {
    const claveSat = await servicioPorClave(admin, l.adicionalTipo);
    itemsNuevos.push({
      quantity: 1,
      product: {
        description: l.concepto || "Servicios Nodus Flex Center",
        product_key: claveSat?.satProdServ || CLAVE_PROD_SERV,
        unit_key: claveSat?.satUnidad || CLAVE_UNIDAD,
        price: Number(l.monto),
        tax_included: true,
        taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa" }],
      },
    });
  }

  const cuerpo = {
    customer: {
      legal_name: datos.nombre_fiscal,
      tax_id: datos.rfc,
      tax_system: datos.regimen_fiscal,
      email: cliente.email || undefined,
      address: { zip: datos.cp_fiscal },
    },
    items: itemsNuevos,
    payment_form: p.formaPago,
    payment_method: p.metodo,
    use: usoCfdi,
    ...(p.serie ? { series: p.serie } : {}),
    ...(p.condiciones ? { conditions: p.condiciones } : {}),
    ...(p.relacion && p.relacion.uuids.length > 0 ? { related_documents: [{ relationship: p.relacion.tipo, documents: p.relacion.uuids }] } : {}),
    ...(p.cuentaPago ? { pdf_custom_section: `No. cuenta de pago: ${p.cuentaPago.replace(/[<>&]/g, "")}` } : {}),
    // El SAT exige el nodo "Información Global" cuando el receptor es
    // público en general (XAXX010101000): se factura como resumen diario.
    ...(publicoGeneral
      ? { global: { periodicity: p.periodicidad || "day", months: p.periodicidad === "two_months" ? String(12 + Math.ceil((hoy.getMonth() + 1) / 2)) : String(hoy.getMonth() + 1).padStart(2, "0"), year: hoy.getFullYear() } }
      : {}),
  };
  return { cuerpo, datos, hoy, publicoGeneral, usoCfdi, lineas, cliente };
}

// Vista previa en PDF de la factura (la misma que se emitiría, con la marca de que no es válida): Facturapi la
// genera con su plantilla, sin timbrar nada ni gastar un folio.
export async function previaPdfCfdi(admin: Admin, p: ParametrosCfdi): Promise<Buffer> {
  const { cuerpo } = await prepararFactura(admin, p);
  // Como las descargas del timbrado: Facturapi da una dirección firmada y de ahí se baja el PDF.
  const firmada: any = await (facturapi.invoices as any).previewPdfUrl(cuerpo);
  return bufferDesdeUrlFirmada(firmada.url);
}

// Emite el CFDI en Facturapi, guarda XML/PDF y devuelve los datos listos para
// la tabla `facturas`. No toca la base de datos de facturas ni de pagos.
export async function timbrarCfdi(admin: Admin, p: ParametrosCfdi) {
  const { cuerpo, datos, hoy, publicoGeneral, usoCfdi, lineas, cliente } = await prepararFactura(admin, p);
  const invoice: any = await facturapi.invoices.create({ ...cuerpo, ...(p.idempotencyKey ? { idempotency_key: p.idempotencyKey } : {}) });

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

  const itemsEmitidos: any[] = invoice.items && invoice.items.length > 0 ? invoice.items : [null];
  const conceptos: CfdiConcepto[] = itemsEmitidos.map((it: any, i: number) => {
    const precio = it?.product?.price ?? Number(lineas[i]?.monto ?? p.monto);
    const cantidad = it?.quantity || 1;
    return { descripcion: it?.product?.description || lineas[i]?.concepto || "", cantidad, valorUnitario: precio, importe: precio * cantidad };
  });
  const importeConcepto = Math.round(conceptos.reduce((s, c) => s + c.importe, 0) * 100) / 100;
  // Facturapi no regresa el importe ya calculado por impuesto (solo la tasa), así que se calcula a
  // partir del precio con IVA incluido, línea por línea (como el CFDI).
  const impuestosItem = itemsEmitidos[0]?.product?.taxes || [];
  const tasaIva = impuestosItem.find((t: any) => t.type === "IVA" && !t.withholding)?.rate ?? 0.16;
  const subtotalCalc = Math.round(conceptos.reduce((s, c) => s + Math.round((c.importe / (1 + tasaIva)) * 100) / 100, 0) * 100) / 100;
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

// Al confirmarse un pago (tarjeta, SPEI, comprobante o efectivo). La factura NO se timbra sola: como en ZORA,
// finanzas integra los cobros y factura (PUE si ya se pagó, PPD si no). Lo único automático es el complemento de pago:
// si el cobro ya se facturó a pago diferido (PPD), este pago se cubre con su complemento.
export async function complementoAlPagar(admin: Admin, pagoId: string, metodoOpenpay?: string | null): Promise<void> {
  const { data: pago } = await admin.from("pagos").select("id, user_id, monto, factura_id").eq("id", pagoId).maybeSingle();
  if (!pago?.factura_id) return;
  const { data: factura } = await admin.from("facturas").select("id, uuid_cfdi, metodo_pago, folio").eq("id", pago.factura_id).maybeSingle();
  // Sin CFDI todavía: finanzas la factura después. Una factura simulada (cliente de prueba) no existe en Facturapi.
  if (!factura?.uuid_cfdi || factura.metodo_pago !== "PPD" || esFacturaSimulada(factura.uuid_cfdi)) return;
  try {
    const { emitirComplementoPago } = await import("@/lib/complementoPago");
    const { hoyMexicoISO } = await import("@/lib/fechaMexico");
    const r = await emitirComplementoPago(admin, {
      userId: pago.user_id,
      items: [{ facturaId: factura.id, importe: Number(pago.monto) }],
      topeSaldo: true,
      formaPago: formaPagoDesdeMetodoOpenpay(metodoOpenpay),
      fecha: hoyMexicoISO(),
      usuarioId: null,
      pagoId: pago.id,
    });
    if (!r.ok) {
      const { data: cliente } = await admin.from("profiles").select("nombre, centro").eq("id", pago.user_id).maybeSingle();
      if (cliente?.centro) {
        await admin.from("notificaciones").insert({
          centro: cliente.centro,
          tipo: "complemento_pago_pendiente",
          mensaje: `El cliente ${cliente.nombre || ""} pagó la factura ${factura.folio || ""} (pago diferido) y no se pudo emitir su complemento de pago: ${r.error}. Emítelo desde Facturas.`,
        });
      }
    }
  } catch (err: any) {
    console.error(`[facturapi] complemento del pago ${pagoId}:`, err?.message || err);
  }
}
