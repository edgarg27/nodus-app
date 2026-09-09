import { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export type ModalidadDisponibilidad = "Hora" | "Día" | "Semana" | "Mes";

export type ParametrosDisponibilidad = {
  oficinaId: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string;
  modalidad: ModalidadDisponibilidad;
  horaInicio?: number;
  horaFin?: number;
};

export type ResultadoDisponibilidad = { disponible: boolean; motivo?: string };

// La disponibilidad nunca usa `oficinas.estado` para decidir — ese campo
// es un flag sin fecha, no dice nada sobre si se libera antes del rango
// que se está cotizando. El cálculo real sale de cruzar fechas contra
// contratos/reservaciones.
export async function verificarDisponibilidadOficina(
  supabase: SupabaseClient,
  params: ParametrosDisponibilidad
): Promise<ResultadoDisponibilidad> {
  const { oficinaId, fechaInicio, fechaFin, modalidad, horaInicio, horaFin } = params;

  // Solo contratos `vigente` cuentan como ocupación real — uno
  // `pre_aprobado` todavía puede rechazarse, no debe bloquear la
  // disponibilidad de otro prospecto. Choque de rango de fechas clásico,
  // aplica para cualquier modalidad (una oficina con contrato vigente no
  // se presta ni por hora).
  const { data: contratosChocando } = await supabase
    .from("contratos")
    .select("id, fecha_inicio, fecha_vencimiento")
    .eq("oficina_id", oficinaId)
    .eq("estatus", "vigente")
    .lte("fecha_inicio", fechaFin)
    .gte("fecha_vencimiento", fechaInicio);

  if (contratosChocando && contratosChocando.length > 0) {
    return { disponible: false, motivo: "Esta oficina ya tiene un contrato vigente que traslapa con ese rango de fechas." };
  }

  // Reservaciones (modalidad Hora/Día) — `fecha`/`fecha_fin` son columnas
  // text con formato ISO, la comparación lexicográfica funciona igual que
  // con date.
  if (modalidad === "Hora" || modalidad === "Día") {
    const { data: reservacionesChocando } = await supabase
      .from("reservaciones")
      .select("id, fecha, fecha_fin, hora_inicio, hora_fin")
      .eq("oficina_id", oficinaId)
      .in("estado", ["pendiente", "confirmada"])
      .lte("fecha", fechaFin)
      .gte("fecha_fin", fechaInicio);

    const traslape = (reservacionesChocando || []).filter((r) => {
      if (modalidad !== "Hora" || horaInicio == null || horaFin == null) return true;
      if (!r.hora_inicio || !r.hora_fin) return true;
      const ini = parseInt(r.hora_inicio.split(":")[0]);
      const fin = parseInt(r.hora_fin.split(":")[0]);
      return horaInicio < fin && horaFin > ini;
    });

    if (traslape.length > 0) {
      return { disponible: false, motivo: "Esta oficina ya tiene una reservación que traslapa con esa fecha/hora." };
    }
  }

  return { disponible: true };
}
