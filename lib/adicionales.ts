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

// Productos y servicios que se cobran y se facturan: es el listado de claves del SAT que dio el
// área de facturación (con su descripción oficial). Sirve para los cobros adicionales
// (/adicionales) y para el tipo de servicio al facturar (Facturas > + Nueva factura); cada uno trae
// la clave y la unidad del SAT con las que se timbra (lib/facturapi.ts). La unidad no venía en el
// listado: servicios = E48, piezas (copias, impresiones, llaves, tarjetas) = H87; por confirmar
// con el contador. El monto que se captura y se cobra ya lleva IVA incluido.
export const TIPOS_COBRO_ADICIONAL = [
  { clave: "acabados_remodelacion", etiqueta: "Acabados interiores y remodelación", concepto: "Acabados interiores y remodelación", satProdServ: "72153600", satUnidad: "E48" },
  { clave: "alimentos", etiqueta: "Alimentos", concepto: "Alimentos", satProdServ: "90101700", satUnidad: "E48" },
  { clave: "coffee_break", etiqueta: "Coffee break", concepto: "Coffee break", satProdServ: "90101700", satUnidad: "E48" },
  { clave: "copias", etiqueta: "Copias", concepto: "Copias", satProdServ: "82121700", satUnidad: "H87" },
  { clave: "duplicado_llaves", etiqueta: "Duplicado de llaves", concepto: "Duplicado de llaves", satProdServ: "72101505", satUnidad: "H87" },
  { clave: "estacionamiento", etiqueta: "Estacionamiento", concepto: "Estacionamiento", satProdServ: "95121644", satUnidad: "E48" },
  { clave: "impresiones", etiqueta: "Impresiones", concepto: "Impresiones", satProdServ: "82121500", satUnidad: "H87" },
  { clave: "internet", etiqueta: "Internet", concepto: "Internet", satProdServ: "81112100", satUnidad: "E48" },
  { clave: "mantenimiento", etiqueta: "Mantenimiento", concepto: "Mantenimiento", satProdServ: "72102900", satUnidad: "E48" },
  { clave: "paqueteria", etiqueta: "Paquetería", concepto: "Paquetería", satProdServ: "78102205", satUnidad: "E48" },
  { clave: "penalizacion_mora", etiqueta: "Penalización por mora", concepto: "Penalización por mora", satProdServ: "84101702", satUnidad: "E48" },
  { clave: "renta_oficina_privada", etiqueta: "Renta de oficina privada", concepto: "Renta de oficina privada", satProdServ: "80131502", satUnidad: "E48" },
  { clave: "coworking", etiqueta: "Coworking", concepto: "Coworking", satProdServ: "80161504", satUnidad: "E48" },
  { clave: "reparacion_oficinas", etiqueta: "Reparación y renovación de oficinas", concepto: "Reparación y renovación de oficinas", satProdServ: "72121103", satUnidad: "E48" },
  { clave: "sala_juntas", etiqueta: "Sala de juntas", concepto: "Hora extra de sala de juntas", satProdServ: "90111603", satUnidad: "E48" },
  { clave: "tarjeta_acceso", etiqueta: "Tarjeta de acceso", concepto: "Tarjeta de acceso", satProdServ: "46171619", satUnidad: "H87" },
  { clave: "telefonia", etiqueta: "Telefonía", concepto: "Telefonía", satProdServ: "83111501", satUnidad: "E48" },
  { clave: "otro", etiqueta: "Otro", concepto: "", satProdServ: "01010101", satUnidad: "E48" },
] as const;

export type TipoCobroAdicional = (typeof TIPOS_COBRO_ADICIONAL)[number]["clave"];

export function tipoCobroAdicional(clave: string | null | undefined) {
  return TIPOS_COBRO_ADICIONAL.find((t) => t.clave === clave) || null;
}

// Claves que ya se guardaron en cobros anteriores y que ya no se ofrecen: se siguen entendiendo
// (para timbrar y mostrar el nombre) pero no salen en las listas.
const TIPOS_ANTERIORES: readonly { clave: string; etiqueta: string; satProdServ: string; satUnidad: string }[] = [
  { clave: "botanas", etiqueta: "Frituras y botanas", satProdServ: "90101700", satUnidad: "E48" },
  { clave: "oficina_privada", etiqueta: "Oficina privada", satProdServ: "80131502", satUnidad: "E48" },
  { clave: "working_desk", etiqueta: "Working desk", satProdServ: "80161504", satUnidad: "E48" },
  { clave: "membresias", etiqueta: "Membresías", satProdServ: "80161504", satUnidad: "E48" },
  { clave: "mostrador", etiqueta: "Mostrador", satProdServ: "01010101", satUnidad: "H87" },
];

// Tipos de servicio al facturar un cobro: los mismos del listado, sin el concepto sugerido.
// Sin tipo = renta del espacio del cliente (Coworking u oficina privada, ver lib/facturapi.ts).
export const TIPOS_SERVICIO_FACTURA: readonly { clave: string; etiqueta: string; satProdServ: string; satUnidad: string }[] = TIPOS_COBRO_ADICIONAL.map(
  ({ clave, etiqueta, satProdServ, satUnidad }) => ({ clave, etiqueta, satProdServ, satUnidad })
);

export function tipoServicioFactura(clave: string | null | undefined) {
  return TIPOS_SERVICIO_FACTURA.find((t) => t.clave === clave) || TIPOS_ANTERIORES.find((t) => t.clave === clave) || null;
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

// El primer pago de un contrato se guarda con el concepto "Contrato": es el pago de la mensualidad.
export function etiquetaPagoSuelto(concepto: string | null | undefined) {
  const c = conceptoParaCliente(concepto, "Pago");
  return c.trim().toLowerCase() === "contrato" ? "Pago de mensualidad" : c;
}
