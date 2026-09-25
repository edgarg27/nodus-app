import { consultarCargo } from "@/lib/openpay";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarGraciasPorPago } from "@/lib/correosPagos";
import { hoyMexicoISO } from "@/lib/fechaMexico";

type Admin = ReturnType<typeof createAdminClient>;

// Vuelve a consultar el cargo en Openpay (nunca se confía en lo que diga el
// webhook o el navegador) y, si ya se completó, marca el pago como pagado:
// reactiva la cuenta, marca la factura, avisa al centro y manda el correo de
// gracias. Sirve igual para SPEI y tarjeta, y lo usan el webhook, la
// verificación al volver del 3D Secure y el propio cobro con tarjeta.
export async function confirmarPagoPorCargo(admin: Admin, chargeId: string): Promise<{ estado: string; pagoId?: string }> {
  const cargo = await consultarCargo(chargeId);
  if (cargo.status !== "completed") return { estado: cargo.status };

  const { data: pago } = await admin
    .from("pagos")
    .select("id, factura_id, estado, user_id, concepto, monto")
    .eq("openpay_charge_id", chargeId)
    .maybeSingle();
  if (!pago) return { estado: "completed" };
  if (pago.estado === "pagado") return { estado: "pagado", pagoId: pago.id };

  await admin.from("pagos").update({ estado: "pagado", fecha_pago: hoyMexicoISO() }).eq("id", pago.id);
  await admin.from("profiles").update({ suspendido: false }).eq("id", pago.user_id);

  const { data: cliente } = await admin.from("profiles").select("nombre, email, centro").eq("id", pago.user_id).maybeSingle();

  let centro: string | null = cliente?.centro || null;
  let detalle = pago.concepto || "pago";
  if (pago.factura_id) {
    const { data: factura } = await admin
      .from("facturas")
      .update({ estado: "pagada" })
      .eq("id", pago.factura_id)
      .select("folio, monto, centro")
      .single();
    if (factura) {
      centro = factura.centro || centro;
      detalle = `factura ${factura.folio} · ${Number(factura.monto).toLocaleString("es-MX")}`;
    }
  } else {
    detalle = `${detalle} · ${Number(pago.monto).toLocaleString("es-MX")}`;
  }

  if (centro) {
    await admin.from("notificaciones").insert({
      centro,
      tipo: "pago_confirmado",
      mensaje: `💰 Se confirmó el pago de ${cliente?.nombre || "un cliente"} — ${detalle}`,
    });
  }

  await enviarGraciasPorPago(admin, pago.id);
  return { estado: "pagado", pagoId: pago.id };
}
