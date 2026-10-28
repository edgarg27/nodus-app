// Periodos de los reportes de /reportes (este mes, mes pasado, últimos 3/6 meses, este año, fechas a elegir y,
// donde aplica, todo el historial). Fechas "AAAA-MM-DD" en horario de México.
export type Periodo = "mes" | "mes_pasado" | "3m" | "6m" | "anio" | "otro" | "todo";

export const OPCIONES_PERIODO: { valor: Periodo; label: string }[] = [
  { valor: "mes", label: "Este mes" },
  { valor: "mes_pasado", label: "Mes pasado" },
  { valor: "3m", label: "Últimos 3 meses" },
  { valor: "6m", label: "Últimos 6 meses" },
  { valor: "anio", label: "Este año" },
  { valor: "otro", label: "Otras fechas…" },
];

// "todo" devuelve fechas vacías (el reporte lee todo el historial).
export function rango(periodo: Periodo, hoy: string, desde: string, hasta: string) {
  const [a, m] = hoy.split("-").map(Number);
  const iso = (y: number, mes: number, d: number) => new Date(Date.UTC(y, mes - 1, d)).toISOString().slice(0, 10);
  if (periodo === "todo") return { desde: "", hasta: "" };
  if (periodo === "mes") return { desde: iso(a, m, 1), hasta: hoy };
  if (periodo === "mes_pasado") return { desde: iso(a, m - 1, 1), hasta: iso(a, m, 0) };
  if (periodo === "3m") return { desde: iso(a, m - 2, 1), hasta: hoy };
  if (periodo === "6m") return { desde: iso(a, m - 5, 1), hasta: hoy };
  if (periodo === "anio") return { desde: `${a}-01-01`, hasta: hoy };
  return { desde, hasta };
}

export const moneda = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
