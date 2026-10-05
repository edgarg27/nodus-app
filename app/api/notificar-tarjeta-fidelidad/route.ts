import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreoTarjeta } from "@/lib/correoTarjetaFidelidad";

// Endpoint público (sin sesión) — lo llama /tarjeta-fidelidad justo después
// de crear la tarjeta, para avisarle al centro. Mismo patrón que
// /api/notificar-solicitud-invitado.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const centro = body?.centro as string | undefined;
  const nombre = body?.nombre as string | undefined;
  const folio = body?.folio as number | undefined;
  const email = body?.email as string | undefined;

  if (!centro || !nombre || !folio) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const folioMostrar = "NODUS-FID-" + String(folio).padStart(6, "0");

  // 1) Notificación dentro de la app (la campanita del panel del centro).
  await admin.from("notificaciones").insert({
    centro,
    tipo: "nueva_tarjeta_fidelidad",
    mensaje: `💳 ${nombre} pidió su tarjeta de fidelidad (folio ${folioMostrar}) — pídele el folio en su próxima visita para sellarla.`,
  });

  // 2) Correo al cliente con su folio, para que lo guarde. Va por Resend
  //    (lib/email.ts) — la función "send-email" de Supabase no soporta este
  //    tipo, por eso antes nunca llegaba. Best-effort: si falla, la tarjeta
  //    ya está creada.
  if (email) await enviarCorreoTarjeta({ nombre, centro, folio, email });

  return NextResponse.json({ ok: true });
}
