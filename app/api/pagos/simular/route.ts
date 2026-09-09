import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Público, sin sesión — el link de /pagar-simulado se manda directo al
// cliente (o a quien lo tenga) sin exigirle iniciar sesión, es solo un
// botón de confirmación manual (no hay dinero real de por medio).
//
// Restringido a pagos con `factura_id: null` (el flujo 1.1 documentado en
// DOCUMENTACION_FACTURAS.md) — los pagos de facturación real (con
// factura_id) solo se marcan pagado desde /api/pagos/marcar-pagado, que sí
// exige sesión de staff. Sin este guard, este endpoint público expondría
// también los pagos de renta mensual real a cualquiera con el UUID.
export async function POST(req: NextRequest) {
  const { pagoId } = await req.json();
  if (!pagoId) {
    return NextResponse.json({ error: "Falta pagoId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pago } = await admin.from("pagos").select("id, estado, factura_id, user_id").eq("id", pagoId).maybeSingle();

  if (!pago) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }
  if (pago.factura_id) {
    return NextResponse.json({ error: "Este pago pertenece a una factura y no se puede simular aquí" }, { status: 403 });
  }
  if (pago.estado === "pagado") {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.from("pagos").update({ estado: "pagado" }).eq("id", pagoId);
  if (error) {
    return NextResponse.json({ error: "No se pudo confirmar el pago" }, { status: 500 });
  }
  if (pago.user_id) {
    await admin.from("profiles").update({ suspendido: false }).eq("id", pago.user_id);
  }

  return NextResponse.json({ ok: true });
}
