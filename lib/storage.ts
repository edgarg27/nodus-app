import type { SupabaseClient } from "@supabase/supabase-js";

// Los archivos de los buckets se subieron históricamente guardando la URL
// pública completa (con getPublicUrl). Estas funciones sacan de esa URL el
// bucket y la ruta interna del archivo (o aceptan una ruta ya suelta), para
// poder pedir un link firmado con expiración en vez de reusar la URL pública
// guardada. Funcionan igual con el bucket público (hoy) o privado (después).

const PATRON_URL_STORAGE = /\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;

export function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const m = url.match(PATRON_URL_STORAGE);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

export function storagePathFromUrl(urlOrPath: string, bucket: string): string {
  const parsed = parseStorageUrl(urlOrPath);
  return parsed ? parsed.path : urlOrPath;
}

// Genera un link firmado y temporal para abrir/descargar un archivo, a partir
// de la URL pública guardada en la base de datos o de la ruta interna del
// archivo. Si es una URL completa, el bucket sale de la propia URL (algunos
// registros viejos viven en un bucket distinto al esperado); `bucket` se usa
// cuando solo se tiene la ruta. `descargar: true` fuerza la descarga (útil para
// PPTX/DOCX, que el navegador no muestra).
export async function getSignedFileUrl(
  supabase: SupabaseClient,
  bucket: string,
  urlOrPath: string,
  expiresIn = 300,
  descargar = false
): Promise<{ url: string | null; error: string | null }> {
  const parsed = parseStorageUrl(urlOrPath);
  const bucketFinal = parsed?.bucket || bucket;
  const path = parsed?.path || urlOrPath;
  const { data, error } = await supabase.storage
    .from(bucketFinal)
    .createSignedUrl(path, expiresIn, descargar ? { download: true } : undefined);
  if (error || !data?.signedUrl) {
    return { url: null, error: error?.message || "No se pudo generar el link" };
  }
  return { url: data.signedUrl, error: null };
}
