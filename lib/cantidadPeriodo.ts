// Texto de la columna "Cantidad" de la cotización: el número de periodos con su unidad ("1 mes", "2 meses",
// "3 semanas", "5 horas"…), para que se entienda qué se está cotizando y no salga solo "1" o "2".
const UNIDADES: Record<string, [string, string]> = {
  Hora: ["hora", "horas"],
  Día: ["día", "días"],
  Semana: ["semana", "semanas"],
  Mes: ["mes", "meses"],
};

export function textoCantidadPeriodo(cantidad: number, modalidad?: string | null) {
  const n = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1;
  const [uno, varios] = UNIDADES[modalidad || ""] || UNIDADES.Mes;
  return `${n} ${n === 1 ? uno : varios}`;
}
