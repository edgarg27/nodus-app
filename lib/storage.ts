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

// Versión para el NAVEGADOR: pide el link firmado al servidor
// (/api/archivos/firmar), que comprueba que el usuario puede ver ese archivo
// (staff: cualquiera; cliente: solo los ligados a sus registros) y firma con
// permisos de servidor. Así funciona igual con buckets públicos o privados.
export async function pedirLinkFirmado(
  url: string,
  opciones: { descargar?: boolean; expiresIn?: number } = {}
): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch("/api/archivos/firmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, descargar: opciones.descargar === true, expiresIn: opciones.expiresIn }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) return { url: null, error: data.error || "No se pudo abrir el archivo" };
    return { url: data.url as string, error: null };
  } catch {
    return { url: null, error: "No se pudo conectar" };
  }
}
