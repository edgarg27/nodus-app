// Horas Cowork (antes "Horas Bolsa"): el banco de horas de un contrato para
// usar Coworking / Sala de Capacitación.
//
// Cómo se cuentan:
//   - Al agendar, las horas quedan APARTADAS (reservación pendiente o
//     confirmada).
//   - Cuando recepción registra la llegada, pasan a CONSUMIDAS
//     (reservaciones.horas_cobradas, que recepción puede ajustar).
//   - Si el cliente cancela con menos de HORAS_ANTICIPACION_CANCELACION horas
//     de anticipación, las horas se cobran (lo aplica un trigger en la base,
//     ver migracion_horas_cowork.sql) y quedan CONSUMIDAS. Si no llega y no
//     avisa, siguen apartadas: cuentan igual, así que también se pierden.
//   - Rechazada o cancelada a tiempo: no cuentan, se devuelven.
//
// Ventana: un contrato de término fijo de ~1 mes (el paquete "30 Horas") tiene
// un banco ÚNICO que vale durante toda su vigencia. Cualquier otro contrato
// renueva su banco cada mes calendario.

export const HORAS_ANTICIPACION_CANCELACION = 2;
const DIAS_MAX_VIGENCIA_UNICA = 35;

// Mismo criterio que la clasificación de espacios en /reservaciones: todo lo
// que no es Sala de Juntas consume Horas Cowork.
export function esEspacioCowork(espacio: string | null | undefined) {
  const e = espacio || "";
  return e.startsWith("Coworking") || e.startsWith("Sala de Capacitación");
}

const pad = (n: number) => String(n).padStart(2, "0");
function isoLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type ContratoHoras = { fecha_inicio?: string | null; fecha_vencimiento?: string | null };
export type VentanaHoras = {
  desde: string; // YYYY-MM-DD, inclusive
  hasta: string; // YYYY-MM-DD, inclusive
  porVigencia: boolean; // true = banco único durante toda la vigencia del contrato
};

export function ventanaHoras(contrato: ContratoHoras, hoy: Date = new Date()): VentanaHoras {
  const ini = contrato.fecha_inicio?.slice(0, 10);
  const fin = contrato.fecha_vencimiento?.slice(0, 10);
  if (ini && fin) {
    const dias = (Date.parse(fin) - Date.parse(ini)) / 86400000;
    if (dias >= 0 && dias <= DIAS_MAX_VIGENCIA_UNICA) return { desde: ini, hasta: fin, porVigencia: true };
  }
  return {
    desde: isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: isoLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
    porVigencia: false,
  };
}

export type ReservaHoras = {
  hora_inicio: string | null;
  hora_fin: string | null;
  estado: string;
  horas_cobradas?: number | null;
  asistencia?: string | null;
};

function minutos(hhmm: string) {
  const [h, m] = hhmm.split(":");
  return parseInt(h) * 60 + (parseInt(m) || 0);
}

// Horas que dura la reservación tal como se agendó.
export function horasPlaneadas(r: { hora_inicio?: string | null; hora_fin?: string | null }) {
  if (!r.hora_inicio || !r.hora_fin) return 0;
  return Math.max(minutos(r.hora_fin) - minutos(r.hora_inicio), 0) / 60;
}

export type SaldoHoras = { totales: number; consumidas: number; apartadas: number; disponibles: number };

export function saldoHoras(totales: number, reservas: ReservaHoras[]): SaldoHoras {
  let consumidas = 0;
  let apartadas = 0;
  for (const r of reservas) {
    if (r.estado === "rechazada") continue;
    if (r.horas_cobradas != null) consumidas += Number(r.horas_cobradas);
    else if (r.estado === "pendiente" || r.estado === "confirmada") apartadas += horasPlaneadas(r);
  }
  return { totales, consumidas, apartadas, disponibles: Math.max(totales - consumidas - apartadas, 0) };
}

export function fmtHoras(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ¿Cancelar ahora todavía devuelve las horas? Solo es para avisarle al
// cliente antes de confirmar: la regla real la aplica la base de datos.
export function cancelaATiempo(fecha: string, horaInicio: string | null, ahora: Date = new Date()) {
  if (!horaInicio) return true;
  const [y, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const [h, min] = horaInicio.split(":");
  const inicio = new Date(y, m - 1, d, parseInt(h), parseInt(min) || 0);
  return inicio.getTime() - ahora.getTime() >= HORAS_ANTICIPACION_CANCELACION * 3600000;
}
