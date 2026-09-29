import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { mandarCorreoContrasena } from "@/lib/correoContrasena";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

// "¿Olvidaste tu contraseña?" del login (público, sin sesión). Manda el
// enlace por Resend con el estilo de Nodus — así no dependemos del límite
// bajo de correos de Supabase, y el enlace queda protegido contra que un
// escáner de correo lo gaste antes de que la persona le dé clic (ver
// lib/correoContrasena.ts).
//
// Siempre responde igual exista o no la cuenta, para que nadie pueda usar
// esto para averiguar qué correos o números de usuario están registrados.
const RESPUESTA_OK = { ok: true };

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

  const resultado = await mandarCorreoContrasena({ email, tipo: "recovery", origin: req.nextUrl.origin });
  if (!resultado.ok) {
    console.error("[recuperar-password] no se pudo mandar el correo:", resultado.error);
  }

  return NextResponse.json(RESPUESTA_OK);
}
