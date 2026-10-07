import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/email";
import { rolPuede } from "@/lib/permisosApi";
import { correoActividadProgramada } from "@/lib/correoSeguimiento";

// Confirmación por correo al programar una actividad de seguimiento
// (app/prospectos/SeguimientoModal.tsx la llama justo después de guardarla).
// Le llega a quien la programó, a su propio correo. Se lee con la sesión del
// usuario, así que RLS solo deja ver actividades de prospectos que puede ver.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("nombre, email, rol").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "seguimientoProspectos")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { actividadId } = await req.json().catch(() => ({ actividadId: null }));
  if (typeof actividadId !== "string") {
    return NextResponse.json({ error: "Falta actividadId" }, { status: 400 });
  }

  const { data: actividad } = await supabase
    .from("prospecto_actividades")
    .select("tipo, tipo_otro, descripcion, fecha, hora, completada, creado_por, prospectos(nombre, telefono, email, empresa, centro)")
    .eq("id", actividadId)
    .single();
  if (!actividad) return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });

  // Solo la persona que la programó recibe la confirmación, y solo si sigue pendiente.
  if (actividad.creado_por !== session.user.id || actividad.completada) {
    return NextResponse.json({ ok: true, enviado: false });
  }

  const prospecto = Array.isArray(actividad.prospectos) ? actividad.prospectos[0] : actividad.prospectos;
  const destinatario = yo?.email || session.user.email;
  if (!prospecto || !destinatario) return NextResponse.json({ ok: true, enviado: false });

  const { asunto, html } = correoActividadProgramada({ ...actividad, prospecto }, yo?.nombre || null);
  const resultado = await enviarCorreo({ to: destinatario, subject: asunto, html });
  if (!resultado.ok) {
    return NextResponse.json({ ok: false, error: resultado.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, enviado: true });
}
