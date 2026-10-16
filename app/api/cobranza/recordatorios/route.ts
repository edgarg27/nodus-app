import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { enviarCorreo } from "@/lib/email";
import { esCorreoFicticio } from "@/lib/correoFicticio";
import { cargarCobranza, resumenCliente } from "@/lib/cobranza";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.nodusbc.mx").replace(/\/+$/, "");
const MAXIMO = 200;

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const moneda = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaLarga = (iso: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—");

// Recordatorio de pago que manda la contadora (además de los automáticos). Solo manda el correo: no genera cobros
// ni facturas. En el mensaje se pueden usar {nombre}, {saldo} y {fecha_limite}.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosMarcarPagado")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(b.userIds) ? b.userIds.filter((x: unknown) => typeof x === "string").slice(0, MAXIMO) : [];
  const asunto = typeof b.asunto === "string" ? b.asunto.trim().slice(0, 150) : "";
  const mensaje = typeof b.mensaje === "string" ? b.mensaje.trim().slice(0, 3000) : "";
  if (userIds.length === 0) return NextResponse.json({ error: "Elige a quién mandarlo" }, { status: 400 });
  if (!asunto || !mensaje) return NextResponse.json({ error: "Escribe el asunto y el mensaje" }, { status: 400 });

  const admin = createAdminClient();
  const centro = ROLES_GLOBALES.includes(yo!.rol) ? null : yo!.centro;
  const { clientes, cargos } = await cargarCobranza(admin, { centro, userIds });

  let enviados = 0;
  const fallos: string[] = [];
  for (const c of clientes) {
    if (!c.email || esCorreoFicticio(c.email)) {
      fallos.push(c.nombre + ": sin correo");
      continue;
    }
    const { saldo, fechaLimite } = resumenCliente(cargos, c.id);
    const texto = mensaje
      .replace(/\{nombre\}/g, c.nombre_fiscal || c.empresa || c.nombre || "cliente")
      .replace(/\{saldo\}/g, moneda(saldo))
      .replace(/\{fecha_limite\}/g, fechaLarga(fechaLimite));
    const parrafos = escapar(texto)
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${p.replace(/\n/g, "<br>")}</p>`)
      .join("");
    const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      ${parrafos}
      <p style="margin:12px 0 0;font-size:13px">Consulta tu estado de cuenta: <a href="${SITIO}/estado-cuenta">${SITIO}/estado-cuenta</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#888">Nodus Flex Center</p>
    </div>
  </div>`;
    const r = await enviarCorreo({ to: c.email, subject: asunto, html });
    if (r.ok) enviados++;
    else fallos.push(c.nombre + ": " + (r.error || "no se pudo enviar"));
  }
  return NextResponse.json({ ok: true, enviados, fallos });
}
