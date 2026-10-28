import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarGraciasPorPago } from "@/lib/correosPagos";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { rolPuede } from "@/lib/permisosApi";
import { complementoAlPagar } from "@/lib/facturapi";
import { esCuentaDeposito } from "@/lib/cuentasDeposito";

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

  // cuentaDestino: solo depósitos en garantía (a qué cuenta cayó, ver lib/cuentasDeposito.ts).
  const { pagoId, comprobanteUrl, cuentaDestino } = await req.json();
  if (!pagoId) {
    return NextResponse.json({ error: "Falta pagoId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pago } = await admin.from("pagos").select("id, user_id, estado, adicional_tipo").eq("id", pagoId).maybeSingle();

  if (cuentaDestino !== undefined && !esCuentaDeposito(cuentaDestino)) {
    return NextResponse.json({ error: "Cuenta no válida" }, { status: 400 });
  }

  const datosActualizar: { estado: string; comprobante_url?: string; fecha_pago?: string; cuenta_destino?: string } = { estado: "pagado" };
  if (comprobanteUrl) datosActualizar.comprobante_url = comprobanteUrl;
  if (cuentaDestino) datosActualizar.cuenta_destino = cuentaDestino;
  // Solo la primera vez: si ya estaba pagado y lo vuelven a mandar (doble
  // clic, o un comprobante nuevo), no se pisa la fecha real del pago.
  if (!pago || pago.estado !== "pagado") datosActualizar.fecha_pago = hoyMexicoISO();

  const { error } = await admin.from("pagos").update(datosActualizar).eq("id", pagoId);
  if (error) {
    return NextResponse.json({ error: "No se pudo marcar el pago como pagado" }, { status: 500 });
  }
  // Un cobro adicional (copias, frituras…) no reactiva una cuenta suspendida:
  // eso solo lo hace pagar lo que se debe.
  if (pago?.user_id && !pago.adicional_tipo) {
    await admin.from("profiles").update({ suspendido: false }).eq("id", pago.user_id);
  }
  // Solo la primera vez que pasa a pagado (evita dos correos por doble clic).
  if (pago && pago.estado !== "pagado") {
    await enviarGraciasPorPago(admin, pagoId);
    // La factura la hace finanzas (como en ZORA); si el cobro ya era PPD se emite su complemento.
    // Pago marcado a mano: con comprobante se asume transferencia, sin él, efectivo.
    await complementoAlPagar(admin, pagoId, comprobanteUrl ? "bank_account" : "cash");
  }

  return NextResponse.json({ ok: true });
}
