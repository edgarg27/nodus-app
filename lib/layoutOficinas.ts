import JSZip from "jszip";
import { escaparXml } from "./pptxHelpers";

// Marca en la diapositiva "Layout · Centro de negocios" del PowerPoint de
// cotización la(s) oficina(s) que se están cotizando: un recuadro azul
// semitransparente encima de la oficina (se siguen viendo los escritorios
// del plano) y una etiqueta "Oficina 12". Antes las chicas lo pintaban a
// mano en el PowerPoint.
//
// El plano es UNA sola imagen dentro de la plantilla, así que no se puede
// recolorear una oficina: se dibuja una forma encima, en la posición de
// esa oficina. Las posiciones de abajo están en pixeles de la imagen
// original del plano (medidas sobre su color de piso) y se escalan al
// tamaño y lugar que tenga la imagen en la diapositiva. Si Diseño sube en
// /diseno/plantillas un plano con OTRO acomodo, hay que volver a medirlas.

type Punto = [number, number];

type LayoutCentro = {
  anchoImagen: number;
  altoImagen: number;
  // número de oficina (oficinas.numero) → contorno de la oficina. Las que
  // comparten cuarto en el plano (8-9, 15-16, 18-19, 29-30) marcan el
  // cuarto completo.
  oficinas: Record<string, Punto[]>;
};

function rect(x1: number, y1: number, x2: number, y2: number): Punto[] {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

const CUARTO_8_9 = rect(1071, 183, 1205, 311);
const CUARTO_15_16 = rect(891, 468, 998, 600);
const CUARTO_18_19: Punto[] = [
  [703, 468],
  [818, 468],
  [818, 600],
  [750, 600],
  [750, 585],
  [703, 585],
];
const CUARTO_29_30: Punto[] = [
  [49, 183],
  [167, 183],
  [167, 318],
  [143, 318],
  [143, 412],
  [113, 446],
  [49, 446],
];

const LAYOUTS: Record<string, LayoutCentro> = {
  Bosques: {
    anchoImagen: 1276,
    altoImagen: 961,
    oficinas: {
      // Planta alta
      "1": rect(947, 51, 1000, 180),
      // La 2 rodea a la 3 (que queda en su esquina inferior izquierda).
      "2": [
        [813, 51],
        [941, 51],
        [941, 180],
        [884, 180],
        [884, 134],
        [813, 134],
      ],
      "3": rect(813, 136, 882, 180),
      "4": rect(757, 51, 808, 180),
      "5": rect(703, 51, 751, 180),
      "6": rect(751, 225, 811, 308),
      "7": rect(816, 225, 876, 308),
      "8": CUARTO_8_9,
      "9": CUARTO_8_9,
      "10": rect(1074, 316, 1136, 397),
      "11": rect(1141, 316, 1205, 397),
      "12": rect(1141, 469, 1205, 600),
      "13": rect(1073, 469, 1136, 600),
      "14": rect(1004, 469, 1068, 600),
      "15": CUARTO_15_16,
      "16": CUARTO_15_16,
      "17": rect(824, 469, 883, 600),
      "18": CUARTO_18_19,
      "19": CUARTO_18_19,
      "20": rect(835, 315, 891, 397),
      "21": rect(896, 315, 956, 397),
      "22": rect(961, 315, 1025, 396),
      // Planta baja
      "23": rect(357, 307, 440, 372),
      "24": rect(357, 378, 440, 445),
      "25": rect(337, 451, 440, 600),
      "26": rect(243, 451, 332, 600),
      "27": rect(248, 362, 306, 446),
      "28": rect(184, 361, 242, 446),
      "29": CUARTO_29_30,
      "30": CUARTO_29_30,
      "31": rect(173, 183, 241, 317),
      "32": rect(246, 183, 310, 318),
    },
  },
};

// Azul de la marca (el mismo "002060" de los textos de la plantilla).
const COLOR_MARCA = "002060";
const OPACIDAD_RELLENO = 45000; // 45 %
const ANCHO_ETIQUETA = 594360; // 0.65 in
const ALTO_ETIQUETA = 192024; // 0.21 in

export function centroTieneLayoutOficinas(centro: string) {
  return !!LAYOUTS[centro];
}

// Busca la diapositiva del plano (la que dice "Layout") y la imagen más
// grande dentro de ella; regresa su posición y tamaño en EMU.
function ubicarPlano(slideXml: string) {
  if (!slideXml.includes("<a:t>Layout</a:t>")) return null;
  let mejor: { x: number; y: number; cx: number; cy: number } | null = null;
  for (const m of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const off = m[0].match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = m[0].match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!off || !ext) continue;
    const pic = { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) };
    if (!mejor || pic.cx * pic.cy > mejor.cx * mejor.cy) mejor = pic;
  }
  return mejor;
}

