import JSZip from "jszip";
import path from "path";
import fs from "fs/promises";
import {
  escaparXml,
  fmtMoneda,
  reemplazarTodas,
  reemplazarSecuencia,
  dividirFilasTabla,
  dividirCeldasFila,
  reemplazarTablaEnSlide,
} from "./pptxHelpers";

// Mismo mecanismo que ya se usa para Sala de Juntas (ver
// lib/cotizacionSalaPptx.ts), extendido a otros tipos de espacio:
// Coworking, Oficina Privada y Working Desk. Working Desk todavía no
// tiene plantilla propia, así que a petición del usuario usa la misma
// plantilla (y el mismo llenado de tabla) que Oficina Privada — ver
// generarPptxCotizacionEspacio más abajo.
//
// NOTA (reconstrucción): este archivo vivía por error guardado como
// lib/cotizacionSalaPptx.ts, pisando la lógica real de Sala de Juntas —
// se movió aquí, a su archivo correcto, y de paso se corrigieron los
// nombres de plantilla de abajo (los .pptx reales en
// public/plantillas-cotizacion/ no llevan guión).
const PLANTILLAS: Record<string, Record<string, string>> = {
  coworking: { Bosques: "BosquesCoworking.pptx" },
  "oficina privada": { Bosques: "BosquesOficinaPrivada.pptx" },
  "working desk": { Bosques: "BosquesOficinaPrivada.pptx" },
};

function normalizarTipo(tipoEspacio: string) {
  return tipoEspacio.trim().toLowerCase();
}

export function centroTienePlantillaCotizacionEspacio(tipoEspacio: string, centro: string) {
  const plantillasDelTipo = PLANTILLAS[normalizarTipo(tipoEspacio)];
  return !!plantillasDelTipo?.[centro];
}

export type AdicionalPptx = {
  concepto: string;
  cantidad: number;
  costoUnitario: number;
};

export type DatosCotizacionEspacio = {
  centro: string;
  tipoEspacio: string; // "Coworking" | "Oficina Privada" (como esté escrito en oficinas.tipo)
  descripcion: string;
  cantidad?: number; // solo lo usa Oficina Privada
  personas?: number; // solo lo usa Oficina Privada
  horasSalaJuntas?: number; // solo lo usa Oficina Privada
  precioUnitario: number;
  totalFila?: number; // solo Coworking: precioUnitario × cantidad de periodos (si no viene, se usa precioUnitario tal cual)
  subtotal: number;
  ivaMonto: number;
  total: number;
  fecha: Date;
  notas?: string;
  nombreDestinatario?: string;
  // Renglones extra que ya vienen cotizados en CotizarForm.tsx (tabla
  // "contrato_adicionales") — ambas plantillas traen renglones en blanco
  // reservados en su tabla de ítems para listarlos ahí (Oficina
  // Privada/Working Desk: hasta 3; Coworking: hasta 4). Si hay más de
  // esos, los que sobran no se listan por separado, pero sí quedan
  // sumados en subtotal/ivaMonto/total (eso se calcula en CotizarForm.tsx
  // antes de llamar aquí).
  adicionales?: AdicionalPptx[];
};

async function cargarPlantilla(tipoEspacio: string, centro: string) {
  const archivo = PLANTILLAS[normalizarTipo(tipoEspacio)]?.[centro];
  if (!archivo) {
    throw new Error(`Sin plantilla de cotización en PowerPoint para "${tipoEspacio}" en "${centro}" todavía.`);
  }
  const ruta = path.join(process.cwd(), "public", "plantillas-cotizacion", archivo);
  const buffer = await fs.readFile(ruta);
  return JSZip.loadAsync(buffer);
}

// --- Renglones opcionales de Adicionales (filas en blanco ya reservadas
// en la tabla de ítems de cada plantilla — mismo mecanismo que usa Sala
// de Juntas para su renglón de Coffee Break, ver
// lib/cotizacionSalaPptx.ts → llenarRenglonCoffee) ---

// Celdas de Oficina Privada/Working Desk llegan vacías SIN ningún <a:r>
// (solo <a:pPr>+<a:endParaRPr>) — se arma el run copiando el mismo estilo
// (Campton Medium 8pt, azul "002060") que ya usan las celdas llenas
// vecinas, y se inserta justo antes de <a:endParaRPr>.
function construirRunOficina(texto: string) {
  const RPR =
    '<a:rPr lang="es-MX" sz="800" b="0" i="0" dirty="0"><a:solidFill><a:srgbClr val="002060"/></a:solidFill><a:latin typeface="Campton Medium" panose="020B0004020102020203" pitchFamily="34" charset="0"/></a:rPr>';
  return `<a:r>${RPR}<a:t>${escaparXml(texto)}</a:t></a:r>`;
}
function llenarCeldaVaciaOficina(celdaXml: string, texto: string) {
  if (!texto) return celdaXml;
  return celdaXml.replace("<a:endParaRPr", construirRunOficina(texto) + "<a:endParaRPr");
}

