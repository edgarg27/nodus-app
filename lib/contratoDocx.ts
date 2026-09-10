import JSZip from "jszip";
import path from "path";
import fs from "fs/promises";
import { fmtMoneda, reemplazarTodasDocx } from "./docxHelpers";

// Plantillas reales de contrato (NBC) — solo centro Bosques. Coworking
// tiene 3 variantes por tipo de persona: paquete "30 Horas" (término fijo
// de 1 mes), y CON/SIN depósito en garantía según si la venta capturó un
// depósito (ver resolverVarianteCoworking). Oficina Privada tiene una sola
// variante (siempre con depósito) y Working Desk reutiliza esa misma
// plantilla — no tiene plantilla propia, igual que en el cotizador de
// PowerPoint (ver lib/cotizacionEspacioPptx.ts). Sala de Juntas no genera
// contrato: esas cotizaciones son solo reservas.
export type TipoEspacioContrato = "Coworking" | "Oficina Privada" | "Working Desk" | "Sala de Juntas";
export type TipoPersona = "fisica" | "moral";
type VarianteCoworking = "30hrs" | "conDeposito" | "sinDeposito";

const PLANTILLAS_COWORKING: Record<VarianteCoworking, Record<TipoPersona, string>> = {
  "30hrs": { fisica: "BosquesCoworking30hrsFisica.docx", moral: "BosquesCoworking30hrsMoral.docx" },
  conDeposito: { fisica: "BosquesCoworkingFisicaConDeposito.docx", moral: "BosquesCoworkingMoralConDeposito.docx" },
  sinDeposito: { fisica: "BosquesCoworkingFisicaSinDeposito.docx", moral: "BosquesCoworkingMoralSinDeposito.docx" },
};
// Working Desk reutiliza la plantilla de Oficina Privada a propósito.
const PLANTILLA_OFICINA: Record<TipoPersona, string> = {
  fisica: "BosquesOficinaPrivadaFisica.docx",
  moral: "BosquesOficinaPrivadaMoral.docx",
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

// Paquete "30 Horas" (ver tabla `paquetes`) trae un contrato con término
// fijo de 1 mes — se detecta por nombre, no por id (puede variar entre
// entornos de prueba y producción).
function esPaquete30Horas(nombrePaquete: string | null | undefined) {
  return (nombrePaquete || "").trim().toLowerCase().includes("30 hora");
}

function resolverVarianteCoworking(nombrePaquete: string | null | undefined, depositoGarantia: number): VarianteCoworking {
  if (esPaquete30Horas(nombrePaquete)) return "30hrs";
  return depositoGarantia > 0 ? "conDeposito" : "sinDeposito";
}

export function centroTienePlantillaContrato(tipoEspacio: TipoEspacioContrato, centro: string) {
  return centro === "Bosques" && tipoEspacio !== "Sala de Juntas";
}

export type DatosContratoDocx = {
  centro: string;
  tipoEspacio: TipoEspacioContrato;
  tipoPersona: TipoPersona;
  nombrePaquete?: string | null;
  folio: string;
  nombreCliente: string;
  razonSocial: string;
  rfc: string;
  numeroEspacio: string;
  correoCliente: string;
  fechaInicio: string | null; // ya formateada para mostrar
  fechaFin: string | null;
  duracionMeses: number | null;
  horasSalaJuntas: number | null;
  precioMensual: number;
  depositoGarantia: number;
};

function resolverArchivoPlantilla(datos: DatosContratoDocx): string {
  if (datos.tipoEspacio === "Coworking") {
    const variante = resolverVarianteCoworking(datos.nombrePaquete, datos.depositoGarantia);
    return PLANTILLAS_COWORKING[variante][datos.tipoPersona];
  }
  // Oficina Privada y Working Desk comparten plantilla.
  return PLANTILLA_OFICINA[datos.tipoPersona];
}

async function cargarPlantilla(datos: DatosContratoDocx) {
  if (!centroTienePlantillaContrato(datos.tipoEspacio, datos.centro)) {
    throw new Error(
      datos.tipoEspacio === "Sala de Juntas"
        ? "Las cotizaciones de Sala de Juntas son reservas — no generan contrato."
        : `Sin plantilla de contrato para "${datos.tipoEspacio}" en "${datos.centro}" todavía.`
    );
  }
  const archivo = resolverArchivoPlantilla(datos);
  const ruta = path.join(process.cwd(), "public", "plantillas-contrato", archivo);
  const buffer = await fs.readFile(ruta);
  return JSZip.loadAsync(buffer);
}

export async function generarContratoDocx(datos: DatosContratoDocx): Promise<Buffer> {
  const zip = await cargarPlantilla(datos);
  const docPath = "word/document.xml";
  let doc = await zip.file(docPath)?.async("string");
  if (!doc) {
    throw new Error("La plantilla de contrato no tiene word/document.xml — archivo .docx inválido.");
  }

  doc = reemplazarTodasDocx(doc, "{{CENTRO}}", datos.centro);
  doc = reemplazarTodasDocx(doc, "{{TIPO_ESPACIO}}", datos.tipoEspacio);
  doc = reemplazarTodasDocx(doc, "{{FOLIO}}", datos.folio);
  doc = reemplazarTodasDocx(doc, "{{NOMBRE_CLIENTE}}", datos.nombreCliente || "—");
  doc = reemplazarTodasDocx(doc, "{{RAZON_SOCIAL}}", datos.razonSocial || "—");
  doc = reemplazarTodasDocx(doc, "{{RFC}}", datos.rfc || "—");
  doc = reemplazarTodasDocx(doc, "{{NUMERO_ESPACIO}}", datos.numeroEspacio || "—");
  doc = reemplazarTodasDocx(doc, "{{CORREO_CLIENTE}}", datos.correoCliente || "—");
  doc = reemplazarTodasDocx(doc, "{{FECHA_INICIO}}", datos.fechaInicio || "—");
  doc = reemplazarTodasDocx(doc, "{{FECHA_FIN}}", datos.fechaFin || "—");
  doc = reemplazarTodasDocx(doc, "{{DURACION_MESES}}", datos.duracionMeses != null ? String(datos.duracionMeses) : "—");
  doc = reemplazarTodasDocx(doc, "{{HORAS_SALA_JUNTAS}}", datos.horasSalaJuntas != null ? String(datos.horasSalaJuntas) : "0");
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
