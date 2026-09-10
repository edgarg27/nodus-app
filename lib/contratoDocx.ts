import JSZip from "jszip";
import path from "path";
import fs from "fs/promises";
import { fmtMoneda, reemplazarTodasDocx } from "./docxHelpers";

// Mismo mecanismo que lib/cotizacionEspacioPptx.ts: un mapa de plantillas
// por tipo de espacio × tipo de persona, y JSZip para editar el XML del
// documento. Solo centro Bosques por ahora, igual que las plantillas de
// cotización en PowerPoint (ver PLAN_TRABAJO_EQUIPO.md, sección 8).
export type TipoEspacioContrato = "Coworking" | "Oficina Privada" | "Working Desk" | "Sala de Juntas";
export type TipoPersona = "fisica" | "moral";

const PLANTILLAS: Record<TipoEspacioContrato, Record<TipoPersona, string>> = {
  Coworking: { fisica: "BosquesCoworkingFisica.docx", moral: "BosquesCoworkingMoral.docx" },
  "Oficina Privada": { fisica: "BosquesOficinaPrivadaFisica.docx", moral: "BosquesOficinaPrivadaMoral.docx" },
  "Working Desk": { fisica: "BosquesWorkingDeskFisica.docx", moral: "BosquesWorkingDeskMoral.docx" },
  "Sala de Juntas": { fisica: "BosquesSalaDeJuntasFisica.docx", moral: "BosquesSalaDeJuntasMoral.docx" },
};

// `tipo_espacio` en `cotizaciones_comerciales` es texto libre (ej.
// "Coworking", "Oficina Privada", o para sala la cadena compuesta
// "Sala de Juntas <tamaño> · ..."), así que se normaliza por palabra
// clave en vez de esperar un valor exacto.
export function normalizarTipoEspacioContrato(tipoEspacioLibre: string): TipoEspacioContrato | null {
  const t = (tipoEspacioLibre || "").trim().toLowerCase();
  if (t.includes("sala")) return "Sala de Juntas";
  if (t.includes("coworking")) return "Coworking";
  if (t.includes("working desk")) return "Working Desk";
  if (t.includes("oficina")) return "Oficina Privada";
  return null;
}

export function centroTienePlantillaContrato(tipoEspacio: TipoEspacioContrato, tipoPersona: TipoPersona, centro: string) {
  return centro === "Bosques" && !!PLANTILLAS[tipoEspacio]?.[tipoPersona];
}

export type DatosContratoDocx = {
  centro: string;
  tipoEspacio: TipoEspacioContrato;
  tipoPersona: TipoPersona;
  folio: string;
  nombreCliente: string;
  correoCliente: string;
  fechaInicio: string | null; // ya formateada para mostrar
  fechaFin: string | null;
  precioMensual: number;
  depositoGarantia: number;
};

async function cargarPlantilla(tipoEspacio: TipoEspacioContrato, tipoPersona: TipoPersona, centro: string) {
  const archivo = PLANTILLAS[tipoEspacio]?.[tipoPersona];
  if (!archivo || !centroTienePlantillaContrato(tipoEspacio, tipoPersona, centro)) {
    throw new Error(`Sin plantilla de contrato para "${tipoEspacio}" (persona ${tipoPersona}) en "${centro}" todavía.`);
  }
  const ruta = path.join(process.cwd(), "public", "plantillas-contrato", archivo);
  const buffer = await fs.readFile(ruta);
  return JSZip.loadAsync(buffer);
}

export async function generarContratoDocx(datos: DatosContratoDocx): Promise<Buffer> {
  const zip = await cargarPlantilla(datos.tipoEspacio, datos.tipoPersona, datos.centro);
  const docPath = "word/document.xml";
  let doc = await zip.file(docPath)?.async("string");
  if (!doc) {
    throw new Error("La plantilla de contrato no tiene word/document.xml — archivo .docx inválido.");
  }

  doc = reemplazarTodasDocx(doc, "{{CENTRO}}", datos.centro);
  doc = reemplazarTodasDocx(doc, "{{TIPO_ESPACIO}}", datos.tipoEspacio);
  doc = reemplazarTodasDocx(doc, "{{FOLIO}}", datos.folio);
  doc = reemplazarTodasDocx(doc, "{{NOMBRE_CLIENTE}}", datos.nombreCliente || "—");
  doc = reemplazarTodasDocx(doc, "{{CORREO_CLIENTE}}", datos.correoCliente || "—");
  doc = reemplazarTodasDocx(doc, "{{FECHA_INICIO}}", datos.fechaInicio || "—");
  doc = reemplazarTodasDocx(doc, "{{FECHA_FIN}}", datos.fechaFin || "—");
  doc = reemplazarTodasDocx(doc, "{{PRECIO_MENSUAL}}", fmtMoneda(datos.precioMensual));
  doc = reemplazarTodasDocx(doc, "{{DEPOSITO_GARANTIA}}", fmtMoneda(datos.depositoGarantia));
  doc = reemplazarTodasDocx(
    doc,
    "{{FECHA_EMISION}}",
    new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" })
  );

  zip.file(docPath, doc);
  return zip.generateAsync({ type: "nodebuffer" });
}
