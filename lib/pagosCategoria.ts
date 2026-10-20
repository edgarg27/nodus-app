import { TIPOS_COBRO_ADICIONAL, conceptoParaCliente, tipoServicioFactura } from "@/lib/adicionales";

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

// Nombres de los servicios adicionales del catálogo, para reconocerlos aunque el concepto se haya escrito a mano
// (por ejemplo, pagos migrados de ZORA: "Copias octubre").
const ADICIONALES_CONOCIDOS = TIPOS_COBRO_ADICIONAL.filter((t) => t.clave !== "otro" && !t.clave.startsWith("renta") && t.clave !== "coworking").map(
  (t) => ({ etiqueta: t.etiqueta, claves: [t.etiqueta, t.concepto].filter(Boolean).map((x) => x.toLowerCase()) })
);

export function categorizarPago(concepto: string | null | undefined, adicionalTipo?: string | null): CategoriaPago {
  if (adicionalTipo) return "adicionales";
  const c = (concepto || "").trim().toLowerCase();
  if (c.startsWith("adicional:")) return "adicionales";
  if (c.startsWith("depósito") || c.startsWith("deposito")) return "deposito";
  if (c.startsWith("recargo")) return "recargo";
  if (c.startsWith("oficina agregada")) return "oficina";
  if (c === "contrato" || c.startsWith("renta") || c.startsWith("mensualidad") || c === "pago de mensualidad") return "renta";
  if (ADICIONALES_CONOCIDOS.some((a) => a.claves.some((k) => c.includes(k)))) return "adicionales";
  return "otro";
}

// "Qué se vendió": el servicio concreto de un pago, para el ranking de Ingresos por Centro. La renta se separa por
// tipo de espacio (Coworking, Oficina Privada, Working Desk) y los adicionales por servicio (Copias, Sala de juntas…).
export function servicioDePago(
  concepto: string | null | undefined,
  adicionalTipo: string | null | undefined,
  tipoEspacio: string | null | undefined
): string {
  const cat = categorizarPago(concepto, adicionalTipo);
  if (cat === "renta") return tipoEspacio ? `Renta · ${tipoEspacio}` : "Renta";
  if (cat === "deposito") return "Depósito en garantía";
  if (cat === "recargo") return "Recargos por pago tardío";
  if (cat === "oficina") return "Oficinas agregadas";
  if (cat === "adicionales") {
    const porTipo = adicionalTipo && adicionalTipo !== "otro" ? tipoServicioFactura(adicionalTipo)?.etiqueta : null;
    if (porTipo) return porTipo;
    const c = (concepto || "").toLowerCase();
    const conocido = ADICIONALES_CONOCIDOS.find((a) => a.claves.some((k) => c.includes(k)));
    if (conocido) return conocido.etiqueta;
  }
  const limpio = conceptoParaCliente(concepto, "Otros")
    .replace(/^adicional:\s*/i, "")
    .replace(/\s*\(x\d+\)\s*$/i, "")
    .trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "Otros";
}

// Un pago "cubierto" es el que ya entró de verdad. pendiente_spei también
// cuenta como pendiente (se generó el cargo pero no se ha pagado).
export function pagoEstaCubierto(estado: string | null | undefined): boolean {
  return estado === "pagado" || estado === "pagada";
}
