// Utilidades para llenar plantillas de Word (.docx) manipulando
// directamente el XML del documento — mismo mecanismo que lib/pptxHelpers.ts
// usa para .pptx (ambos son contenedores ZIP OOXML), solo que aquí los
// runs de texto van en <w:t> (WordprocessingML) en vez de <a:t>
// (DrawingML, el namespace que usan los slides de PowerPoint).

export { escaparXml, fmtMoneda } from "./pptxHelpers";
import { escaparXml } from "./pptxHelpers";

// Reemplaza TODAS las ocurrencias de un marcador (ej. "{{NOMBRE_CLIENTE}}")
// por su valor real. Cada marcador debe estar como texto completo de un
// solo run (<w:t ...>{{MARCADOR}}</w:t>) en la plantilla — el tag de
// apertura puede traer atributos (Word suele agregar xml:space="preserve"),
// así que se hace match con regex en vez de una tag fija como en pptxHelpers.
function escaparRegex(texto: string) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function reemplazarTodasDocx(xml: string, marcador: string, valorNuevo: string) {
  const patron = new RegExp(`(<w:t[^>]*>)${escaparRegex(marcador)}(</w:t>)`, "g");
  return xml.replace(patron, `$1${escaparXml(valorNuevo)}$2`);
}
