// Horario de Sala de Juntas: qué horas se pueden reservar y cuáles son "fuera
// de horario" (se cobran extra y recepción tiene que quedarse). Lo comparten el
// calendario del cliente (/reservaciones), el de Cotizar y el del Panel de Centro.

// Horas de INICIO que muestra el calendario: de 7:00 a 22:00, o sea reservas de
// 7am a 11pm. El horario normal es de 8am a 8pm entre semana; todo lo demás se
// puede pedir, pero como fuera de horario.
export const HORA_PRIMER_SLOT = 7;
export const HORA_ULTIMO_SLOT = 22;
export const HORAS_CALENDARIO = Array.from(
  { length: HORA_ULTIMO_SLOT - HORA_PRIMER_SLOT + 1 },
  (_, i) => HORA_PRIMER_SLOT + i
);

// Horario normal: lunes a viernes de 8am a 8pm, sábado de 8am a 2pm.
const HORA_APERTURA = 8;
const HORA_CIERRE_SEMANA = 20;
const HORA_CIERRE_SABADO = 14;

// Festivos oficiales de México (ajusta/agrega según el año)
export const DIAS_FESTIVOS_MX = [
  "2026-01-01", // Año Nuevo
  "2026-02-02", // Día de la Constitución (observado)
  "2026-03-16", // Natalicio de Benito Juárez (observado)
  "2026-05-01", // Día del Trabajo
  "2026-09-16", // Independencia
  "2026-11-16", // Revolución (observado)
  "2026-12-25", // Navidad
];

export const TEXTO_FUERA_DE_HORARIO =
  "domingo, festivo, antes de las 8am, sábado después de las 2pm o entre semana después de las 8pm";

export function esFueraDeHorario(fechaISO: string, hora: number) {
  if (DIAS_FESTIVOS_MX.includes(fechaISO)) return true;
  const dia = new Date(fechaISO + "T00:00:00").getDay(); // 0 = domingo, 6 = sábado
  if (dia === 0) return true; // domingo, todo el día
  if (hora < HORA_APERTURA) return true; // antes de abrir
  if (dia === 6) return hora >= HORA_CIERRE_SABADO;
  return hora >= HORA_CIERRE_SEMANA;
}

// Salas que se pueden reservar por centro, en el orden en que se intenta
// asignar una cotización aceptada (mismas que el calendario del Panel de Centro).
const SALAS_POR_CENTRO: Record<string, string[]> = {
  Bosques: ["Sala de 10 personas"],
};
const SALAS_DEFAULT = ["Sala de Juntas A", "Sala de Juntas B"];

export function salasDelCentro(centro: string) {
  return SALAS_POR_CENTRO[centro] || SALAS_DEFAULT;
}

// La cotización de Sala guarda el horario dentro de `tipo_espacio`, con el
// formato que produce formatHora() de CotizarForm: "… · 4 horas · 10:00 AM - 2:00 PM".
export function parseHorarioSala(tipoEspacio: string | null | undefined): { horaInicio: number; horaFin: number } | null {
  const m = (tipoEspacio || "").match(/(\d{1,2}):00\s*(AM|PM)\s*-\s*(\d{1,2}):00\s*(AM|PM)/i);
  if (!m) return null;
  const a24 = (h: string, ap: string) => {
    const n = parseInt(h) % 12;
    return ap.toUpperCase() === "PM" ? n + 12 : n;
  };
  const horaInicio = a24(m[1], m[2]);
  const horaFin = a24(m[3], m[4]) || 24; // "12:00 AM" al final = medianoche
  return horaFin > horaInicio ? { horaInicio, horaFin } : null;
}
