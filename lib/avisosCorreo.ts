import { enviarCorreo } from "@/lib/email";

// Avisos por correo de tickets, reservaciones y encuestas. Antes los mandaba la función "send-email" de Supabase, con
// su propia copia de la llave de Resend y respondiendo "ok" aunque fallara; ahora los manda la app con lib/email.ts
// (la misma llave del servidor) y quien llama sabe si salió.

const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.nodusbc.mx").replace(/\/+$/, "");

// A quién le llega un reporte nuevo según su área (los mismos que tenía la función de Supabase).
export const CORREOS_AREA: Record<string, string[]> = {
  sistemas: ["it.aux@nodusbc.mx", "it.admin@nodusbc.mx"],
  mantenimiento: ["proyectos@nodusbc.mx"],
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapar = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

type Fila = [string, string | null | undefined];

export function plantillaAviso(o: { etiqueta?: string; titulo: string; parrafos?: string[]; filas?: Fila[]; boton?: { texto: string; url: string }; fotos?: string[] }) {
  const filas = (o.filas || []).filter(([, v]) => v != null && String(v).trim() !== "");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      ${o.etiqueta ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#f07e3a">${escapar(o.etiqueta)}</p>` : ""}
      <h2 style="margin:0 0 12px;font-size:20px;color:#0d1b3e">${escapar(o.titulo)}</h2>
      ${(o.parrafos || []).map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${p}</p>`).join("")}
      ${
        filas.length
          ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${filas
              .map(([k, v]) => `<tr><td style="padding:8px;color:#888;vertical-align:top;width:35%">${escapar(k)}</td><td style="padding:8px;font-weight:700">${escapar(v)}</td></tr>`)
              .join("")}</table>`
          : ""
      }
      ${(o.fotos || []).slice(0, 4).map((u) => `<p style="margin:0 0 8px"><a href="${escapar(u)}">Ver foto adjunta</a></p>`).join("")}
      ${o.boton ? `<p style="margin:8px 0 0"><a href="${escapar(o.boton.url)}" style="display:inline-block;background:#f07e3a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapar(o.boton.texto)}</a></p>` : ""}
      <p style="margin:16px 0 0;font-size:12px;color:#888">Nodus Flex Center</p>
    </div>
  </div>`;
}

// Manda el mismo correo a varios destinatarios; regresa a cuántos salió y los errores.
export async function enviarAVarios(destinos: string[], subject: string, html: string) {
  let enviados = 0;
  const errores: string[] = [];
  for (const to of Array.from(new Set(destinos.map((d) => d.trim()).filter(Boolean)))) {
    const r = await enviarCorreo({ to, subject, html });
    if (r.ok) enviados++;
    else errores.push(`${to}: ${r.error || "no se pudo enviar"}`);
  }
  return { enviados, errores };
}

export const LINK = {
  tickets: `${SITIO}/tickets`,
  soporte: `${SITIO}/soporte`,
  reservaciones: `${SITIO}/reservaciones?tab=mis`,
  centro: `${SITIO}/sala-juntas`,
};
