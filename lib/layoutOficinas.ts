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
//
// Un centro puede tener varios planos (Punto 45: Zona A con las oficinas y
// Zona B con las aulas, dos imágenes en la misma diapositiva). Cada plano
// se reconoce por el tamaño en pixeles de su imagen dentro del PowerPoint,
// así que si Diseño sube una imagen de otro tamaño simplemente no se marca.

type Punto = [number, number];

type PlanoCentro = {
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

// P45 Zona B: el Aula 8 tiene la esquina inferior izquierda cortada en diagonal.
const AULA_8_P45: Punto[] = [
  [455, 460],
  [582, 460],
  [582, 725],
  [455, 650],
];

const LAYOUTS: Record<string, PlanoCentro[]> = {
  Bosques: [{
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
  }],
  "Punto 45": [
    {
      // Zona A (oficinas). 13-14 y 17-18 son un solo cuarto cada una.
      anchoImagen: 1669,
      altoImagen: 1331,
      oficinas: {
        "1": rect(1425, 591, 1588, 767),
        "2": rect(1429, 776, 1588, 984),
        "3": rect(1267, 840, 1420, 961),
        "4": rect(992, 840, 1257, 961),
        "5": rect(854, 840, 983, 961),
        "6": rect(717, 840, 846, 961),
        "7": rect(584, 840, 707, 961),
        "8": rect(90, 528, 575, 835),
        "9": rect(584, 532, 819, 769),
        "10": rect(584, 275, 820, 523),
        "11": rect(583, 76, 820, 212),
        "12": rect(829, 76, 1066, 212),
        "13-14": rect(1072, 76, 1563, 214),
        "15": rect(1425, 218, 1562, 333),
        "16": rect(1425, 343, 1562, 457),
        "17-18": rect(90, 220, 325, 412),
        "19": rect(328, 77, 438, 216),
        "20": rect(447, 77, 574, 216),
      },
    },
    {
      // Zona B (aulas). El Aula 9 es el comedor.
      anchoImagen: 1612,
      altoImagen: 1120,
      oficinas: {
        "Aula 1": rect(463, 102, 668, 381),
        "Aula 2": rect(674, 102, 885, 380),
        "Aula 3": rect(892, 102, 1102, 380),
        "Aula 4": rect(1279, 460, 1469, 726),
        "Aula 5": rect(1081, 460, 1273, 724),
        "Aula 6": rect(912, 460, 1074, 725),
        "Aula 7": rect(587, 460, 908, 725),
        "Aula 8": AULA_8_P45,
        "Aula 9": rect(1109, 103, 1470, 381),
      },
    },
  ],
  "San Telmo": [
    {
      anchoImagen: 1872,
      altoImagen: 1995,
      oficinas: {
        "1": rect(1204, 817, 1381, 962),
        "2A": rect(1184, 1118, 1402, 1359),
        "2B": rect(1414, 1163, 1668, 1359),
        "3": rect(1455, 976, 1668, 1150),
        "4": rect(1459, 817, 1668, 964),
        "5": rect(1457, 495, 1668, 805),
        "6": rect(1461, 194, 1641, 488),
        "7": rect(1293, 194, 1449, 443),
        "8": rect(1136, 194, 1280, 510),
        "9": rect(976, 362, 1123, 509),
        "10": rect(974, 194, 1121, 349),
        "11": rect(658, 194, 805, 349),
        "12": rect(657, 362, 804, 509),
        "13": rect(509, 194, 644, 510),
        "14": rect(348, 194, 496, 443),
        "15": rect(191, 194, 335, 488),
        "16": rect(191, 500, 338, 644),
        "17": rect(191, 656, 338, 805),
        "18": rect(191, 817, 338, 964),
        // Zona gris de "cotización especial": los dos privados a los que apunta el 19.
        "19": rect(191, 976, 321, 1295),
      },
    },
  ],
};

// Azul de la marca (el mismo "002060" de los textos de la plantilla).
const COLOR_MARCA = "002060";
const OPACIDAD_RELLENO = 45000; // 45 %
const ANCHO_ETIQUETA = 594360; // 0.65 in
const ALTO_ETIQUETA = 192024; // 0.21 in

export function centroTieneLayoutOficinas(centro: string) {
  return !!LAYOUTS[centro];
}

// Tamaño en pixeles de una imagen PNG (lo trae el encabezado). Los planos
// son PNG; cualquier otra imagen regresa null y se ignora.
function tamanoPng(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const leer = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  return [leer(16), leer(20)];
}

// Imágenes de la diapositiva que son alguno de los planos del centro, con
// su posición y tamaño en EMU.
async function ubicarPlanos(zip: JSZip, slidePath: string, slideXml: string, planos: PlanoCentro[]) {
  const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
  const rels = (await zip.file(relsPath)?.async("string")) || "";
  const destinos = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) destinos.set(id, target);
  }
  const encontrados: { plano: PlanoCentro; x: number; y: number; cx: number; cy: number }[] = [];
  for (const m of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const embed = m[0].match(/r:embed="([^"]+)"/)?.[1];
    const off = m[0].match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = m[0].match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const target = embed && destinos.get(embed);
    if (!target || !off || !ext) continue;
    const mediaPath = target.startsWith("/") ? target.slice(1) : "ppt/" + target.replace(/^\.\.\//, "");
    const bytes = await zip.file(mediaPath)?.async("uint8array");
    const tam = bytes && tamanoPng(bytes);
    const plano = tam && planos.find((p) => p.anchoImagen === tam[0] && p.altoImagen === tam[1]);
    if (!plano) continue;
    encontrados.push({ plano, x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) });
  }
  return encontrados;
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

