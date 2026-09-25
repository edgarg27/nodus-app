// Etapa de un contrato pre-aprobado dentro del flujo por pasos (ver
// migracion_contratos_por_pasos.sql). Se calcula solo con columnas de
// `contratos`, así sirve igual en la lista, el modal y el panel de ventas.

export type DatosPasosContrato = {
  enviado_a_ventas_at?: string | null;
  enviado_a_firma_at?: string | null;
  archivo_firmado_url?: string | null;
};

export type EtapaContrato = "preparando" | "con_ventas" | "en_cincel" | "firmado";

export function etapaContrato(c: DatosPasosContrato): EtapaContrato {
  if (c.archivo_firmado_url) return "firmado";
  if (c.enviado_a_firma_at) return "en_cincel";
  if (c.enviado_a_ventas_at) return "con_ventas";
  return "preparando";
}

export const ETAPA_LABEL: Record<EtapaContrato, string> = {
  preparando: "📝 Preparando contrato",
  con_ventas: "💼 Con ventas · por subir a Cincel",
  en_cincel: "📨 En Cincel · esperando firmas",
  firmado: "✅ Firmado · por aprobar",
};

export const MENSAJE_VENTAS_DEFAULT =
  "Ya está en Cincel. Solo hay que esperar a que llegue al correo de la administradora el contrato firmado por ambas partes; se está trabajando en la firma.";
