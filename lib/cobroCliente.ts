import { createAdminClient } from "@/lib/supabaseAdmin";

type Admin = ReturnType<typeof createAdminClient>;

// Qué se le va a cobrar al cliente con tarjeta: una factura o un pago suelto (renta,
// depósito…) que sea SUYO. Lo usan el pago con tarjeta nueva y con tarjeta guardada.
export type CobroCliente = {
  monto: number;
  descripcion: string;
  pagoExistenteId: string | null;
  facturaDelPagoId: string | null;
};

export async function resolverCobroCliente(
  admin: Admin,
  userId: string,
  ref: { pagoId?: string; facturaId?: string }
): Promise<{ ok: true; cobro: CobroCliente } | { ok: false; error: string; status: number }> {
  let cobro: CobroCliente;
  if (ref.pagoId) {
    const { data: pago } = await admin
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, user_id")
      .eq("id", ref.pagoId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!pago) return { ok: false, error: "Pago no encontrado", status: 404 };
    if (pago.estado === "pagado") return { ok: false, error: "Este pago ya está pagado", status: 400 };
    cobro = {
      monto: Number(pago.monto),
      descripcion: pago.concepto || "Pago Nodus",
      pagoExistenteId: pago.id,
      facturaDelPagoId: pago.factura_id,
    };
  } else {
    const { data: factura } = await admin
      .from("facturas")
      .select("id, folio, concepto, monto, estado, user_id")
      .eq("id", ref.facturaId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!factura) return { ok: false, error: "Factura no encontrada", status: 404 };
    if (factura.estado === "pagada") return { ok: false, error: "Esta factura ya está pagada", status: 400 };
    cobro = {
      monto: Number(factura.monto),
      descripcion: `${factura.folio} - ${factura.concepto}`,
      pagoExistenteId: null,
      facturaDelPagoId: factura.id,
    };
  }
  if (!(cobro.monto > 0)) return { ok: false, error: "El monto a cobrar no es válido", status: 400 };
  return { ok: true, cobro };
}

// Deja el cargo de Openpay ligado al pago (o crea el pago de la factura) para que el
// webhook y la verificación lo encuentren. Regresa un mensaje si no se pudo registrar.
export async function registrarCargoEnPago(
  admin: Admin,
  userId: string,
  cobro: CobroCliente,
  chargeId: string,
  nota: string
): Promise<string | null> {
  if (cobro.pagoExistenteId) {
    await admin.from("pagos").update({ openpay_charge_id: chargeId, notas: nota }).eq("id", cobro.pagoExistenteId);
    return null;
  }
  const { error } = await admin.from("pagos").insert({
    factura_id: cobro.facturaDelPagoId,
    user_id: userId,
    monto: cobro.monto,
    estado: "pendiente",
    notas: nota,
    openpay_charge_id: chargeId,
  });
  return error ? "El cargo se generó pero no se pudo registrar. Avisa al centro." : null;
}
