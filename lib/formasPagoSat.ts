// Catálogos del SAT que usa el cuadro "Facturar" (como en ZORA).

// c_FormaPago. "99 Por definir" solo va con pago diferido (PPD) y se pone sola.
export const FORMAS_PAGO_SAT: { clave: string; texto: string }[] = [
  { clave: "01", texto: "Efectivo" },
  { clave: "02", texto: "Cheque nominativo" },
  { clave: "03", texto: "Transferencia electrónica de fondos" },
  { clave: "04", texto: "Tarjeta de crédito" },
  { clave: "05", texto: "Monedero electrónico" },
  { clave: "06", texto: "Dinero electrónico" },
  { clave: "08", texto: "Vales de despensa" },
  { clave: "12", texto: "Dación en pago" },
  { clave: "13", texto: "Pago por subrogación" },
  { clave: "14", texto: "Pago por consignación" },
  { clave: "15", texto: "Condonación" },
  { clave: "17", texto: "Compensación" },
  { clave: "23", texto: "Novación" },
  { clave: "24", texto: "Confusión" },
  { clave: "25", texto: "Remisión de deuda" },
  { clave: "26", texto: "Prescripción o caducidad" },
  { clave: "27", texto: "A satisfacción del acreedor" },
  { clave: "28", texto: "Tarjeta de débito" },
  { clave: "29", texto: "Tarjeta de servicios" },
  { clave: "30", texto: "Aplicación de anticipos" },
  { clave: "31", texto: "Intermediario pagos" },
];

// c_TipoRelacion (CFDI relacionado).
export const TIPOS_RELACION: { clave: string; texto: string }[] = [
  { clave: "01", texto: "Nota de crédito de los documentos relacionados" },
  { clave: "02", texto: "Nota de débito de los documentos relacionados" },
  { clave: "03", texto: "Devolución de mercancía sobre facturas o traslados previos" },
  { clave: "04", texto: "Sustitución de los CFDI previos" },
  { clave: "05", texto: "Traslados de mercancías facturados previamente" },
  { clave: "06", texto: "Factura generada por los traslados previos" },
  { clave: "07", texto: "CFDI por aplicación de anticipo" },
  { clave: "08", texto: "Factura generada por pagos en parcialidades" },
  { clave: "09", texto: "Factura generada por pagos diferidos" },
];

// Periodicidad de la información global (solo cuando se factura a público en general).
export const PERIODICIDADES: { clave: string; texto: string }[] = [
  { clave: "day", texto: "Diario" },
  { clave: "week", texto: "Semanal" },
  { clave: "fortnight", texto: "Quincenal" },
  { clave: "month", texto: "Mensual" },
  { clave: "two_months", texto: "Bimestral" },
];

export const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Separa los UUID que se escriben en el cuadro "CFDI relacionado" (por coma, espacio o renglón).
export function separarUuids(texto: string): string[] {
  return Array.from(new Set(texto.split(/[\s,;]+/).map((u) => u.trim().toLowerCase()).filter(Boolean)));
}