function siguienteId(slideXml: string) {
  let max = 0;
  for (const m of slideXml.matchAll(/<p:cNvPr id="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

function formaOficina(id: number, numero: string, puntos: [number, number][]) {
  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cx = Math.max(1, Math.max(...xs) - x0);
  const cy = Math.max(1, Math.max(...ys) - y0);
  const [primero, ...resto] = puntos;
  const ruta =
    `<a:moveTo><a:pt x="${primero[0] - x0}" y="${primero[1] - y0}"/></a:moveTo>` +
    resto.map((p) => `<a:lnTo><a:pt x="${p[0] - x0}" y="${p[1] - y0}"/></a:lnTo>`).join("") +
    "<a:close/>";
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Oficina cotizada ${escaparXml(numero)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
    `<a:pathLst><a:path w="${cx}" h="${cy}">${ruta}</a:path></a:pathLst></a:custGeom>` +
    `<a:solidFill><a:srgbClr val="${COLOR_MARCA}"><a:alpha val="${OPACIDAD_RELLENO}"/></a:srgbClr></a:solidFill>` +
    `<a:ln w="28575"><a:solidFill><a:srgbClr val="${COLOR_MARCA}"/></a:solidFill></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-MX"/></a:p></p:txBody></p:sp>`
  );
}

function formaEtiqueta(id: number, texto: string, centroX: number, centroY: number) {
  const x = Math.round(centroX - ANCHO_ETIQUETA / 2);
  const y = Math.round(centroY - ALTO_ETIQUETA / 2);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Etiqueta ${escaparXml(texto)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${ANCHO_ETIQUETA}" cy="${ALTO_ETIQUETA}"/></a:xfrm>` +
    `<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${COLOR_MARCA}"/></a:solidFill>` +
    `<a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="es-MX" sz="750" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>` +
    `<a:latin typeface="Campton Medium" panose="020B0004020102020203" pitchFamily="34" charset="0"/></a:rPr>` +
    `<a:t>${escaparXml(texto)}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

// numeros = oficinas.numero de las oficinas cotizadas (ej. ["12"] o, al
// agregar una oficina a un contrato, ["12", "13"]). Si el centro no tiene
// plano medido, la plantilla no trae la diapositiva "Layout" o el número
// no está en el plano, no hace nada (el PowerPoint sale igual que antes).
export async function marcarOficinasEnLayout(zip: JSZip, centro: string, numeros: string[]) {
  const layout = LAYOUTS[centro];
  const unicos = [...new Set(numeros.map((n) => String(n).trim()).filter((n) => layout?.oficinas[n]))];
  if (!layout || unicos.length === 0) return;

  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  for (const slidePath of slides) {
    const slide = await zip.file(slidePath)?.async("string");
    if (!slide) continue;
    const plano = ubicarPlano(slide);
    if (!plano) continue;

    const escalaX = plano.cx / layout.anchoImagen;
    const escalaY = plano.cy / layout.altoImagen;
    const aEmu = ([px, py]: Punto): [number, number] => [
      Math.round(plano.x + px * escalaX),
      Math.round(plano.y + py * escalaY),
    ];

    let id = siguienteId(slide);
    const marcas: string[] = [];
    const etiquetas: string[] = [];
    const cuartosYaMarcados = new Set<Punto[]>();
    // Centros de las etiquetas ya puestas: oficinas vecinas angostas (ej.
    // 12 y 13) tendrían la etiqueta encimada, así que se baja la que choca.
    const etiquetasPuestas: [number, number][] = [];
    for (const numero of unicos) {
      const contorno = layout.oficinas[numero];
      // 8 y 9 (y las demás parejas) son el mismo cuarto: se marca una vez.
      if (cuartosYaMarcados.has(contorno)) continue;
      cuartosYaMarcados.add(contorno);
      const puntos = contorno.map(aEmu);
      marcas.push(formaOficina(id++, numero, puntos));
      const xs = puntos.map((p) => p[0]);
      const ys = puntos.map((p) => p[1]);
      const ex = (Math.min(...xs) + Math.max(...xs)) / 2;
      let ey = (Math.min(...ys) + Math.max(...ys)) / 2;
      const choca = () =>
        etiquetasPuestas.some(([px, py]) => Math.abs(px - ex) < ANCHO_ETIQUETA && Math.abs(py - ey) < ALTO_ETIQUETA);
      while (choca()) ey += ALTO_ETIQUETA * 1.2;
      etiquetasPuestas.push([ex, ey]);
      etiquetas.push(formaEtiqueta(id++, `Oficina ${numero}`, ex, ey));
    }
    // Al final del árbol de formas para que queden encima del plano; las
    // etiquetas después de todas las marcas para que ninguna las tape.
    const nuevo = slide.replace("</p:spTree>", marcas.join("") + etiquetas.join("") + "</p:spTree>");
    zip.file(slidePath, nuevo);
    return;
  }
}
