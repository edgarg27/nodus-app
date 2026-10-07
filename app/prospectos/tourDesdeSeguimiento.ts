import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyMexicoISO } from "@/lib/fechaMexico";

// Una actividad de seguimiento de tipo "tour" también se agenda en el módulo
// de Tours (app/tours/page.tsx) y queda ligada por prospecto_actividades.tour_id.
// Se comporta igual que un tour agendado ahí: aviso del día en notificaciones y
// correo de confirmación + recordatorios al prospecto si tiene correo.
// Un tour registrado como "Realizada" (ya pasó) se agenda sin correos.

// Mismas opciones que TIPOS_ESPACIO_INTERES en app/tours/page.tsx.
export const ESPACIOS_TOUR = ["Coworking", "Oficina Privada", "Working Desk", "Sala de Juntas"];

// Sugiere el espacio a partir del "Interés" libre del prospecto (ej. "coworking",
// "oficina 2 personas").
export function espacioSugerido(interes: string | null | undefined): string {
  const t = (interes || "").toLowerCase();
  if (t.includes("cowork")) return "Coworking";
  if (t.includes("oficina")) return "Oficina Privada";
  if (t.includes("desk") || t.includes("escritorio")) return "Working Desk";
  if (t.includes("sala") || t.includes("junta")) return "Sala de Juntas";
  return "";
}

export type ProspectoTour = {
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  centro?: string | null;
};

type DatosTour = {
  fecha: string;
  hora?: string | null;
  tipo_espacio_interes?: string | null;
  descripcion: string | null;
};

function notasTour(descripcion: string | null) {
  return ["Agendado desde el seguimiento de prospectos.", descripcion].filter(Boolean).join(" ");
}

// Crea el tour y regresa su id (o un error para avisar sin perder la actividad).
export async function crearTourDeActividad(
  supabase: SupabaseClient,
  prospecto: ProspectoTour,
  datos: DatosTour,
  opciones: { realizada: boolean; usuarioId: string | undefined }
): Promise<{ tourId: string | null; error: string | null }> {
  if (!prospecto.centro) return { tourId: null, error: "El prospecto no tiene centro; no se pudo agendar en Tours." };

  const { data: tour, error } = await supabase
    .from("tours")
    .insert({
      centro: prospecto.centro,
      nombre: prospecto.nombre,
      telefono: prospecto.telefono || null,
      correo: prospecto.email || null,
      fecha: datos.fecha,
      hora: datos.hora ? datos.hora.slice(0, 5) : null,
      tipo_espacio_interes: datos.tipo_espacio_interes ?? null,
      notas: notasTour(datos.descripcion),
      registrado_por: opciones.usuarioId,
      // Ya pasó: que el cron no le mande recordatorios al prospecto.
      ...(opciones.realizada ? { recordatorio_enviado: true, recordatorio_hora_enviado: true } : {}),
    })
    .select("id")
    .single();
  if (error || !tour) return { tourId: null, error: "La actividad se guardó, pero no se pudo agendar en Tours." };

  if (!opciones.realizada) {
    // Igual que agregarTour() en app/tours/page.tsx.
    if (datos.fecha === hoyMexicoISO()) {
      await supabase.from("notificaciones").insert({
        centro: prospecto.centro,
        tipo: "nuevo_tour",
        mensaje: `Hoy tienes un tour que programaste: ${prospecto.nombre}${datos.hora ? ` a las ${datos.hora.slice(0, 5)}` : ""}.`,
      });
    }
    if (prospecto.email) {
      fetch("/api/tours-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourId: tour.id }),
      }).catch(() => {});
    }
  }
  return { tourId: tour.id, error: null };
}

// Cambió la fecha/hora/espacio de la actividad: el tour cambia igual. Si cambió
// la fecha o la hora se reactivan sus recordatorios para la nueva cita.
export async function actualizarTourDeActividad(
  supabase: SupabaseClient,
  tourId: string,
  antes: { fecha: string; hora: string | null },
  datos: DatosTour
): Promise<string | null> {
  const cambioCita = antes.fecha !== datos.fecha || (antes.hora || "").slice(0, 5) !== (datos.hora || "").slice(0, 5);
  const { error } = await supabase
    .from("tours")
    .update({
      fecha: datos.fecha,
      hora: datos.hora ? datos.hora.slice(0, 5) : null,
      tipo_espacio_interes: datos.tipo_espacio_interes ?? null,
      notas: notasTour(datos.descripcion),
      ...(cambioCita ? { recordatorio_enviado: false, recordatorio_hora_enviado: false } : {}),
    })
    .eq("id", tourId);
  return error ? "La actividad se guardó, pero no se pudo actualizar el tour en Tours." : null;
}

export async function borrarTourDeActividad(supabase: SupabaseClient, tourId: string): Promise<string | null> {
  const { error } = await supabase.from("tours").delete().eq("id", tourId);
  return error ? "No se pudo quitar el tour de Tours." : null;
}
