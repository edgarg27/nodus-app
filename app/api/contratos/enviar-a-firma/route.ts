import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";

// Botón "📧 Enviar a firma" en ContratoModal.tsx — manda al cliente una
// liga pública a /firmar-contrato/[id] donde puede revisar el contrato y
// dar clic en "Firmo y acepto" (sin necesitar cuenta ni contraseña, igual
// que ya son públicas las ligas de archivo_url en Supabase Storage).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { contratoId } = await req.json();
  if (!contratoId) {
    return NextResponse.json({ error: "Falta el id del contrato" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: contrato, error: contratoError } = await admin.from("contratos").select("*").eq("id", contratoId).single();
  if (contratoError || !contrato) {
    return NextResponse.json({ error: "No se encontró el contrato" }, { status: 404 });
  }
  if (!contrato.archivo_url) {
    return NextResponse.json({ error: "Sube el contrato antes de mandarlo a firma" }, { status: 400 });
  }

  let correoDestino = contrato.cliente_email_historico;
  let nombreDestino = contrato.cliente_nombre_historico || "Cliente";
  if (contrato.user_id) {
    const { data: perfil } = await admin.from("profiles").select("email, nombre").eq("id", contrato.user_id).maybeSingle();
    correoDestino = perfil?.email || correoDestino;
    nombreDestino = perfil?.nombre || nombreDestino;
  }

  if (!correoDestino) {
    return NextResponse.json({ error: "Este contrato no tiene un correo de cliente registrado" }, { status: 400 });
  }

  const liga = `${req.nextUrl.origin}/firmar-contrato/${contrato.id}`;
  const html = `
    <p>Hola ${nombreDestino},</p>
    <p>Tu contrato con <strong>${contrato.centro}</strong> ya está listo para tu revisión y firma.</p>
    <p><a href="${liga}">Da clic aquí para revisarlo y firmarlo</a></p>
    <p>Si el botón no funciona, copia y pega esta liga en tu navegador:<br>${liga}</p>
  `;

  const resultado = await enviarCorreo({
    to: correoDestino,
    subject: `Tu contrato con ${contrato.centro} está listo para firmar`,
    html,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: "No se pudo mandar el correo: " + resultado.error }, { status: 500 });
  }

  await admin.from("contratos").update({ enviado_a_firma_at: new Date().toISOString() }).eq("id", contratoId);

  return NextResponse.json({ ok: true });
}
