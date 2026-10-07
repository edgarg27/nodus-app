import { LOGO_URL, escaparHtml } from "@/lib/comunicado";
import { fechaLocal } from "@/lib/fechaMexico";

// Correos del seguimiento de prospectos (app/prospectos/SeguimientoModal.tsx):
//  - confirmación al programar una actividad (/api/prospectos/actividad-programada)
//  - resumen diario de las 9:00 am con lo de hoy y lo atrasado
//    (/api/cron/recordatorio-seguimiento)
// Mismo diseño que los comunicados (lib/comunicado.ts): encabezado azul con logo.

const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.nodusbc.mx").replace(/\/+$/, "");
const URL_PROSPECTOS = `${SITIO}/prospectos`;

const TIPOS: Record<string, { label: string; icono: string; verbo: string }> = {
  correo: { label: "Correo", icono: "✉️", verbo: "Mandar correo a" },
  mensaje: { label: "Mensaje", icono: "💬", verbo: "Mandar mensaje a" },
  llamada: { label: "Llamada", icono: "📞", verbo: "Llamar a" },
  tour: { label: "Tour", icono: "🏢", verbo: "Tour con" },
  otro: { label: "Otro", icono: "📌", verbo: "Seguimiento con" },
};

export type ActividadCorreo = {
  tipo: string;
  tipo_otro: string | null;
  descripcion: string | null;
  fecha: string;
  // Solo tours (columna time, "11:00:00").
  hora?: string | null;
  prospecto: {
    nombre: string;
    telefono: string | null;
    email: string | null;
    empresa: string | null;
    centro: string | null;
  };
};

function tipoDe(a: ActividadCorreo) {
  return TIPOS[a.tipo] || TIPOS.otro;
}

// "📞 Llamar a Ana Torres" / "📌 Visita a su oficina — Ana Torres"
export function tituloActividad(a: ActividadCorreo) {
  const t = tipoDe(a);
  if (a.tipo === "otro" && a.tipo_otro) return `${t.icono} ${a.tipo_otro} — ${a.prospecto.nombre}`;
  return `${t.icono} ${t.verbo} ${a.prospecto.nombre}`;
}