// La tabla de ítems de Oficina Privada/Working Desk trae 5 filas:
// encabezado, el renglón principal (ya lleno vía reemplazarSecuencia
// arriba) y 3 renglones en blanco reservados para Adicionales. "Personas"
// y "Horas en sala de juntas" no aplican a un adicional, se dejan en "—".
function llenarAdicionalesOficina(tablaItemsXml: string, adicionales?: AdicionalPptx[]) {
  if (!adicionales || adicionales.length === 0) return tablaItemsXml;
  const filas = dividirFilasTabla(tablaItemsXml);
  // filas[0] = preámbulo, filas[1] = encabezado, filas[2] = renglón
  // principal, filas[3..5] = hasta 3 renglones en blanco.
  for (let i = 0; i < Math.min(adicionales.length, 3); i++) {
    const filaIdx = 3 + i;
    if (filaIdx >= filas.length) break;
    const a = adicionales[i];
    const celdas = dividirCeldasFila(filas[filaIdx]);
    // celdas[0] = preámbulo (<a:tr h="...">), celdas[1..5] = Cantidad /
    // Descripción / Personas / Horas / Precio.
    if (celdas.length < 6) continue;
    celdas[1] = llenarCeldaVaciaOficina(celdas[1], String(a.cantidad));
    celdas[2] = llenarCeldaVaciaOficina(celdas[2], a.concepto);
    celdas[3] = llenarCeldaVaciaOficina(celdas[3], "—");
    celdas[4] = llenarCeldaVaciaOficina(celdas[4], "—");
    celdas[5] = llenarCeldaVaciaOficina(celdas[5], fmtMoneda(a.costoUnitario));
    filas[filaIdx] = celdas.join("");
  }
  return filas.join("");
}

// Las celdas en blanco de Coworking SÍ traen ya un run vacío
// (<a:r><a:t></a:t></a:r>) — basta con llenar ese <a:t></a:t>, sin tocar
// el estilo que ya trae ese run.
function llenarCeldaVaciaCoworking(celdaXml: string, texto: string) {
  if (!texto) return celdaXml;
  return celdaXml.replace("<a:t></a:t>", `<a:t>${escaparXml(texto)}</a:t>`);
}

// La tabla de ítems de Coworking trae 6 filas: encabezado, el renglón
// principal y 4 renglones en blanco reservados para Adicionales (Item /
// Descripción / Cantidad / Precio unitario / Total).
function llenarAdicionalesCoworking(tablaItemsXml: string, adicionales?: AdicionalPptx[]) {
  if (!adicionales || adicionales.length === 0) return tablaItemsXml;
  const filas = dividirFilasTabla(tablaItemsXml);
  for (let i = 0; i < Math.min(adicionales.length, 4); i++) {
    const filaIdx = 3 + i;
    if (filaIdx >= filas.length) break;
    const a = adicionales[i];
    const celdas = dividirCeldasFila(filas[filaIdx]);
    if (celdas.length < 6) continue;
    celdas[1] = llenarCeldaVaciaCoworking(celdas[1], String(i + 2)); // Item
    celdas[2] = llenarCeldaVaciaCoworking(celdas[2], a.concepto); // Descripción
    celdas[3] = llenarCeldaVaciaCoworking(celdas[3], String(a.cantidad)); // Cantidad
    celdas[4] = llenarCeldaVaciaCoworking(celdas[4], fmtMoneda(a.costoUnitario)); // Precio unitario
    celdas[5] = llenarCeldaVaciaCoworking(celdas[5], fmtMoneda(a.costoUnitario * a.cantidad)); // Total
    filas[filaIdx] = celdas.join("");
  }
  return filas.join("");
}

