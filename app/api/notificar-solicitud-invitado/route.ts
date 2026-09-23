import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

// Endpoint público (sin sesión) — lo llama la página /agendar-invitado justo
// después de guardar la solicitud, para avisarle al centro. Usa el cliente
// con permisos totales porque quien llama esto no tiene sesión (es un
// visitante sin cuenta) y por lo tanto no podría leer `profiles` ni
// insertar en `notificaciones` bajo las políticas normales de RLS.

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const LABEL_TIPO: Record<string, string> = {
  sala_juntas: "Sala de juntas",
  coworking: "Coworking",
  oficina_privada: "Oficina privada",
  working_desk: "Working desk",
  day_pass_coworking: "Day Pass · Coworking",
  day_pass_oficina_privada: "Day Pass · Oficina privada",
  day_pass_working_desk: "Day Pass · Working desk",
};

// Endpoint público que manda correos: límite por IP para que no sirva para
// llenar de spam la bandeja de las admins.
const MAX_AVISOS = 10;
const VENTANA_MS = 10 * 60 * 1000;

function texto(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

// Todo lo que capturó el invitado se escapa antes de ir dentro del HTML del correo.
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function cuandoTexto(duracion?: string, fecha?: string, fechaFin?: string, horaInicio?: string, horaFin?: string) {
  if (!fecha) return "No indicó fecha";
  const f = fechaLarga(fecha);
  if (duracion === "semana" && fechaFin) return `Semana del ${f} al ${fechaLarga(fechaFin)}`;
  if (duracion === "dia") return `${f} · todo el día${horaInicio ? ` · llega aprox. ${horaInicio}` : ""}`;
  return `${f}${horaInicio && horaFin ? ` · de ${horaInicio} a ${horaFin}` : ""}`;
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`solicitud-invitado:${ipDeRequest(req.headers)}`, MAX_AVISOS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta más tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const tipo = texto(body?.tipo, 40);
  const centro = texto(body?.centro, 60);
  const nombre = texto(body?.nombre, 120);

  if (!tipo || !centro || !nombre || !LABEL_TIPO[tipo] || !CENTROS.includes(centro)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const telefono = texto(body?.telefono, 40);
  const email = texto(body?.email, 120);
  const empresa = texto(body?.empresa, 120);
  const notas = texto(body?.notas, 500);
  const duracion = texto(body?.duracion, 10);
  const fecha = texto(body?.fecha, 10);
  const fechaFin = texto(body?.fechaFin, 10);
  const horaInicio = texto(body?.horaInicio, 5);
  const horaFin = texto(body?.horaFin, 5);

  const admin = createAdminClient();
  const label = LABEL_TIPO[tipo];
  const cuando = cuandoTexto(duracion, fecha, fechaFin, horaInicio, horaFin);

  // 1) Notificación dentro de la app (la campanita del panel del centro).
  await admin.from("notificaciones").insert({
    centro,
    tipo: "nueva_solicitud_invitado",
    mensaje: `🙋 ${nombre} pidió "${label}" para ${cuando} — revisa la pestaña Invitados.`,
  });

  // 2) Correo a los admins del centro con todos los detalles de la solicitud.
  const { data: admins } = await admin.from("profiles").select("email").eq("rol", "admin").eq("centro", centro);
  const destinos = Array.from(new Set((admins || []).map((a) => a.email).filter(Boolean))) as string[];

  if (destinos.length > 0) {
    const fila = (k: string, v?: string) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td><strong>${esc(v)}</strong></td></tr>` : "");
    const html = `
      <p>Hay una nueva solicitud de invitado en <strong>${esc(centro)}</strong>.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${fila("Servicio", label)}
        ${fila("Cuándo", cuando)}
        ${fila("Nombre", nombre)}
        ${fila("Teléfono", telefono)}
        ${fila("Correo", email)}
        ${fila("Empresa", empresa)}
        ${fila("Comentarios", notas)}
      </table>
      <p>Revísala y confírmala en el panel, pestaña <strong>Invitados</strong>.</p>
    `;
    for (const to of destinos) {
      // Best-effort: si el correo falla, la notificación en la app ya quedó.
      await enviarCorreo({ to, subject: `Nueva solicitud: ${label} — ${nombre}`, html }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true });
}
