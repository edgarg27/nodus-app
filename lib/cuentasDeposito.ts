// Cuentas a las que puede caer un depósito en garantía (columna pagos.cuenta_destino, ver
// migracion_deposito_cuenta.sql). Se elige al marcarlo como realizado en /deposito-garantia.
export const CUENTAS_DEPOSITO = ["IT CREATIVE", "Nova Holding"] as const;
export type CuentaDeposito = (typeof CUENTAS_DEPOSITO)[number];

export function esCuentaDeposito(v: unknown): v is CuentaDeposito {
  return typeof v === "string" && (CUENTAS_DEPOSITO as readonly string[]).includes(v);
}
