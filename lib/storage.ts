import type { SupabaseClient } from "@supabase/supabase-js";

// Los archivos de buckets como "contratos" y "comprobantes" se subieron
// históricamente guardando la URL pública completa del bucket (con
// getPublicUrl). Esta función extrae la ruta interna del archivo a partir
// de esa URL (o la regresa tal cual si ya es una ruta), para poder pedir
// un link firmado con expiración en vez de reusar la URL pública guardada.
export function storagePathFromUrl(urlOrPath: string, bucket: string): string {
  const marker = `/object/public/${bucket}/`;
  const idx = urlOrPath.indexOf(marker);
  if (idx === -1) return urlOrPath;
  return decodeURIComponent(urlOrPath.slice(idx + marker.length).split("?")[0]);
}

// Genera un link firmado y temporal para abrir/descargar un archivo, a
// partir de la URL pública guardada en la base de datos o de la ruta
// interna del archivo. Sirve tanto si el bucket es público (hoy) como si
// más adelante se vuelve privado.
export async function getSignedFileUrl(
  supabase: SupabaseClient,
  bucket: string,
  urlOrPath: string,
  expiresIn = 300
): Promise<{ url: string | null; error: string | null }> {
  const path = storagePathFromUrl(urlOrPath, bucket);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    return { url: null, error: error?.message || "No se pudo generar el link" };
  }
  return { url: data.signedUrl, error: null };
}