export function fechaLarga(f: string) {
  return fechaLocal(f).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fechaCorta(f: string) {
  return fechaLocal(f).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

// Un teléfono de México de 10 dígitos se manda a WhatsApp con lada 52.
function enlaceWhatsApp(telefono: string) {
  const digitos = telefono.replace(/\D/g, "");
  const conLada = digitos.length === 10 ? `52${digitos}` : digitos;
  return conLada.length >= 10 ? `https://wa.me/${conLada}` : null;
}

// Teléfono (con WhatsApp si es un mensaje) y correo del prospecto, como links.
function contactoHtml(a: ActividadCorreo) {
  const partes: string[] = [];
  const { telefono, email } = a.prospecto;
  if (telefono) {
    const tel = escaparHtml(telefono);
    partes.push(`📱 <a href="tel:${tel.replace(/\s/g, "")}" style="color:#2563eb;text-decoration:none;">${tel}</a>`);
    const wa = a.tipo === "mensaje" ? enlaceWhatsApp(telefono) : null;
    if (wa) partes.push(`<a href="${wa}" style="color:#0f6e56;text-decoration:none;font-weight:600;">WhatsApp</a>`);
  }
  if (email) {
    const correo = escaparHtml(email);
    partes.push(`✉️ <a href="mailto:${correo}" style="color:#2563eb;text-decoration:none;">${correo}</a>`);
  }
  return partes.length ? partes.join(" &nbsp;·&nbsp; ") : `<span style="color:#aaa;">Sin teléfono ni correo registrado</span>`;
}

function tarjetaActividad(a: ActividadCorreo, opciones: { atrasada?: boolean } = {}) {
  const empresaCentro = [a.prospecto.empresa, a.prospecto.centro].filter(Boolean).map((t) => escaparHtml(String(t))).join(" · ");
  const borde = opciones.atrasada ? "#f0c4c4" : "#e6e8ee";
  const fondo = opciones.atrasada ? "#fdf5f5" : "#fafbfc";
  return (
    `<div style="border:1px solid ${borde};background:${fondo};border-radius:10px;padding:14px 16px;margin:0 0 10px 0;">` +
    `<p style="margin:0;font-size:15px;font-weight:700;color:#0d1b3e;">${escaparHtml(tituloActividad(a))}</p>` +
    (empresaCentro ? `<p style="margin:3px 0 0 0;font-size:12px;color:#888;">${empresaCentro}</p>` : "") +
    (a.descripcion
      ? `<p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;color:#333;">${escaparHtml(a.descripcion)}</p>`
      : "") +
    (a.hora ? `<p style="margin:8px 0 0 0;font-size:13px;color:#0d1b3e;">🕐 <strong>${escaparHtml(a.hora.slice(0, 5))}</strong></p>` : "") +
    (opciones.atrasada
      ? `<p style="margin:8px 0 0 0;font-size:12px;font-weight:700;color:#a32d2d;">Atrasada · era para el ${escaparHtml(fechaCorta(a.fecha))}</p>`
      : "") +
    `<p style="margin:8px 0 0 0;font-size:13px;">${contactoHtml(a)}</p>` +
    "</div>"
  );
}

function boton(texto: string) {
  return (
    `<div style="text-align:center;margin:18px 0 4px 0;">` +
    `<a href="${URL_PROSPECTOS}" style="display:inline-block;background:#f07e3a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">${texto}</a>` +
    "</div>"
  );
}

function plantilla(contenido: string) {
  return (
    '<div style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;">' +
    '<table role="presentation" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#0D1B3E;padding:28px 24px;text-align:center;">' +
    `<img src="${LOGO_URL}" alt="Nodus" style="height:40px;margin-bottom:10px;" />` +
    '<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;">NODUS</div>' +
    '<div style="color:#9aa4c4;font-size:12px;letter-spacing:2px;">FLEX CENTER</div>' +
    "</td></tr>" +
    `<tr><td style="padding:26px 24px 8px 24px;">${contenido}</td></tr>` +
    '<tr><td style="padding:12px 24px 24px 24px;text-align:center;">' +
    '<p style="margin:0;font-size:12px;color:#aaa;">Nodus Flex Center · Aguascalientes · León · San Luis Potosí</p>' +
    "</td></tr></table></div>"
  );
}

function saludo(nombre: string | null | undefined) {
  return `<p style="margin:0 0 12px 0;font-size:15px;color:#1a1a1a;">Hola${nombre ? ` ${escaparHtml(nombre.split(" ")[0])}` : ""},</p>`;
}

function titulo(texto: string) {
  return `<h2 style="margin:0 0 14px 0;font-size:19px;color:#0d1b3e;">${texto}</h2>`;
}

// Confirmación al programar una actividad.
export function correoActividadProgramada(a: ActividadCorreo, nombreUsuario: string | null) {
  const t = tipoDe(a);
  const asunto = `Programaste: ${t.icono} ${a.tipo === "otro" && a.tipo_otro ? a.tipo_otro : t.label} con ${a.prospecto.nombre} · ${fechaCorta(a.fecha)}`;
  const html = plantilla(
    saludo(nombreUsuario) +
      titulo("Programaste una actividad de seguimiento") +
      `<p style="margin:0 0 14px 0;font-size:15px;color:#1a1a1a;">📅 <strong>${escaparHtml(fechaLarga(a.fecha))}</strong></p>` +
      tarjetaActividad(a) +
      `<p style="margin:12px 0 0 0;font-size:13px;color:#555;">Ese día a las 9:00 am te llegará un recordatorio con tus actividades pendientes.</p>` +
      boton("Abrir Prospectos")
  );
  return { asunto, html };
}

// Resumen diario: lo de hoy y lo atrasado de una persona.
export function correoResumenDiario(
  nombreUsuario: string | null,
  hoy: ActividadCorreo[],
  atrasadas: ActividadCorreo[]
) {
  const total = hoy.length + atrasadas.length;
  const asunto = hoy.length
    ? `Tus actividades de seguimiento de hoy (${hoy.length})${atrasadas.length ? ` + ${atrasadas.length} atrasada${atrasadas.length === 1 ? "" : "s"}` : ""}`
    : `Tienes ${atrasadas.length} actividad${atrasadas.length === 1 ? "" : "es"} de seguimiento atrasada${atrasadas.length === 1 ? "" : "s"}`;

  const seccion = (texto: string, color: string) =>
    `<p style="margin:18px 0 8px 0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${color};">${texto}</p>`;

  const html = plantilla(
    saludo(nombreUsuario) +
      titulo(total === 1 ? "Tienes 1 actividad de seguimiento" : `Tienes ${total} actividades de seguimiento`) +
      (hoy.length ? seccion(`Para hoy (${hoy.length})`, "#0d1b3e") + hoy.map((a) => tarjetaActividad(a)).join("") : "") +
      (atrasadas.length
        ? seccion(`Atrasadas (${atrasadas.length})`, "#a32d2d") + atrasadas.map((a) => tarjetaActividad(a, { atrasada: true })).join("")
        : "") +
      `<p style="margin:14px 0 0 0;font-size:13px;color:#555;">Cuando las realices, márcalas como completadas en el seguimiento de cada prospecto.</p>` +
      boton("Abrir Prospectos")
  );
  return { asunto, html };
}
