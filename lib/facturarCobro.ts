// Emite el CFDI de un cobro que todavía no se paga (pago diferido, PPD): es lo
// que en ZORA es "Facturar electrónicamente". Al pagarse, la factura se cubre
// con un complemento de pago. El cobro conserva su folio, su monto y su estado;
// solo se le agregan los datos del CFDI.

import { createAdminClient } from "@/lib/supabaseAdmin";
import { timbrarCfdi, ErrorFacturacion } from "@/lib/facturapi";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoFacturar = { id: string; folio?: string; ok: boolean; uuid?: string; error?: string };

// Facturas que ya no se pueden facturar a pago diferido porque no hay nada que cobrar después.
const ESTADOS_NO_FACTURABLES = ["pagada", "cancelada"];

export async function facturarCobro(admin: Admin, facturaId: string): Promise<ResultadoFacturar> {
  const { data: f } = await admin
    .from("facturas")
    .select("id, folio, user_id, concepto, monto, estado, uuid_cfdi, centro")
    .eq("id", facturaId)
    .maybeSingle();
  if (!f) return { id: facturaId, ok: false, error: "Cobro no encontrado" };
  if (f.uuid_cfdi) return { id: facturaId, folio: f.folio, ok: false, error: "Ya tiene factura (CFDI)" };
  if (ESTADOS_NO_FACTURABLES.includes(f.estado)) {
    return { id: facturaId, folio: f.folio, ok: false, error: "Ya está pagado: se factura al cobrar, no a pago diferido" };
  }
  if (!f.user_id) return { id: facturaId, folio: f.folio, ok: false, error: "No tiene cliente asignado" };
  if (!(Number(f.monto) > 0)) return { id: facturaId, folio: f.folio, ok: false, error: "El monto debe ser mayor a cero" };

  const { data: cliente } = await admin
    .from("profiles")
    .select("email, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi")
    .eq("id", f.user_id)
    .maybeSingle();

  // Si el cobro viene de un cobro adicional (copias, frituras…), usa su clave del SAT.
  const { data: pagoAdicional } = await admin
    .from("pagos")
    .select("adicional_tipo")
    .eq("factura_id", f.id)
    .not("adicional_tipo", "is", null)
    .limit(1)
    .maybeSingle();

  try {
    const { datosFactura } = await timbrarCfdi(admin, {
      cliente: cliente || {},
      concepto: f.concepto,
      monto: Number(f.monto),
      adicionalTipo: pagoAdicional?.adicional_tipo || null,
      metodo: "PPD",
      formaPago: "99", // "Por definir": el SAT lo exige en PPD; la forma real va en el complemento
      etiqueta: `cobro ${f.id}`,
      idempotencyKey: `cobro-${f.id}`,
    });
    // Solo si sigue sin CFDI: evita pisar el de otra persona que facturó al mismo tiempo.
    const { error } = await admin.from("facturas").update(datosFactura).eq("id", f.id).is("uuid_cfdi", null);
    if (error) {
      console.error(`[facturar-cobro] ${f.id}: se timbró pero no se pudo guardar:`, error.message);
      return { id: f.id, folio: f.folio, ok: false, error: "Se timbró en Facturapi pero no se pudo guardar; revisa Facturapi antes de reintentar" };
    }
    return { id: f.id, folio: f.folio, ok: true, uuid: datosFactura.uuid_cfdi };
  } catch (err: any) {
    if (!(err instanceof ErrorFacturacion)) console.error(`[facturar-cobro] ${f.id}:`, err?.message || err);
    // La llave de idempotencia ya usada significa que este cobro ya se facturó (o se está facturando).
    if (/idempotencia|idempotency/i.test(err?.message || "")) {
      return { id: f.id, folio: f.folio, ok: false, error: "Este cobro ya se facturó o se está facturando; actualiza la pantalla" };
    }
    return { id: f.id, folio: f.folio, ok: false, error: err?.message || "Facturapi rechazó la factura" };
  }
}
