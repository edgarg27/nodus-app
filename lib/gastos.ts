// Semáforo y estado de pago de los gastos (app/gastos, app/ingresos-centro y
// /api/gastos/revisar). La admin elige la urgencia al registrar; si el gasto
// sigue pendiente y su fecha límite está a 3 días o menos (o ya pasó), se
// muestra en rojo aunque lo hayan registrado en verde o amarillo.

export type Urgencia = "verde" | "amarillo" | "rojo";
export type EstadoPago = "pendiente" | "pagado" | "no_pagado";

export const URGENCIAS: { id: Urgencia; label: string; color: string; fondo: string }[] = [
  { id: "verde", label: "No urgente", color: "#22A06B", fondo: "#E3F5EC" },
  { id: "amarillo", label: "Algo urgente", color: "#C98A00", fondo: "#FFF4D6" },
  { id: "rojo", label: "Urgente", color: "#D64545", fondo: "#FBE4E4" },
];

export const ESTADOS_PAGO: Record<EstadoPago, { label: string; color: string; fondo: string }> = {
  pendiente: { label: "Por pagar", color: "#8A5A00", fondo: "#FFF4D6" },
  pagado: { label: "Pagado", color: "#0F6E56", fondo: "#E3F5EC" },
  no_pagado: { label: "No se paga", color: "#A32D2D", fondo: "#FBE4E4" },
};

const DIAS_PARA_ROJO = 3;

function diasHasta(fechaISO: string, hoyISO: string) {
  const [y1, m1, d1] = hoyISO.split("-").map(Number);
  const [y2, m2, d2] = fechaISO.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function urgenciaEfectiva(
  g: { urgencia?: string | null; fecha_limite_pago?: string | null; estado_pago?: string | null },
  hoyISO: string
): Urgencia {
  const elegida = (["verde", "amarillo", "rojo"].includes(g.urgencia || "") ? g.urgencia : "verde") as Urgencia;
  if ((g.estado_pago || "pendiente") === "pendiente" && g.fecha_limite_pago && diasHasta(g.fecha_limite_pago, hoyISO) <= DIAS_PARA_ROJO) {
    return "rojo";
  }
  return elegida;
}

// Texto corto de la fecha límite: "Vence hoy", "Vence en 2 días", "Venció hace 1 día".
export function textoFechaLimite(fechaISO: string, hoyISO: string) {
  const d = diasHasta(fechaISO, hoyISO);
  if (d === 0) return "Vence hoy";
  if (d > 0) return `Vence en ${d} día${d === 1 ? "" : "s"}`;
  return `Venció hace ${-d} día${d === -1 ? "" : "s"}`;
}

export function urgenciaInfo(u: Urgencia) {
  return URGENCIAS.find((x) => x.id === u) || URGENCIAS[0];
}
