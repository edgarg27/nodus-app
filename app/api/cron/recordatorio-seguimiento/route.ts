import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { rolPuede } from "@/lib/permisosApi";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { type ActividadCorreo, correoResumenDiario } from "@/lib/correoSeguimiento";

// Resumen diario del seguimiento de prospectos (9:00 am, ver
// deploy/cron/iniciar-cron.sh): a cada persona le llega UN correo con sus
// actividades pendientes de hoy y las atrasadas. "Sus" = las que registró
// (creado_por). Mismo patrón de auth que app/api/cron/recordatorio-tours:
// secreto del cron, o sesión de staff para correrlo a mano.
//
// ultimo_recordatorio evita mandar dos veces el mismo día si la tarea se corre
// de nuevo; una atrasada se vuelve a incluir cada día hasta que se palomee.
// No se recuerdan actividades de prospectos ya convertidos o perdidos.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const esCronValido = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!esCronValido) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
    if (!rolPuede(miProfile?.rol, "seguimientoProspectos")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const hoy = hoyMexicoISO();

  const { data: filas, error } = await admin
    .from("prospecto_actividades")
    .select("id, tipo, tipo_otro, descripcion, fecha, hora, creado_por, prospectos(nombre, telefono, email, empresa, centro, estado)")
    .eq("completada", false)
    .lte("fecha", hoy)
    .not("creado_por", "is", null)
    .or(`ultimo_recordatorio.is.null,ultimo_recordatorio.lt.${hoy}`)
    .order("fecha", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Fila = ActividadCorreo & { id: string; creado_por: string };
  const porPersona = new Map<string, Fila[]>();
  for (const fila of filas || []) {
    const prospecto = Array.isArray(fila.prospectos) ? fila.prospectos[0] : fila.prospectos;
    if (!prospecto || prospecto.estado === "convertido" || prospecto.estado === "perdido") continue;
    const lista = porPersona.get(fila.creado_por as string) || [];
    lista.push({ ...fila, creado_por: fila.creado_por as string, prospecto });
    porPersona.set(fila.creado_por as string, lista);
  }

  const resumen = { personas: 0, actividades: 0, errores: [] as string[] };
  if (porPersona.size === 0) return NextResponse.json({ ok: true, ...resumen });

  const { data: perfiles } = await admin
    .from("profiles")
    .select("id, nombre, email")
    .in("id", Array.from(porPersona.keys()));
  const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]));

  for (const [personaId, actividades] of Array.from(porPersona.entries())) {
    const perfil = perfilPorId.get(personaId);
    if (!perfil?.email) {
      resumen.errores.push(`${personaId}: sin correo en profiles`);
      continue;
    }

    const paraHoy = actividades.filter((a) => a.fecha === hoy);
    const atrasadas = actividades.filter((a) => a.fecha < hoy);
    const { asunto, html } = correoResumenDiario(perfil.nombre || null, paraHoy, atrasadas);
    const resultado = await enviarCorreo({ to: perfil.email, subject: asunto, html });

    if (!resultado.ok) {
      resumen.errores.push(`${perfil.email}: ${resultado.error}`);
      continue;
    }
    await admin
      .from("prospecto_actividades")
      .update({ ultimo_recordatorio: hoy })
      .in("id", actividades.map((a) => a.id));
    resumen.personas++;
    resumen.actividades += actividades.length;
  }

  return NextResponse.json({ ok: true, ...resumen });
}
