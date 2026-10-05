// El Estacionamiento y el Teléfono (DID) son los adicionales que llevan IVA (16%). En la base
// (contrato_adicionales.costo_unitario / monto) se guarda SIN IVA, pero a
// staff y clientes se les muestra —y se les cobra— ya con IVA incluido, sin
// mencionarlo, igual que en Cotizar.
const FACTOR_IVA = 1.16;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function llevaIva(concepto: string): boolean {
  return concepto.trim().toLowerCase() === "estacionamiento" || esDid(concepto);
}

// Monto (sin IVA) → monto a mostrar/cobrar.
export function conIva(concepto: string, monto: number): number {
  return llevaIva(concepto) ? round2(monto * FACTOR_IVA) : monto;
}

// Monto capturado por el staff (ya con IVA) → monto que se guarda (sin IVA).
export function sinIva(concepto: string, montoCapturado: number): number {
  return llevaIva(concepto) ? round2(montoCapturado / FACTOR_IVA) : montoCapturado;
}

// Teléfono: el servicio de teléfono va incluido, pero si el cliente contrata
// un número propio (DID) se cobra $100 extra al mes ("Teléfono (DID)" en el
// catálogo de adicionales, $100 + IVA). La extensión para comunicarse con recepción es
// gratis ("Extensión telefónica", $0) y solo queda registrada en el contrato.
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function esDid(concepto: string): boolean {
  return /\bdid\b/.test(sinAcentos(concepto));
}

// Adicionales que se cobran CADA MES junto con la renta (además de la vez que
// se cobran al aprobar el contrato, que cuenta como el primer mes): el
// Estacionamiento y el DID. Para sumar otro, agrégalo aquí y ya entra tanto a
// la facturación mensual como al "Total por pagar al mes" de Mi Contrato.
export function esCobroMensual(concepto: string): boolean {
  return sinAcentos(concepto) === "estacionamiento" || esDid(concepto);
}

// Suma (con IVA donde aplique) lo que se cobra cada mes por adicionales.
export function totalAdicionalesMensuales(items: { concepto: string; monto: number | null }[]): number {
  const total = items
    .filter((a) => esCobroMensual(a.concepto))
    .reduce((s, a) => s + conIva(a.concepto, Number(a.monto) || 0), 0);
  return round2(total);
}

// Cobros adicionales sueltos (/adicionales): lo que el admin le cobra a un
// cliente fuera de su contrato. Cada tipo trae la clave del SAT con la que se
// factura (lib/facturapi.ts). Las de copias y frituras y la genérica de "Otro"
// están por confirmar con el contador. El monto que se captura y se cobra ya
// lleva IVA incluido, igual que el resto de los cobros.
export const TIPOS_COBRO_ADICIONAL = [
  { clave: "sala_juntas", etiqueta: "Hora extra de sala de juntas", concepto: "Hora extra de sala de juntas", satProdServ: "80131500", satUnidad: "E48" },
  { clave: "copias", etiqueta: "Copias / impresiones", concepto: "Copias e impresiones", satProdServ: "82121700", satUnidad: "H87" },
  { clave: "botanas", etiqueta: "Frituras y botanas", concepto: "Frituras y botanas", satProdServ: "50192100", satUnidad: "H87" },
  { clave: "otro", etiqueta: "Otro", concepto: "", satProdServ: "01010101", satUnidad: "E48" },
] as const;

export type TipoCobroAdicional = (typeof TIPOS_COBRO_ADICIONAL)[number]["clave"];

export function tipoCobroAdicional(clave: string | null | undefined) {
  return TIPOS_COBRO_ADICIONAL.find((t) => t.clave === clave) || null;
}

// Concepto que se guarda en el cobro: "Copias e impresiones (x50)".
export function conceptoCobroAdicional(concepto: string, cantidad: number) {
  const base = concepto.trim();
  return cantidad === 1 ? base : `${base} (x${cantidad})`;
}

// Nombre del cobro para mostrarlo al CLIENTE: sin "(incl. IVA)" / "(con IVA)".
// El monto sí incluye el IVA, pero la palabra no se le muestra (misma regla
// que en Cotizar para depósito y estacionamiento). El concepto guardado en la
// base no cambia: otras partes lo buscan por su nombre exacto.
export function conceptoParaCliente(concepto: string | null | undefined, porDefecto = "Pago") {
  const limpio = String(concepto || "")
    .replace(/\s*\((?:incl\.?|incluye|con|m[aá]s|\+)\s*IVA\)/gi, "")
    .trim();
  return limpio || porDefecto;
}
