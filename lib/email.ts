import { Resend } from "resend";

// Envío de correo genérico y reutilizable — usado por Tours (confirmación +
// recordatorio) y por el flujo de firma de contratos. Un solo lugar para
// cambiar de proveedor si hace falta más adelante; hoy usa Resend.
//
// Requiere RESEND_API_KEY en .env.local. Mientras no esté configurada, no
// truena el flujo que la llama — regresa { ok: false } y el que la llama
// decide si eso es crítico o no (mismo criterio que ya usa
// app/api/cron/facturacion-diaria/route.ts para otras notificaciones).
const FROM_EMAIL = process.env.EMAIL_FROM || "Nodus Flex Center <notificaciones@nodusbc.mx>";

export async function enviarCorreo({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(`[email] RESEND_API_KEY no configurada — no se pudo enviar "${subject}" a ${to}`);
    return { ok: false, error: "Proveedor de correo no configurado" };
  }
  if (!to) {
    return { ok: false, error: "Falta el destinatario" };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) {
      console.error(`[email] Error al mandar "${subject}" a ${to}:`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e: any) {
    console.error(`[email] Excepción al mandar "${subject}" a ${to}:`, e?.message);
    return { ok: false, error: e?.message || "Error desconocido" };
  }
}
