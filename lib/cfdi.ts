// Parseo de CFDI (XML → objeto tipado), sin dependencias — corre en el
// navegador con DOMParser nativo. Busca los elementos por nombre local
// en vez de tag calificado (getElementsByTagNameNS("*", nombre) con
// fallback a getElementsByTagName) para no importar si el XML es CFDI
// 3.3 o 4.0 — ambas versiones usan los mismos nombres de
// tag/atributo para lo que se lee aquí.

export type CfdiConcepto = {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
};

export type CfdiImpuesto = {
  tipo: "traslado" | "retencion";
  impuesto: string;
  tasaOCuota: string;
  importe: number;
};

export type CfdiParseado = {
  uuidCfdi: string;
  serie: string;
  folioFiscal: string;
  rfcEmisor: string;
  nombreEmisor: string;
  rfcReceptor: string;
  nombreReceptor: string;
  total: number;
  subtotal: number;
  iva: number;
  retenciones: number;
  moneda: string;
  tipoComprobante: string;
  formaPago: string;
  metodoPago: string;
  usoCfdi: string;
  fecha: string;
  conceptos: CfdiConcepto[];
  impuestos: CfdiImpuesto[];
};

function porNombreLocal(root: Document | Element, nombre: string): Element[] {
  let nodos = Array.from(root.getElementsByTagNameNS("*", nombre));
  if (nodos.length === 0) {
    nodos = Array.from(root.getElementsByTagName(nombre)).filter(
      (n) => n.localName === nombre || n.tagName === nombre || n.tagName.endsWith(":" + nombre)
    );
  }
  return nodos;
}

function num(valor: string | null | undefined): number {
  const n = parseFloat(valor || "0");
  return isNaN(n) ? 0 : n;
}

export function normalizarRfc(rfc: string): string {
  return rfc.trim().toUpperCase();
}

export function nombreBase(nombreArchivo: string): string {
  return nombreArchivo.replace(/\.[^./\\]+$/, "").toLowerCase();
}

export function parsearCfdi(xmlText: string): { data: CfdiParseado | null; error?: string } {
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, "application/xml");
  } catch {
    return { data: null, error: "No se pudo leer el XML" };
  }

  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { data: null, error: "XML mal formado" };
  }

  const comprobante = porNombreLocal(doc, "Comprobante")[0];
  if (!comprobante) {
    return { data: null, error: "No se encontró el nodo Comprobante" };
  }

  const timbre = porNombreLocal(doc, "TimbreFiscalDigital")[0];
  const uuidCfdi = timbre?.getAttribute("UUID") || "";
  if (!uuidCfdi) {
    return { data: null, error: "El CFDI no trae UUID (TimbreFiscalDigital)" };
  }

  const emisor = porNombreLocal(comprobante, "Emisor")[0];
  const receptor = porNombreLocal(comprobante, "Receptor")[0];
  const rfcReceptor = receptor?.getAttribute("Rfc") || "";
  if (!rfcReceptor) {
    return { data: null, error: "El CFDI no trae RFC de receptor" };
  }

  const conceptos: CfdiConcepto[] = porNombreLocal(comprobante, "Concepto").map((c) => ({
    descripcion: c.getAttribute("Descripcion") || "",
    cantidad: num(c.getAttribute("Cantidad")),
    valorUnitario: num(c.getAttribute("ValorUnitario")),
    importe: num(c.getAttribute("Importe")),
  }));

  // Solo el nodo Impuestos a nivel Comprobante (los totales del CFDI),
  // no los traslados/retenciones por línea dentro de cada Concepto.
  const impuestosNodo = porNombreLocal(comprobante, "Impuestos").find(
    (n) => n.parentElement === comprobante
  );
  const impuestos: CfdiImpuesto[] = impuestosNodo
    ? [
        ...porNombreLocal(impuestosNodo, "Traslado").map((n) => ({
          tipo: "traslado" as const,
          impuesto: n.getAttribute("Impuesto") || "",
          tasaOCuota: n.getAttribute("TasaOCuota") || "",
          importe: num(n.getAttribute("Importe")),
        })),
        ...porNombreLocal(impuestosNodo, "Retencion").map((n) => ({
          tipo: "retencion" as const,
          impuesto: n.getAttribute("Impuesto") || "",
          tasaOCuota: n.getAttribute("TasaOCuota") || "",
          importe: num(n.getAttribute("Importe")),
        })),
      ]
    : [];

  const iva = impuestos.filter((i) => i.tipo === "traslado").reduce((acc, i) => acc + i.importe, 0);
  const retenciones = impuestos.filter((i) => i.tipo === "retencion").reduce((acc, i) => acc + i.importe, 0);

  return {
    data: {
      uuidCfdi,
      serie: comprobante.getAttribute("Serie") || "",
      folioFiscal: comprobante.getAttribute("Folio") || "",
      rfcEmisor: emisor?.getAttribute("Rfc") || "",
      nombreEmisor: emisor?.getAttribute("Nombre") || "",
      rfcReceptor,
      nombreReceptor: receptor?.getAttribute("Nombre") || "",
      total: num(comprobante.getAttribute("Total")),
      subtotal: num(comprobante.getAttribute("SubTotal")),
      iva,
      retenciones,
      moneda: comprobante.getAttribute("Moneda") || "MXN",
      tipoComprobante: comprobante.getAttribute("TipoDeComprobante") || "",
      formaPago: comprobante.getAttribute("FormaPago") || "",
      metodoPago: comprobante.getAttribute("MetodoPago") || "",
      usoCfdi: receptor?.getAttribute("UsoCFDI") || "",
      fecha: comprobante.getAttribute("Fecha") || "",
      conceptos,
      impuestos,
    },
  };
}
