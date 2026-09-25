// Etapa de un contrato pre-aprobado dentro del flujo por pasos (ver
// migracion_contratos_por_pasos.sql). Se calcula solo con columnas de
// `contratos`, así sirve igual en la lista, el modal y el panel de ventas.

export type DatosPasosContrato = {
  enviado_a_ventas_at?: string | null;
  enviado_a_firma_at?: string | null;
  archivo_firmado_url?: string | null;
};

export type EtapaContrato = "preparando" | "con_ventas" | "firmado";

export function etapaContrato(c: DatosPasosContrato): EtapaContrato {
  if (c.archivo_firmado_url) return "firmado";
  // enviado_a_firma_at es de cuando Ventas marcaba "ya lo subí a Cincel"; se
  // conserva por los contratos que ya estaban en ese paso.
  if (c.enviado_a_ventas_at || c.enviado_a_firma_at) return "con_ventas";
  return "preparando";
}

export const ETAPA_LABEL: Record<EtapaContrato, string> = {
  preparando: "📝 Preparando contrato",
  con_ventas: "💼 Con ventas · en firma",
  firmado: "✅ Firmado · por aprobar",
};
