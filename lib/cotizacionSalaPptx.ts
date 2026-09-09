import JSZip from "jszip";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { escaparXml, fmtMoneda, reemplazarTodas, reemplazarSecuencia } from "./pptxHelpers";

// RECONSTRUCCIÓN (2026-09-07): este archivo tenía por error el código de
// Coworking/Oficina Privada (se movió a lib/cotizacionEspacioPptx.ts,
// donde debía haber estado siempre) y la lógica real de Sala de Juntas
// se perdió — no había manera de recuperarla (sin git, sin caché de build
// compilado de esta ruta). Lo de abajo es una reconstrucción desde cero,
// armada leyendo la plantilla real (public/plantillas-cotizacion/Bosques.pptx)
// y el payload que ya envía app/centro/CotizarForm.tsx (línea ~974) hacia
// /api/cotizar-sala-pptx. Probado contra esa plantilla real antes de
// entregarse (ver notas de prueba), pero como es reconstrucción, vale la
// pena que alguien revise un PDF/PPTX generado de verdad antes de usarlo
// con un cliente.
//
// La plantilla Bosques.pptx trae:
//   - slide2: una tarjeta con el aforo de la sala ("10 personas" de
//     ejemplo) — se reemplaza por el tamaño real cotizado.
//   - slide4: la tabla de cotización. Tiene DOS tablas separadas:
//       · tabla de ítems (Item/Descripción/Cantidad/Precio unitario/Total),
//         con un 2º renglón YA PREPARADO EN BLANCO (sin ningún <a:t>) para
//         un segundo concepto — se usa para el Coffee Break opcional.
//       · tabla-resumen (Subtotal/IVA/Total), cada valor es un "$" suelto.
const PLANTILLAS: Record<string, string> = {
  Bosques: "Bosques.pptx",
};

export function centroTienePlantillaCotizacionSala(centro: string) {
  return !!PLANTILLAS[centro];
}

export type DatosCotizacionSala = {
  centro: string;
  tamano: string; // p.ej. "10 personas" — mismo texto que precios_cotizacion_sala_juntas.tamano
  descripcion: string;
  precioUnitario: number;
  subtotal: number; // ya incluye el Coffee Break si aplica (CotizarForm lo suma antes de llamar)
  ivaMonto: number;
  total: number;
  fecha: Date;
  notas?: string; // solo se guarda en el registro de Cotizaciones — esta plantilla no tiene un placeholder de notas en el slide
  nombreDestinatario?: string;
  coffeeDescripcion?: string;
  coffeeCantidad?: number;
  coffeePrecioUnitario?: number;
  coffeeTotal?: number;
};

async function cargarPlantilla(centro: string) {
  const archivo = PLANTILLAS[centro];
  if (!archivo) {
    throw new Error(`Sin plantilla de cotización en PowerPoint de Sala de Juntas para "${centro}" todavía.`);
  }
  const ruta = path.join(process.cwd(), "public", "plantillas-cotizacion", archivo);
  const buffer = await fs.readFile(ruta);
  return JSZip.loadAsync(buffer);
}

// --- Renglón opcional de Coffee Break (2º renglón, en blanco, de la tabla de ítems) ---

// Mismo formato de "run" que ya usan las celdas llenas vecinas de esa
// tabla (Campton Medium 11pt) — se copia tal cual para que el renglón
// nuevo se vea igual que el de arriba.
const RUN_RPR =
  '<a:rPr lang="es-MX" sz="1100" u="none" strike="noStrike" cap="none" dirty="0"><a:latin typeface="Campton Medium" panose="020B0004020102020203" pitchFamily="34" charset="0"/><a:ea typeface="Century Gothic"/><a:cs typeface="Century Gothic"/><a:sym typeface="Century Gothic"/></a:rPr>';

function construirRun(texto: string) {
  return `<a:r>${RUN_RPR}<a:t>${escaparXml(texto)}</a:t></a:r>`;
}

// Inserta un run de texto en una celda que llega vacía de la plantilla
// (solo trae <a:pPr>+<a:endParaRPr>, sin ningún <a:r>) — solo debe
// llamarse sobre celdas confirmadas vacías.
function llenarCeldaVacia(celdaXml: string, texto: string) {
  return celdaXml.replace("<a:endParaRPr", construirRun(texto) + "<a:endParaRPr");
}

