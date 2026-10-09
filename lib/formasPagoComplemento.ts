// Formas de pago del SAT que se ofrecen al emitir un complemento de pago (nunca "99":
// un complemento declara cómo se pagó de verdad). Archivo aparte, sin código de
// servidor, para poder usarlo también en pantallas.
export const FORMAS_PAGO_COMPLEMENTO: { clave: string; texto: string }[] = [
  { clave: "03", texto: "03 · Transferencia electrónica de fondos" },
  { clave: "04", texto: "04 · Tarjeta de crédito" },
  { clave: "28", texto: "28 · Tarjeta de débito" },
  { clave: "01", texto: "01 · Efectivo" },
  { clave: "02", texto: "02 · Cheque nominativo" },
];
