// Clasifica un pago (pagos.concepto) para poder desglosar ingresos por tipo
// en Ingresos por Centro. Se basa en los textos de concepto que ya usan
// Cotizar, alta-cliente, ContratoModal y el cron de facturación — un solo
// lugar para no repetir la lista si se agrega un concepto nuevo.
export type CategoriaPago = "renta" | "adicionales" | "deposito" | "recargo" | "oficina" | "otro";

export const CATEGORIA_PAGO_INFO: Record<CategoriaPago, { label: string; color: string }> = {
  renta: { label: "Renta", color: "#185FA5" },
  adicionales: { label: "Adicionales / Servicios", color: "#F07E3A" },
  deposito: { label: "Depósitos en garantía", color: "#7B5FBE" },
  recargo: { label: "Recargos por pago tardío", color: "#A32D2D" },
  oficina: { label: "Oficinas agregadas", color: "#0F6E56" },
  otro: { label: "Otros", color: "#888" },
};

export function categorizarPago(concepto: string | null | undefined): CategoriaPago {
  const c = (concepto || "").trim().toLowerCase();
  if (c.startsWith("adicional:")) return "adicionales";
  if (c.startsWith("depósito") || c.startsWith("deposito")) return "deposito";
  if (c.startsWith("recargo")) return "recargo";
  if (c.startsWith("oficina agregada")) return "oficina";
  if (c === "contrato" || c.startsWith("renta mensual")) return "renta";
  return "otro";
}

// Un pago "cubierto" es el que ya entró de verdad. pendiente_spei también
// cuenta como pendiente (se generó el cargo pero no se ha pagado).
export function pagoEstaCubierto(estado: string | null | undefined): boolean {
  return estado === "pagado" || estado === "pagada";
}