async function generarCoworking(datos: DatosCotizacionEspacio): Promise<Buffer> {
  const zip = await cargarPlantilla(datos.tipoEspacio, datos.centro);
  const slidePath = "ppt/slides/slide6.xml";
  let slide = await zip.file(slidePath)?.async("string");
  if (slide) {
    const fechaStr = datos.fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
    slide = reemplazarTodas(slide, "Fecha: 00-00-00", `Fecha: ${fechaStr}`);
    // La descripción de ejemplo viene partida en 3 "runs" de texto
    // distintos ("Coworking Co-" + "n" + "ova 3 meses" = "Coworking
    // Conova 3 meses") — se pone el texto nuevo completo en el primero y
    // se vacían los otros dos para no dejar restos de la plantilla.
    slide = reemplazarTodas(slide, "Coworking Co-", datos.descripcion);
    slide = reemplazarTodas(slide, "n", "");
    slide = reemplazarTodas(slide, "ova 3 meses", "");
    // Precio unitario y Total de la fila — igual que la descripción, cada
    // uno viene partido en "$" + número + ".00 MXN"; se limpia el número
    // y el sufijo de ejemplo y se llena el "$" con el valor completo ya
    // formateado.
    slide = reemplazarTodas(slide, "1,498", "");
    slide = reemplazarTodas(slide, "4,494", "");
    slide = reemplazarTodas(slide, ".00 MXN", "");
    slide = reemplazarSecuencia(slide, "$", [fmtMoneda(datos.precioUnitario), fmtMoneda(datos.totalFila ?? datos.precioUnitario)]);
    // Subtotal / IVA / Total del resumen — valores de ejemplo ya
    // completos en la plantilla, se reemplazan tal cual.
    slide = reemplazarTodas(slide, "$4,498.00", fmtMoneda(datos.subtotal));
    slide = reemplazarTodas(slide, "$719.68.00", fmtMoneda(datos.ivaMonto));
    slide = reemplazarTodas(slide, "$5,217.68", fmtMoneda(datos.total));
    if (datos.notas && datos.notas.trim()) {
      slide = reemplazarTodas(slide, "Notas: Texto ejemplo", `Notas: ${datos.notas.trim()}`);
    }
    if (datos.nombreDestinatario && datos.nombreDestinatario.trim()) {
      slide = reemplazarTodas(slide, "A quién corresponda:", `A quién corresponda: ${datos.nombreDestinatario.trim()}`);
    }
    // Adicionales — renglones en blanco reservados en la tabla de ítems
    // (la primera de las 2 tablas de este slide; la segunda es el
    // resumen Subtotal/IVA/Total, ya llenado arriba). Se hace al final
    // para no interferir con los reemplazos de "$"/"1" de arriba, que
    // cuentan ocurrencias en todo el slide.
    slide = reemplazarTablaEnSlide(slide, 0, (tablaXml) => llenarAdicionalesCoworking(tablaXml, datos.adicionales));
    zip.file(slidePath, slide);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function generarOficinaPrivada(datos: DatosCotizacionEspacio): Promise<Buffer> {
  const zip = await cargarPlantilla(datos.tipoEspacio, datos.centro);
  const slidePath = "ppt/slides/slide5.xml";
  let slide = await zip.file(slidePath)?.async("string");
  if (slide) {
    slide = reemplazarTodas(slide, "Oficina", datos.descripcion);
    // Cantidad, Personas, Horas en sala de juntas y Precio son 4 celdas
    // que en la plantilla traen el mismo texto de ejemplo "1" — solo se
    // distinguen por el orden en que aparecen en la tabla (justo ese
    // orden: Cantidad, Personas, Horas, Precio). Se llenan las 4 de un
    // jalón con reemplazarSecuencia porque el valor real de cualquiera de
    // ellas puede coincidir con el placeholder "1" (ej. 1 persona, 1 mes)
    // — con reemplazos uno por uno esa coincidencia rompería el orden.
    slide = reemplazarSecuencia(slide, "1", [
      String(datos.cantidad ?? 1),
      String(datos.personas ?? 1),
      String(datos.horasSalaJuntas ?? 0),
      fmtMoneda(datos.precioUnitario),
    ]);
    slide = reemplazarSecuencia(slide, "$", [fmtMoneda(datos.subtotal), fmtMoneda(datos.ivaMonto), fmtMoneda(datos.total)]);
    // Adicionales — renglones en blanco reservados en la tabla de ítems
    // (la primera de las 2 tablas de este slide). Al final, por la misma
    // razón que en Coworking: no pisar los conteos de "$"/"1" de arriba.
    slide = reemplazarTablaEnSlide(slide, 0, (tablaXml) => llenarAdicionalesOficina(tablaXml, datos.adicionales));
    zip.file(slidePath, slide);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function generarPptxCotizacionEspacio(datos: DatosCotizacionEspacio): Promise<Buffer> {
  const tipo = normalizarTipo(datos.tipoEspacio);
  if (tipo === "coworking") return generarCoworking(datos);
  // Working Desk usa la misma plantilla y el mismo llenado de tabla que
  // Oficina Privada (no tiene plantilla propia todavía).
  if (tipo === "oficina privada" || tipo === "working desk") return generarOficinaPrivada(datos);
  throw new Error(`Tipo de espacio "${datos.tipoEspacio}" todavía no tiene generador de PowerPoint.`);
}
