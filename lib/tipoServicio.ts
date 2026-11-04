// Tipo de servicio de cada contrato (contratos.tipo_servicio, migracion_tipo_servicio.sql). Si el contrato tiene
// oficina sale solo de ella; sin oficina (oficina virtual) se elige a mano. Lo usa "Facturado por servicio".

export const TIPOS_SERVICIO = [
  { clave: "oficina_privada", etiqueta: "Oficina privada" },
  { clave: "coworking", etiqueta: "Coworking" },
  { clave: "working_desk", etiqueta: "Working desk" },
  { clave: "oficina_virtual", etiqueta: "Oficina virtual" },
] as const;

export type TipoServicio = (typeof TIPOS_SERVICIO)[number]["clave"];

export function esTipoServicio(v: unknown): v is TipoServicio {
  return TIPOS_SERVICIO.some((t) => t.clave === v);
}

export function etiquetaTipoServicio(clave: string | null | undefined): string {
  return TIPOS_SERVICIO.find((t) => t.clave === clave)?.etiqueta || "Sin tipo";
}
