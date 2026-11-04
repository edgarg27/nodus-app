import { FORMAS_PAGO_SAT } from "@/lib/formasPagoSat";

// Cómo paga normalmente cada cliente (profiles.metodo_pago_habitual y forma_pago_habitual, migracion_pago_habitual.sql).
// Se propone al integrar por lote, al timbrar desde el estado de cuenta y al registrar su pago en Cobranza.

export const METODOS_PAGO = [
  { clave: "PUE", texto: "PUE · pago en una sola exhibición" },
  { clave: "PPD", texto: "PPD · pago en parcialidades o diferido" },
] as const;

export function esMetodoPago(v: unknown): v is "PUE" | "PPD" {
  return v === "PUE" || v === "PPD";
}

// "Por definir" (99) no es una forma con la que se pague.
export function esFormaPagoHabitual(v: unknown): v is string {
  return typeof v === "string" && v !== "99" && FORMAS_PAGO_SAT.some((f) => f.clave === v);
}

export function textoFormaPago(clave: string | null | undefined): string {
  return FORMAS_PAGO_SAT.find((f) => f.clave === clave)?.texto || "";
}

// "PUE · Transferencia electrónica de fondos" para mostrarlo en la lista; vacío si no tiene.
export function textoPagoHabitual(p: { metodo_pago_habitual?: string | null; forma_pago_habitual?: string | null }): string {
  return [p.metodo_pago_habitual, textoFormaPago(p.forma_pago_habitual)].filter(Boolean).join(" · ");
}
