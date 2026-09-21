// El Estacionamiento es el único adicional que lleva IVA (16%). En la base
// (contrato_adicionales.costo_unitario / monto) se guarda SIN IVA, pero a
// staff y clientes se les muestra —y se les cobra— ya con IVA incluido, sin
// mencionarlo, igual que en Cotizar.
const FACTOR_IVA = 1.16;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function llevaIva(concepto: string): boolean {
  return concepto.trim().toLowerCase() === "estacionamiento";
}

// Monto (sin IVA) → monto a mostrar/cobrar.
export function conIva(concepto: string, monto: number): number {
  return llevaIva(concepto) ? round2(monto * FACTOR_IVA) : monto;
}

// Monto capturado por el staff (ya con IVA) → monto que se guarda (sin IVA).
export function sinIva(concepto: string, montoCapturado: number): number {
  return llevaIva(concepto) ? round2(montoCapturado / FACTOR_IVA) : montoCapturado;
}

// Adicionales que se cobran CADA MES junto con la renta (además de la vez que
// se cobran al aprobar el contrato, que cuenta como el primer mes). Hoy solo
// el Estacionamiento; para sumar otro, agrégalo aquí y ya entra tanto a la
// facturación mensual como al "Total por pagar al mes" de Mi Contrato.
const ADICIONALES_MENSUALES = ["estacionamiento"];

export function esCobroMensual(concepto: string): boolean {
  return ADICIONALES_MENSUALES.includes(concepto.trim().toLowerCase());
}

// Suma (con IVA donde aplique) lo que se cobra cada mes por adicionales.
export function totalAdicionalesMensuales(items: { concepto: string; monto: number | null }[]): number {
  const total = items
    .filter((a) => esCobroMensual(a.concepto))
    .reduce((s, a) => s + conIva(a.concepto, Number(a.monto) || 0), 0);
  return round2(total);
}