// Las etiquetas largas ("Oficina 13-14", "Aula 8") se ensanchan para que el
// texto no se salga del recuadro: ~0.06 in por letra a 7.5 pt.
function anchoEtiqueta(texto: string) {
  return Math.max(ANCHO_ETIQUETA, texto.length * 54864);
}

function formaEtiqueta(id: number, texto: string, centroX: number, centroY: number) {
  const ancho = anchoEtiqueta(texto);
  const x = Math.round(centroX - ancho / 2);
  const y = Math.round(centroY - ALTO_ETIQUETA / 2);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Etiqueta ${escaparXml(texto)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${ancho}" cy="${ALTO_ETIQUETA}"/></a:xfrm>` +
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
// plano medido, la plantilla no trae la imagen del plano o el número no
// está en el plano, no hace nada (el PowerPoint sale igual que antes).
export async function marcarOficinasEnLayout(zip: JSZip, centro: string, numeros: string[]) {
  const planos = LAYOUTS[centro];
  const unicos = [
    ...new Set(numeros.map((n) => String(n).trim()).filter((n) => planos?.some((p) => p.oficinas[n]))),
  ];
  if (!planos || unicos.length === 0) return;

  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  for (const slidePath of slides) {
    const slide = await zip.file(slidePath)?.async("string");
    if (!slide) continue;
    const encontrados = await ubicarPlanos(zip, slidePath, slide, planos);
    if (encontrados.length === 0) continue;

    let id = siguienteId(slide);
    const marcas: string[] = [];
    const etiquetas: string[] = [];
    const cuartosYaMarcados = new Set<Punto[]>();
    // Centros de las etiquetas ya puestas: oficinas vecinas angostas (ej.
    // 12 y 13) tendrían la etiqueta encimada, así que se baja la que choca.
    const etiquetasPuestas: [number, number][] = [];
    for (const { plano, ...img } of encontrados) {
      const escalaX = img.cx / plano.anchoImagen;
      const escalaY = img.cy / plano.altoImagen;
      const aEmu = ([px, py]: Punto): [number, number] => [
        Math.round(img.x + px * escalaX),
        Math.round(img.y + py * escalaY),
      ];
      for (const numero of unicos) {
        const contorno = plano.oficinas[numero];
        // 8 y 9 (y las demás parejas) son el mismo cuarto: se marca una vez.
        if (!contorno || cuartosYaMarcados.has(contorno)) continue;
        cuartosYaMarcados.add(contorno);
        const puntos = contorno.map(aEmu);
        marcas.push(formaOficina(id++, numero, puntos));
        const xs = puntos.map((p) => p[0]);
        const ys = puntos.map((p) => p[1]);
        const ex = (Math.min(...xs) + Math.max(...xs)) / 2;
        let ey = (Math.min(...ys) + Math.max(...ys)) / 2;
        // Las aulas ya traen su nombre ("Aula 3"); las oficinas llevan "Oficina 12".
        const texto = /^\d/.test(numero) ? `Oficina ${numero}` : numero;
        const ancho = anchoEtiqueta(texto);
        const choca = () =>
          etiquetasPuestas.some(([px, py]) => Math.abs(px - ex) < ancho && Math.abs(py - ey) < ALTO_ETIQUETA);
        while (choca()) ey += ALTO_ETIQUETA * 1.2;
        etiquetasPuestas.push([ex, ey]);
        etiquetas.push(formaEtiqueta(id++, texto, ex, ey));
      }
    }
    if (marcas.length === 0) continue;
    // Al final del árbol de formas para que queden encima del plano; las
    // etiquetas después de todas las marcas para que ninguna las tape.
    const nuevo = slide.replace("</p:spTree>", marcas.join("") + etiquetas.join("") + "</p:spTree>");
    zip.file(slidePath, nuevo);
    return;
  }
}
