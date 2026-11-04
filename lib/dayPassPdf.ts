// Day Pass en PDF: el boleto dibujado con jsPDF (no una captura de la pantalla), del tamaño de un boleto, para
// descargarlo o imprimirlo completo. Lo usan el Panel de Centro (al generarlo) y la página del invitado.

export type DayPassParaPdf = {
  nombre: string;
  fecha: string;
  centro: string;
  emitidoPor?: string | null;
  tipo: string; // "coworking" | "working_desk" | "oficina_privada"
  folio: number | string;
  qr?: string; // data URL del QR (PNG)
};

const TEXTO_TIPO: Record<string, { etiqueta: string; frase: string }> = {
  coworking: { etiqueta: "Coworking", frase: "nuestro coworking" },
  working_desk: { etiqueta: "Working Desk", frase: "tu working desk" },
  oficina_privada: { etiqueta: "Oficina Privada", frase: "tu oficina privada" },
};

export async function descargarDayPassPdf(p: DayPassParaPdf) {
  const { jsPDF } = await import("jspdf");
  // Boleto de 90 × 150 mm.
  const ancho = 90;
  const alto = 150;
  const doc = new jsPDF({ unit: "mm", format: [ancho, alto], orientation: "portrait" });
  const folio = String(p.folio).padStart(3, "0");
  const tipo = TEXTO_TIPO[p.tipo] || { etiqueta: p.tipo, frase: "nuestro coworking" };

  // Fondo
  doc.setFillColor(13, 27, 62);
  doc.rect(0, 0, ancho, alto, "F");

  // Encabezado
  doc.setTextColor(240, 126, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("NODUS FLEX CENTER", 8, 12);
  doc.setFillColor(240, 126, 58);
  doc.roundedRect(ancho - 8 - 30, 7.5, 30, 6, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.text(tipo.etiqueta.toUpperCase(), ancho - 8 - 15, 11.6, { align: "center" });

  doc.setFontSize(24);
  doc.text("DAY PASS", 8, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 205, 220);
  doc.text(`Disfruta de trabajar un día en ${tipo.frase}`, 8, 35);

  // Datos
  const dato = (etiqueta: string, valor: string, x: number, y: number, maxAncho: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 160, 185);
    doc.text(etiqueta.toUpperCase(), x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(doc.splitTextToSize(valor || "—", maxAncho).slice(0, 2), x, y + 5);
  };
  dato("Nombre", p.nombre, 8, 46, 74);
  dato("Fecha", p.fecha, 8, 62, 34);
  dato("Centro", p.centro, 48, 62, 34);
  dato("Emite", p.emitidoPor || "—", 8, 78, 74);

  // Perforación
  doc.setDrawColor(150, 160, 185);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(6, 94, ancho - 6, 94);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(255, 255, 255);
  doc.circle(0, 94, 3, "F");
  doc.circle(ancho, 94, 3, "F");

  // QR y folio
  if (p.qr) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(8, 101, 38, 38, 2, 2, "F");
    doc.addImage(p.qr, "PNG", 10, 103, 34, 34);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(150, 160, 185);
  doc.text(`NODUS-${folio}`, 8, 144);
  doc.text("FOLIO", ancho - 8, 108, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(255, 255, 255);
  doc.text(folio, ancho - 8, 124, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(150, 160, 185);
  doc.text("Presenta este pase en recepción", ancho - 8, 132, { align: "right" });

  doc.save(`day-pass-NODUS-${folio}.pdf`);
}

// WhatsApp directo al número del invitado: 10 dígitos de México → con 52 delante. Vacío si no hay número válido.
export function linkWhatsApp(telefono: string | null | undefined, mensaje: string): string {
  let d = String(telefono || "").replace(/\D/g, "");
  if (d.length === 10) d = "52" + d;
  if (d.length < 11) return "";
  return `https://wa.me/${d}?text=${encodeURIComponent(mensaje)}`;
}
