// Forma de pago de un contrato:
//   adelantado → todo el periodo se cobra al aprobar el contrato.
//   mensual    → solo Oficina Privada: renta mes a mes, del día 1 al 10;
//                pasado el día 10 sin pagar, la siguiente factura incluye
//                un recargo del 3% por ese mes.
export type FormaPago = "adelantado" | "mensual";

export const DIA_LIMITE_PAGO_MENSUAL = 10;
export const RECARGO_PAGO_TARDIO = 0.03;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function esOficinaPrivada(tipoEspacio: string | null | undefined): boolean {
  return (tipoEspacio || "").trim().toLowerCase() === "oficina privada";
}

// Cotizar calcula el precio de TODO el periodo (tarifa × meses); en mes a
// mes el contrato guarda la renta de un solo mes, ya con IVA.
export function rentaMensualConIva(precioNetoPeriodo: number, meses: number): number {
  return round2(precioNetoPeriodo / Math.max(1, meses));
}

// El recargo es el 3% de la renta SIN IVA y a ese total se le cobra IVA;
// eso equivale a 3% de la renta que ya trae IVA.
export function recargoConIva(rentaMensualConIvaIncluido: number): number {
  return round2(rentaMensualConIvaIncluido * RECARGO_PAGO_TARDIO);
}

export function etiquetaFormaPago(f: string | null | undefined): string | null {
  if (f === "mensual") return "Mes a mes";
  if (f === "adelantado") return "Por adelantado";
  return null;
}
