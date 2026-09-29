import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";

// Enlace para "poner tu contraseña" (invitación nueva o recuperación),
// mandado siempre por nuestra plantilla vía Resend — antes el de
// invitación usaba el correo genérico de Supabase, con su enlace de
// "un clic y ya" (ConfirmationURL): los filtros de seguridad de correo
// (Outlook/Gmail corporativo, antivirus) a veces abren ese enlace ellos
// solos para revisarlo, lo gastan (es de un solo uso) y cuando la persona
// de verdad le da clic ya no sirve — se queda sin poder entrar.
//
// Por eso aquí el enlace NO activa la sesión solo con visitarlo: manda
// token_hash + type a nuestra propia página (/crear-password), que solo
// llama a supabase.auth.verifyOtp() hasta que la persona le da clic a un
// botón — un escáner automático normalmente solo hace la petición GET,
// no ejecuta el botón, así que ya no gasta el enlace.
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type TipoCorreoContrasena = "invite" | "recovery";

export async function mandarCorreoContrasena({
  email,
  nombre,
  tipo,
  origin,
}: {
  email: string;
  nombre?: string;
  tipo: TipoCorreoContrasena;
  origin: string;
}): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const admin = createAdminClient();
  const options = { redirectTo: `${origin}/crear-password`, data: nombre ? { nombre } : undefined };
  // type "invite" crea la cuenta si el correo no existe todavía (mismo
  // efecto que inviteUserByEmail, pero aquí sí controlamos el enlace y el
  // correo en vez de dejar que Supabase mande el suyo). El switch (en vez
  // de pasar la variable "tipo" directo) es solo para que TypeScript
  // distinga cuál de las dos formas del tipo unión está usando.
  const { data, error } =
    tipo === "invite"
      ? await admin.auth.admin.generateLink({ type: "invite", email, options })
      : await admin.auth.admin.generateLink({ type: "recovery", email, options });

  const hashedToken = data?.properties?.hashed_token;
  const userId = data?.user?.id;
  if (error || !hashedToken || !userId) {
    return { ok: false, error: error?.message || "No se pudo generar el enlace" };
  }

  const enlace = `${origin}/crear-password?token_hash=${encodeURIComponent(hashedToken)}&type=${tipo}`;
  const esInvite = tipo === "invite";
  const saludo = nombre ? `¡Hola, ${esc(nombre)}! 👋` : "¡Hola! 👋";

  const resultado = await enviarCorreo({
    to: email,
    subject: esInvite ? "¡Bienvenido a Nodus! Crea tu cuenta" : "Accede a tu cuenta de Nodus",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0d1b3e">
        <h2 style="margin:0 0 4px;color:#0d1b3e">Nodus Flex Center</h2>
        <p style="font-size:16px;margin:16px 0 8px">${saludo}</p>
        <p>${
          esInvite
            ? "Ya casi terminamos de armar tu cuenta en Nodus. Solo falta que pongas tu contraseña para poder entrar."
            : "Aquí tienes tu enlace para poner la contraseña de tu cuenta (si ya tenías una, esta la reemplaza)."
        }</p>
        <p style="margin:28px 0;text-align:center">
          <a href="${esc(enlace)}" style="background:#f07e3a;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;display:inline-block;font-size:15px">
            ${esInvite ? "Crear mi cuenta →" : "Poner mi contraseña →"}
          </a>
        </p>
        ${esInvite ? '<p style="margin:0 0 8px">¡Te esperamos! 🎉</p>' : ""}
        <p style="font-size:13px;color:#666">Este enlace vence en 1 hora y solo se puede usar una vez. Si no lo esperabas, ignora este correo — no pasa nada.</p>
        <p style="font-size:12px;color:#999;word-break:break-all">¿No funciona el botón? Copia y pega este enlace en tu navegador:<br>${esc(enlace)}</p>
      </div>
    `,
  });

  if (!resultado.ok) {
    console.error(`[correoContrasena] no se pudo mandar el correo (${tipo}) a ${email}:`, resultado.error);
    return { ok: false, error: resultado.error };
  }
  return { ok: true, userId };
}
