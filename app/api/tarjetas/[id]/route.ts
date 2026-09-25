import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { eliminarTarjetaDeCliente } from "@/lib/openpay";
import { CONSENTIMIENTO_COBROS_VERSION } from "@/lib/consentimientoCobros";
import { ipDeRequest } from "@/lib/rateLimit";

async function sesion() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

// Activar o desactivar el cobro automático de una tarjeta propia.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await sesion();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { cobroAutomatico, consentimiento } = await req.json();
  if (typeof cobroAutomatico !== "boolean") return NextResponse.json({ error: "Falta indicar si se activa o no" }, { status: 400 });
  if (cobroAutomatico && consentimiento !== true) {
    return NextResponse.json({ error: "Para activar el cobro automático hay que aceptar la autorización" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: tarjeta } = await admin
    .from("tarjetas_guardadas")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", session.user.id)
    .eq("activa", true)
    .maybeSingle();
  if (!tarjeta) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  if (cobroAutomatico) {
    await admin.from("tarjetas_guardadas").update({ cobro_automatico: false }).eq("user_id", session.user.id);
    const { error } = await admin
      .from("tarjetas_guardadas")
      .update({
        cobro_automatico: true,
        fallos_consecutivos: 0,
        consentimiento_at: new Date().toISOString(),
        consentimiento_version: CONSENTIMIENTO_COBROS_VERSION,
        consentimiento_ip: ipDeRequest(req.headers),
      })
      .eq("id", tarjeta.id);
    if (error) return NextResponse.json({ error: "No se pudo activar el cobro automático" }, { status: 500 });
  } else {
    await admin.from("tarjetas_guardadas").update({ cobro_automatico: false }).eq("id", tarjeta.id);
  }
  return NextResponse.json({ ok: true });
}

// Eliminar una tarjeta propia (en Openpay y en Nodus). Con ella se va el cobro
// automático.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await sesion();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const admin = createAdminClient();
  const { data: tarjeta } = await admin
    .from("tarjetas_guardadas")
    .select("id, openpay_customer_id, openpay_card_id")
    .eq("id", params.id)
    .eq("user_id", session.user.id)
    .eq("activa", true)
    .maybeSingle();
  if (!tarjeta) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  try {
    await eliminarTarjetaDeCliente(tarjeta.openpay_customer_id, tarjeta.openpay_card_id);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "No se pudo eliminar la tarjeta" }, { status: 502 });
  }
  // Se conserva la fila (sin cobro automático) como constancia de la aceptación.
  await admin.from("tarjetas_guardadas").update({ activa: false, cobro_automatico: false }).eq("id", tarjeta.id);
  return NextResponse.json({ ok: true });
}
