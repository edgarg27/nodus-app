import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

// "¿Olvidaste tu contraseña?" del login (público, sin sesión). Genera un
// enlace de recuperación de Supabase y lo manda por Resend con el estilo de
// Nodus — así no dependemos del límite bajo de correos de Supabase.
//
// Siempre responde igual exista o no la cuenta, para que nadie pueda usar
// esto para averiguar qué correos o números de usuario están registrados.
const RESPUESTA_OK = { ok: true };

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`recuperar-ip:${ipDeRequest(req.headers)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Demasiados intentos. Intenta de nuevo en unos minutos." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const identificador = typeof body?.identificador === "string" ? body.identificador.trim().slice(0, 120) : "";
  if (!identificador) {
    return NextResponse.json({ error: "Escribe tu correo o número de usuario" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Igual que el login: acepta correo o número de usuario (ej. N-1356).
  let email = identificador.toLowerCase();
  if (!identificador.includes("@")) {
    const { data } = await admin.from("profiles").select("email").ilike("numero_usuario", identificador).maybeSingle();
    if (!data?.email) return NextResponse.json(RESPUESTA_OK);
    email = String(data.email).toLowerCase();
  }

  // Tope por cuenta, para que nadie llene de correos la bandeja de alguien.
  if (!checkRateLimit(`recuperar-cuenta:${email}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json(RESPUESTA_OK);
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${req.nextUrl.origin}/crear-password` },
  });
  const enlace = data?.properties?.action_link;
  if (error || !enlace) return NextResponse.json(RESPUESTA_OK);

  const resultado = await enviarCorreo({
    to: email,
    // Texto neutral a propósito: este mismo enlace lo recibe tanto quien
    // olvidó su contraseña como quien todavía nunca puso una (ej. una
    // invitación que se reenvía por esta vía) — "restablecer" confundía
    // a los del segundo caso, como si ya hubieran tenido una antes.
    subject: "Accede a tu cuenta de Nodus",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0d1b3e">
        <h2 style="margin:0 0 12px">Nodus Flex Center</h2>
        <p>Usa este enlace para poner la contraseña de tu cuenta (si ya tenías una, se reemplaza por la nueva).</p>
        <p style="margin:24px 0">
          <a href="${esc(enlace)}" style="background:#f07e3a;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">
            Poner mi contraseña
          </a>
        </p>
        <p style="font-size:13px;color:#666">El enlace vence en 1 hora y solo se puede usar una vez. Si no lo esperabas, ignora este correo: no pasa nada.</p>
        <p style="font-size:12px;color:#999;word-break:break-all">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${esc(enlace)}</p>
      </div>
    `,
  });
  if (!resultado.ok) {
    console.error("[recuperar-password] no se pudo mandar el correo:", resultado.error);
  }

  return NextResponse.json(RESPUESTA_OK);
}
