import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";

const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.nodusbc.mx").replace(/\/+$/, "");
const TIPO: Record<string, { etiqueta: string; frase: string }> = {
  coworking: { etiqueta: "Coworking", frase: "nuestro coworking" },
  working_desk: { etiqueta: "Working Desk", frase: "tu working desk" },
  oficina_privada: { etiqueta: "Oficina Privada", frase: "tu oficina privada" },
};
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Manda el Day Pass al correo del invitado (al generarlo y con "Reenviar correo"). Va por el mismo correo de la app
// (lib/email.ts, Resend) y dice la verdad si falla; antes iba por la función "send-email" de Supabase, que respondía
// "enviado" aunque el correo no saliera.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!yo?.rol || yo.rol === "cliente") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { dayPassId } = await req.json().catch(() => ({}));
  if (typeof dayPassId !== "string" || !dayPassId) return NextResponse.json({ error: "Falta el Day Pass" }, { status: 400 });

  const admin = createAdminClient();
  const { data: dp } = await admin.from("day_passes").select("id, folio, tipo, centro, nombre, fecha, email").eq("id", dayPassId).maybeSingle();
  if (!dp) return NextResponse.json({ error: "Day Pass no encontrado" }, { status: 404 });
  const correo = String(dp.email || "").trim();
  if (!correo) return NextResponse.json({ error: "El invitado no dejó correo" }, { status: 400 });

  const tipo = TIPO[dp.tipo] || TIPO.coworking;
  const folio = "NODUS-" + String(dp.folio).padStart(3, "0");
  const link = `${SITIO}/day-pass/${dp.id}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#f07e3a">${tipo.etiqueta.toUpperCase()} · ${folio}</p>
      <h2 style="margin:0 0 12px;font-size:20px;color:#0d1b3e">Tu Day Pass está listo</h2>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.5">Hola ${escapar(dp.nombre)}, este es tu Day Pass para trabajar un día en ${tipo.frase}. Preséntalo en recepción al llegar.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
        <tr><td style="padding:8px;color:#888">Fecha</td><td style="padding:8px;font-weight:700">${escapar(dp.fecha)}</td></tr>
        <tr><td style="padding:8px;color:#888">Centro</td><td style="padding:8px;font-weight:700">${escapar(dp.centro)}</td></tr>
        <tr><td style="padding:8px;color:#888">Folio</td><td style="padding:8px;font-weight:700">${folio}</td></tr>
      </table>
      <p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;background:#f07e3a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Ver y descargar mi Day Pass</a></p>
      <p style="margin:0;font-size:12px;color:#888">Es un pase de un solo uso, válido solo el ${escapar(dp.fecha)}.</p>
    </div>
  </div>`;
  const r = await enviarCorreo({ to: correo, subject: `Tu Day Pass ${folio} - Nodus Flex Center`, html });
  if (!r.ok) return NextResponse.json({ error: r.error || "No se pudo enviar el correo" }, { status: 502 });
  return NextResponse.json({ ok: true, correo });
}