// Separa el XML de una tabla (<a:tbl>...</a:tbl>) en sus filas, o el XML
// de una fila (<a:tr ...>...</a:tr>) en sus celdas — el primer elemento
// del array resultante es siempre el preámbulo antes de la primera
// etiqueta buscada (tblPr/tblGrid en el caso de filas), no una fila/celda
// real.
function dividirFilas(tablaXml: string) {
  return tablaXml.split(/(?=<a:tr[ >])/g);
}
function dividirCeldas(filaXml: string) {
  return filaXml.split(/(?=<a:tc>)/g);
}

// La tabla de ítems trae 6 filas: encabezado, el renglón principal (ya
// lleno vía reemplazarTodas/reemplazarSecuencia antes de llamar aquí) y
// el 2º renglón en blanco (5 celdas: Item/Descripción/Cantidad/Precio
// unitario/Total) reservado para el Coffee Break. Si no hay Coffee Break
// se deja en blanco (solo se borra el "1" de ejemplo que trae la celda
// de Item para no dejar un número suelto sin el resto del renglón).
function llenarRenglonCoffee(tablaItemsXml: string, datos: DatosCotizacionSala) {
  const filas = dividirFilas(tablaItemsXml);
  // filas[0] = preámbulo, filas[1] = encabezado, filas[2] = renglón
  // principal, filas[3] = renglón en blanco del Coffee Break.
  if (filas.length < 4) return tablaItemsXml;
  const filaCoffee = filas[3];
  const celdas = dividirCeldas(filaCoffee);
  // celdas[0] = preámbulo (<a:tr h="...">), celdas[1..5] = Item / Descripción / Cantidad / Precio unitario / Total.
  if (celdas.length < 6) return tablaItemsXml;

  const hayCoffee = !!(datos.coffeeDescripcion && datos.coffeeDescripcion.trim());
  celdas[1] = celdas[1].replace("<a:t>1</a:t>", `<a:t>${hayCoffee ? "2" : ""}</a:t>`);
  if (hayCoffee) {
    celdas[2] = llenarCeldaVacia(celdas[2], datos.coffeeDescripcion!.trim());
    celdas[3] = llenarCeldaVacia(celdas[3], String(datos.coffeeCantidad ?? 1));
    celdas[4] = llenarCeldaVacia(celdas[4], fmtMoneda(datos.coffeePrecioUnitario ?? 0));
    celdas[5] = llenarCeldaVacia(celdas[5], fmtMoneda(datos.coffeeTotal ?? 0));
  }
  filas[3] = celdas.join("");
  return filas.join("");
}

