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

// `ocupadoPor`: quién la tiene (nombre · empresa), para que el staff sepa
// con quién choca sin ir a buscar el contrato.
export type ResultadoDisponibilidad = { disponible: boolean; motivo?: string; ocupadoPor?: string };

// "2026-12-31" → "31/12/2026", sin pasar por Date (evita el corrimiento
// de un día por zona horaria).
function fechaCorta(iso: string | null | undefined) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

async function nombresPorUserId(supabase: SupabaseClient, userIds: (string | null)[]) {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
  if (ids.length === 0) return {} as Record<string, { nombre: string | null; empresa: string | null }>;
  const { data } = await supabase.from("profiles").select("id, nombre, empresa").in("id", ids);
  return Object.fromEntries((data || []).map((p) => [p.id, { nombre: p.nombre, empresa: p.empresa }])) as Record<
    string,
    { nombre: string | null; empresa: string | null }
  >;
}

function unirNombre(nombre: string | null | undefined, empresa: string | null | undefined) {
  return [nombre, empresa].filter((x) => x && x.trim()).join(" · ") || "un cliente";
}

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
    .select("id, fecha_inicio, fecha_vencimiento, user_id, cliente_nombre_historico, cliente_empresa_historico")
    .eq("oficina_id", oficinaId)
    .eq("estatus", "vigente")
    .lte("fecha_inicio", fechaFin)
    .gte("fecha_vencimiento", fechaInicio);

  if (contratosChocando && contratosChocando.length > 0) {
    // Mismo criterio que Contratos: con cuenta → su perfil; sin cuenta
    // (contrato manual) → el nombre/empresa histórico del contrato.
    const perfiles = await nombresPorUserId(supabase, contratosChocando.map((c) => c.user_id));
    const quienes = contratosChocando.map((c) => {
      const p = c.user_id ? perfiles[c.user_id] : undefined;
      return unirNombre(p?.nombre || c.cliente_nombre_historico, p?.empresa || c.cliente_empresa_historico);
    });
    const c0 = contratosChocando[0];
    return {
      disponible: false,
      ocupadoPor: Array.from(new Set(quienes)).join(", "),
      motivo:
        contratosChocando.length === 1
          ? `Contrato vigente del ${fechaCorta(c0.fecha_inicio)} al ${fechaCorta(c0.fecha_vencimiento)}, traslapa con ese rango de fechas.`
          : "Tiene contratos vigentes que traslapan con ese rango de fechas.",
    };
  }

  // Reservaciones (modalidad Hora/Día) — `fecha`/`fecha_fin` son columnas
  // text con formato ISO, la comparación lexicográfica funciona igual que
  // con date.
  if (modalidad === "Hora" || modalidad === "Día") {
    const { data: reservacionesChocando } = await supabase
      .from("reservaciones")
      .select("id, fecha, fecha_fin, hora_inicio, hora_fin, user_id")
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
      const perfiles = await nombresPorUserId(supabase, traslape.map((r) => r.user_id));
      const quienes = traslape.map((r) => {
        const p = r.user_id ? perfiles[r.user_id] : undefined;
        return unirNombre(p?.nombre, p?.empresa);
      });
      return {
        disponible: false,
        ocupadoPor: Array.from(new Set(quienes)).join(", "),
        motivo: "Tiene una reservación que traslapa con esa fecha/hora.",
      };
    }
  }

  return { disponible: true };
}
