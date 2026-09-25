import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarGraciasPorPago } from "@/lib/correosPagos";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { rolPuede } from "@/lib/permisosApi";

// Requiere sesión de staff. Puede marcar pagado CUALQUIER pago, con o sin
// factura_id. Lo usa /pagos (botón "✓ Marcar como pagado"), tanto para
// comprobantes en_revision como para pagos sueltos de Cotizar que el staff
// prefiera cerrar a mano.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosMarcarPagado")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { pagoId, comprobanteUrl } = await req.json();
  if (!pagoId) {
    return NextResponse.json({ error: "Falta pagoId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pago } = await admin.from("pagos").select("id, user_id, estado").eq("id", pagoId).maybeSingle();

  const datosActualizar: { estado: string; comprobante_url?: string; fecha_pago?: string } = { estado: "pagado" };
  if (comprobanteUrl) datosActualizar.comprobante_url = comprobanteUrl;
  // Solo la primera vez: si ya estaba pagado y lo vuelven a mandar (doble
  // clic, o un comprobante nuevo), no se pisa la fecha real del pago.
  if (!pago || pago.estado !== "pagado") datosActualizar.fecha_pago = hoyMexicoISO();

  const { error } = await admin.from("pagos").update(datosActualizar).eq("id", pagoId);
  if (error) {
    return NextResponse.json({ error: "No se pudo marcar el pago como pagado" }, { status: 500 });
  }
  if (pago?.user_id) {
    await admin.from("profiles").update({ suspendido: false }).eq("id", pago.user_id);
  }
  // Solo la primera vez que pasa a pagado (evita dos correos por doble clic).
  if (pago && pago.estado !== "pagado") {
    await enviarGraciasPorPago(admin, pagoId);
  }

  return NextResponse.json({ ok: true });
}
