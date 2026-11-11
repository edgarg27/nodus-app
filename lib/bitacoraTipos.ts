// Tipos y etiquetas de la bitácora SIN dependencias de servidor, para poder usarlos también
// desde componentes de cliente (la pantalla de bitácora) sin arrastrar el service role al navegador.

export type AccionBitacora =
  | "pago_registrado" // se creó un cargo/pago
  | "pago_marcado_pagado" // se marcó como pagado
  | "factura_integrada" // se integró un estado de cuenta
  | "factura_timbrada" // se emitió el CFDI
  | "factura_cancelada" // se canceló ante el SAT
  | "factura_borrada" // se borró un estado de cuenta sin timbrar
  | "factura_pagada"; // se marcó la factura como pagada

// Texto legible de cada acción.
export const TEXTO_ACCION: Record<AccionBitacora, string> = {
  pago_registrado: "Registró un cargo",
  pago_marcado_pagado: "Marcó como pagado",
  factura_integrada: "Integró un estado de cuenta",
  factura_timbrada: "Timbró la factura (CFDI)",
  factura_cancelada: "Canceló la factura",
  factura_borrada: "Borró un estado de cuenta",
  factura_pagada: "Marcó la factura como pagada",
};

export function textoAccion(accion: string): string {
  return (TEXTO_ACCION as Record<string, string>)[accion] || accion;
}
