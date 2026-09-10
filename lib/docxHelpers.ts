// Utilidades para llenar plantillas de Word (.docx) manipulando
// directamente el XML del documento — mismo mecanismo que lib/pptxHelpers.ts
// usa para .pptx (ambos son contenedores ZIP OOXML), solo que aquí los
// runs de texto van en <w:t> (WordprocessingML) en vez de <a:t>
// (DrawingML, el namespace que usan los slides de PowerPoint).

export { escaparXml, fmtMoneda } from "./pptxHelpers";
import { escaparXml } from "./pptxHelpers";

// Reemplaza TODAS las ocurrencias de un marcador (ej. "{{NOMBRE_CLIENTE}}")
// por su valor real, dentro de cualquier <w:t>...</w:t> de la plantilla —
// el marcador puede ser todo el contenido de la etiqueta o compartirla con
// texto literal (ej. "{{FECHA_INICIO}} al {{FECHA_FIN}}" en un solo run,
// como quedan las plantillas reales de contrato tras insertar marcadores
// sobre texto que Word ya traía en una sola etiqueta).
export function reemplazarTodasDocx(xml: string, marcador: string, valorNuevo: string) {
  return xml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (completo, atributos, contenido) => {
    if (!contenido.includes(marcador)) return completo;
    const nuevoContenido = contenido.split(marcador).join(escaparXml(valorNuevo));
    return `<w:t${atributos}>${nuevoContenido}</w:t>`;
  });
}
