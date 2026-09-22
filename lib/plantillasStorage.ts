import path from "path";
import fs from "fs/promises";
import { createAdminClient } from "./supabaseAdmin";

export type CarpetaPlantilla = "plantillas-contrato" | "plantillas-cotizacion";

// Trae el archivo de plantilla (.docx / .pptx) que se usa para generar
// contratos y cotizaciones. Por default es el que trae el repo en
// public/plantillas-contrato o public/plantillas-cotizacion (el mismo de
// siempre, sin tocar nada); si Diseño subió una versión nueva desde
// /diseno/plantillas (tabla "plantillas_documentos", bucket
// "plantillas-documentos" — ver migracion_plantillas_documentos.sql), se
// usa esa en su lugar, sin tocar código ni volver a desplegar.
export async function cargarArchivoPlantilla(carpeta: CarpetaPlantilla, archivo: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data: fila } = await admin
    .from("plantillas_documentos")
    .select("storage_path")
    .eq("nombre_archivo", archivo)
    .maybeSingle();

  if (fila?.storage_path) {
    const { data, error } = await admin.storage.from("plantillas-documentos").download(fila.storage_path);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
    // Si falla la descarga (p.ej. alguien borró el archivo a mano en
    // Storage sin avisarle a la tabla), cae al default de abajo en vez de
    // tronar la generación del documento.
  }

  const ruta = path.join(process.cwd(), "public", carpeta, archivo);
  return fs.readFile(ruta);
}
