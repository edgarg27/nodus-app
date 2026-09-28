import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { ubicacionCentro } from "@/lib/centros";
import { rolPuede } from "@/lib/permisosApi";

// Recordatorio por correo UNA HORA ANTES del tour (el de un día antes vive
// en ../recordatorio-tours). Corre cada 10 minutos (deploy/cron) y manda el
// correo a los tours de hoy que empiezan dentro de la siguiente hora.
// Mismo patrón de auth que los otros crons: secreto del cron, o sesión de
// staff para correrlo a mano.

const ZONA = "America/Mexico_City";

// Fecha (YYYY-MM-DD) y minutos del día en hora de México, sin depender de
// la zona del servidor.
function ahoraMexico() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value || "00";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, minutos: Number(v("hour")) * 60 + Number(v("minute")) };
}

function minutosDeHora(hora: string | null): number | null {
  const m = String(hora || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hora12(min: number) {
  const h = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "a.m." : "p.m."}`;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const esCronValido = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!esCronValido) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
    if (!rolPuede(miProfile?.rol, "recordatorioTours")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const { fecha, minutos: ahora } = ahoraMexico();

  const { data: tours, error } = await admin
    .from("tours")
    .select("*")
    .eq("fecha", fecha)
    .not("correo", "is", null)
    .not("hora", "is", null)
    .eq("recordatorio_hora_enviado", false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resumen = { mandados: 0, errores: [] as string[] };

  for (const tour of tours || []) {
    const inicio = minutosDeHora(tour.hora);
    if (inicio === null) continue;
    const faltan = inicio - ahora;
    // Solo los que empiezan dentro de la siguiente hora (con margen por la
    // frecuencia del cron) y que no han empezado.
    if (faltan <= 0 || faltan > 65) continue;

    const html = `
      <p>Hola ${tour.nombre},</p>
      <p>Te recordamos que tu tour en <strong>${tour.centro}</strong> es <strong>hoy a las ${hora12(inicio)}</strong>, en aproximadamente una hora.</p>
      ${tour.tipo_espacio_interes ? `<p>Vamos a mostrarte especialmente: <strong>${tour.tipo_espacio_interes}</strong>.</p>` : ""}
      <p>Ubicación: ${ubicacionCentro(tour.centro)}</p>
      <p>Si se te complica llegar, contáctanos. ¡Te esperamos!</p>
    `;
    const resultado = await enviarCorreo({
      to: tour.correo,
      subject: `Tu tour en ${tour.centro} es en una hora`,
      html,
    });
    if (resultado.ok) {
      await admin.from("tours").update({ recordatorio_hora_enviado: true }).eq("id", tour.id);
      resumen.mandados++;
    } else {
      resumen.errores.push(`${tour.id}: ${resultado.error}`);
    }
  }

  return NextResponse.json({ ok: true, ...resumen });
}
