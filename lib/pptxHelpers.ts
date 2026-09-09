// Utilidades compartidas para llenar plantillas de PowerPoint (.pptx)
// manipulando directamente el XML de sus slides (sin ninguna librería de
// PowerPoint) — usadas tanto por cotizacionSalaPptx.ts como por
// cotizacionEspacioPptx.ts. Antes vivían duplicadas en cada archivo; se
// movieron aquí al reconstruir cotizacionSalaPptx.ts (ver notas ahí) para
// no tener dos copias del mismo criterio de reemplazo.

export function escaparXml(texto: string) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function fmtMoneda(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

export function reemplazarTodas(xml: string, valorViejo: string, valorNuevo: string) {
  const buscado = `<a:t>${valorViejo}</a:t>`;
  const nuevo = `<a:t>${escaparXml(valorNuevo)}</a:t>`;
  return xml.split(buscado).join(nuevo);
}

// Reemplaza VARIAS ocurrencias del mismo texto de una sola vez, cada una
// con su propio valor nuevo (valoresNuevos[0] va en la 1a ocurrencia,
// valoresNuevos[1] en la 2a, etc.) — a diferencia de un reemplazo simple,
// esto SÍ funciona aunque el valor nuevo sea igual al viejo (ej. rellenar
// una celda que decía "1" con el número "1" real), porque calcula todas
// las posiciones ANTES de tocar el texto y las llena de atrás hacia
// adelante, así los índices ya encontrados nunca se invalidan.
export function reemplazarSecuencia(xml: string, valorViejo: string, valoresNuevos: string[]) {
  const buscado = `<a:t>${valorViejo}</a:t>`;
  const indices: number[] = [];
  let desde = 0;
  while (indices.length < valoresNuevos.length) {
    const idx = xml.indexOf(buscado, desde);
    if (idx === -1) break;
    indices.push(idx);
    desde = idx + buscado.length;
  }
  for (let i = indices.length - 1; i >= 0; i--) {
    const nuevoTag = `<a:t>${escaparXml(valoresNuevos[i])}</a:t>`;
    xml = xml.slice(0, indices[i]) + nuevoTag + xml.slice(indices[i] + buscado.length);
  }
  return xml;
}

// --- Utilidades para llenar renglones "en blanco" reservados en una
// tabla (ej. Coffee Break en Sala de Juntas, Adicionales en Oficina
// Privada/Coworking) — varias plantillas traen filas de más ya
// insertadas en la tabla, sin texto, listas para usarse.

// Divide el XML de una tabla (<a:tbl>...</a:tbl>) en sus filas, o el XML
// de una fila (<a:tr ...>...</a:tr>) en sus celdas — el primer elemento
// del array resultante es siempre el preámbulo antes de la primera
// etiqueta buscada (tblPr/tblGrid en el caso de filas, el propio
// "<a:tr...>" en el caso de celdas), no una fila/celda real.
export function dividirFilasTabla(tablaXml: string) {
  return tablaXml.split(/(?=<a:tr[ >])/g);
}
export function dividirCeldasFila(filaXml: string) {
  return filaXml.split(/(?=<a:tc>)/g);
}

// Extrae la tabla número `indice` (0 = primera) del XML de un slide y
// permite reemplazarla por una versión transformada — necesario cuando
// un slide trae más de una tabla (ej. tabla de ítems + tabla-resumen de
// Subtotal/IVA/Total) para no mezclar un find/replace de una con la
// otra. Si el índice no existe, regresa el slide sin tocar.
export function reemplazarTablaEnSlide(slideXml: string, indice: number, transformar: (tablaXml: string) => string) {
  const tablas = [...slideXml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)];
  const match = tablas[indice];
  if (!match || match.index == null) return slideXml;
  const nuevaTabla = transformar(match[0]);
  return slideXml.slice(0, match.index) + nuevaTabla + slideXml.slice(match.index + match[0].length);
}