async function generarSala(datos: DatosCotizacionSala): Promise<Buffer> {
  const zip = await cargarPlantilla(datos.centro);

  // Slide 2: tarjeta de aforo de la sala.
  const slide2Path = "ppt/slides/slide2.xml";
  let slide2 = await zip.file(slide2Path)?.async("string");
  if (slide2 && datos.tamano) {
    slide2 = reemplazarTodas(slide2, "10 personas", datos.tamano);
    zip.file(slide2Path, slide2);
  }

  // Slide 4: tabla de cotización.
  const slide4Path = "ppt/slides/slide4.xml";
  let slide4 = await zip.file(slide4Path)?.async("string");
  if (slide4) {
    const fechaStr = datos.fecha
      .toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" })
      .replace(/\//g, "-");
    slide4 = reemplazarTodas(slide4, "Fecha: 00-00-00", `Fecha: ${fechaStr}`);
    slide4 = reemplazarTodas(slide4, "Paquete de 1 día", datos.descripcion);
    // Precio unitario y Total del renglón principal: dos celdas con el
    // mismo texto de ejemplo completo "$720.00 MXN" una junto a la otra.
    slide4 = reemplazarSecuencia(slide4, "$720.00 MXN", [fmtMoneda(datos.precioUnitario), fmtMoneda(datos.precioUnitario)]);
    // Tabla-resumen (Subtotal/IVA/Total): cada valor es un "$" suelto, en
    // ese orden.
    slide4 = reemplazarSecuencia(slide4, "$", [fmtMoneda(datos.subtotal), fmtMoneda(datos.ivaMonto), fmtMoneda(datos.total)]);
    if (datos.nombreDestinatario && datos.nombreDestinatario.trim()) {
      slide4 = reemplazarTodas(slide4, "A quién corresponda:", `A quién corresponda: ${datos.nombreDestinatario.trim()}`);
    }
    // Renglón de Coffee Break — no es un simple find-replace de texto (las
    // celdas llegan sin ningún <a:t>), se llena aparte.
    slide4 = llenarRenglonCoffee(slide4, datos);
    zip.file(slide4Path, slide4);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}

export async function generarPptxCotizacionSala(datos: DatosCotizacionSala): Promise<Buffer> {
  return generarSala(datos);
}

// --- Conversión a PDF ---

const execAsync = promisify(exec);

// Lista de binarios/rutas a probar, en orden. Si SOFFICE_PATH está
// definida se prueba solo esa (para no tapar un error de configuración
// explícita); si no, se prueban primero los nombres simples (funcionan
// si LibreOffice ya quedó en el PATH) y luego las rutas de instalación
// más comunes en Windows/Mac — así no depende de que el PATH del proceso
// de "npm run dev" (que en Windows a veces es más corto que el de una
// terminal normal) incluya la carpeta de LibreOffice.
function candidatosSoffice(): string[] {
  if (process.env.SOFFICE_PATH) return [process.env.SOFFICE_PATH];
  if (process.platform === "win32") {
    return [
      "soffice",
      "soffice.exe",
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
  }
  if (process.platform === "darwin") {
    return ["soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  }
  return ["soffice", "libreoffice", "/usr/bin/soffice", "/usr/bin/libreoffice"];
}

// Convierte el .pptx a PDF llamando a LibreOffice en modo headless
// (soffice --convert-to pdf). No se sabe con certeza cómo se hacía antes
// (no había registro de ningún paquete npm de conversión ni de un
// servicio en la nube en el proyecto), así que se reconstruyó con este
// enfoque porque es el más común en Node sin depender de un servicio de
// pago — pero requiere tener LibreOffice instalado en la máquina donde
// corre el servidor. Prueba varias rutas típicas (ver candidatosSoffice)
// antes de rendirse, y si ninguna funciona, se puede fijar a mano la
// variable de entorno SOFFICE_PATH con la ruta exacta del ejecutable.
//
// Si LibreOffice no está instalado, o la conversión falla por cualquier
// motivo, se regresa null — igual que antes, quien llama esta función
// (app/api/cotizar-sala-pptx/route.ts y app/api/cotizar-espacio-pptx/route.ts)
// ya trata null como "no hay PDF, pero el PowerPoint se sube y la
// cotización se guarda igual".
export async function convertirPptxAPdf(pptxBuffer: Buffer): Promise<Buffer | null> {
  let dirTemp: string | null = null;
  const erroresPorCandidato: string[] = [];
  try {
    dirTemp = await fs.mkdtemp(path.join(os.tmpdir(), "cotizacion-pptx-"));
    const rutaPptx = path.join(dirTemp, "cotizacion.pptx");
    await fs.writeFile(rutaPptx, pptxBuffer);

    for (const binario of candidatosSoffice()) {
      try {
        await execAsync(`"${binario}" --headless --norestore --convert-to pdf --outdir "${dirTemp}" "${rutaPptx}"`, {
          timeout: 60_000,
        });
        const rutaPdf = path.join(dirTemp, "cotizacion.pdf");
        return await fs.readFile(rutaPdf);
      } catch (e: any) {
        erroresPorCandidato.push(`${binario}: ${e?.message || e}`);
      }
    }
    console.error(
      "No se pudo convertir el PowerPoint a PDF — se probaron estas rutas de LibreOffice sin éxito (instálalo, o fija SOFFICE_PATH a la ruta exacta de soffice.exe):\n" +
        erroresPorCandidato.join("\n")
    );
    return null;
  } catch (e) {
    console.error("No se pudo convertir el PowerPoint a PDF:", e);
    return null;
  } finally {
    if (dirTemp) {
      const dirABorrar = dirTemp;
      fs.rm(dirABorrar, { recursive: true, force: true }).catch(() => {});
    }
  }
}
