// Timbrado SIMULADO, solo para probar el flujo mientras Facturapi no responde (suscripción vencida).
// Nunca se simula para clientes reales: solo para clientes cuyo nombre empieza con "PRUEBA". La factura simulada se
// reconoce siempre por su UUID (empieza con el prefijo de abajo) y no tiene XML ni PDF del SAT.
import type { createAdminClient } from "@/lib/supabaseAdmin";

type Admin = ReturnType<typeof createAdminClient>;

export const PREFIJO_UUID_SIMULADO = "00000000-0000-4000-8000-";

export function esFacturaSimulada(uuid: string | null | undefined): boolean {
  return !!uuid && uuid.startsWith(PREFIJO_UUID_SIMULADO);
}

export function esClientePrueba(nombre: string | null | undefined): boolean {
  return /^\s*PRUEBA\b/i.test(nombre || "");
}

export function esErrorSuscripcion(mensaje: string | null | undefined): boolean {
  return /suscripci[oó]n activa/i.test(mensaje || "");
}

type ParamsSimulacion = {
  cliente: { rfc?: string | null; nombre_fiscal?: string | null; uso_cfdi?: string | null };
  concepto: string | null;
  monto: number;
  lineas?: { concepto: string; monto: number }[];
  serie?: string | null;
  metodo: "PUE" | "PPD";
  formaPago: string;
};

const redondear = (n: number) => Math.round(n * 100) / 100;

// Marca el cobro como timbrado (simulado) y devuelve su UUID, o null si el cliente no es de prueba.
export async function simularTimbrado(admin: Admin, facturaId: string, userId: string, p: ParamsSimulacion): Promise<{ uuid: string } | null> {
  const { data: perfil } = await admin.from("profiles").select("nombre").eq("id", userId).maybeSingle();
  if (!esClientePrueba(perfil?.nombre)) return null;

  const lineas = p.lineas && p.lineas.length > 0 ? p.lineas : [{ concepto: p.concepto || "Servicios Nodus Flex Center", monto: p.monto }];
  const conceptos = lineas.map((l) => {
    const unitario = redondear(Number(l.monto) / 1.16);
    return { descripcion: l.concepto, cantidad: 1, valorUnitario: unitario, importe: unitario };
  });
  const subtotal = redondear(conceptos.reduce((s, c) => s + c.importe, 0));
  const iva = redondear(Number(p.monto) - subtotal);
  const uuid = PREFIJO_UUID_SIMULADO + Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  const { error } = await admin
    .from("facturas")
    .update({
      facturapi_id: "simulado-" + uuid,
      uuid_cfdi: uuid,
      serie: p.serie || null,
      folio_fiscal: String(9000 + Math.floor(Math.random() * 999)),
      rfc_emisor: "NBC171012LX7",
      nombre_emisor: "NBC COMPANY",
      rfc_receptor: p.cliente.rfc || null,
      nombre_receptor: p.cliente.nombre_fiscal || null,
      subtotal,
      iva,
      retenciones: 0,
      moneda: "MXN",
      tipo_comprobante: "I",
      forma_pago: p.formaPago,
      metodo_pago: p.metodo,
      uso_cfdi: p.cliente.uso_cfdi || "G03",
      conceptos,
      impuestos: [{ tipo: "traslado", impuesto: "IVA", tasaOCuota: "0.16", importe: iva }],
      xml_url: null,
      archivo_url: null,
      fuente: "facturapi_auto",
    })
    .eq("id", facturaId)
    .is("uuid_cfdi", null);
  if (error) return null;
  return { uuid };
}
