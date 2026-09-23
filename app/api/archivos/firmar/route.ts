import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { parseStorageUrl } from "@/lib/storage";

// Devuelve un link firmado y temporal para abrir un archivo guardado en
// Supabase Storage. Se firma aquí, en el servidor, para que funcione igual
// cuando los buckets sean privados y para poder comprobar quién lo pide:
// - el staff (cualquier rol distinto de cliente) puede abrir cualquier archivo
//   de los buckets de la lista;
// - un cliente solo los archivos que están ligados a SUS propios registros
//   (su contrato, sus facturas, sus comprobantes, sus tickets...).
const BUCKETS_PERMITIDOS = new Set([
  "contratos",
  "comprobantes",
  "facturas",
  "Facturas",
  "cotizaciones",
  "responsivas-equipo",
  "tickets",
  "mantenimientos",
  "sala-juntas",
]);

type Admin = ReturnType<typeof createAdminClient>;

async function hay(consulta: PromiseLike<{ count: number | null; error: unknown }>) {
  try {
    const { count, error } = await consulta;
    return !error && (count || 0) > 0;
  } catch {
    return false;
  }
}

// ¿Este archivo está ligado a un registro del propio cliente?
async function esArchivoDelCliente(admin: Admin, uid: string, url: string): Promise<boolean> {
  const cuenta = (tabla: string) => admin.from(tabla).select("id", { count: "exact", head: true });
  const propios = await Promise.all([
    hay(cuenta("contratos").eq("user_id", uid).eq("archivo_url", url)),
    hay(cuenta("facturas").eq("user_id", uid).eq("archivo_url", url)),
    hay(cuenta("facturas").eq("user_id", uid).eq("xml_url", url)),
    hay(cuenta("pagos").eq("user_id", uid).eq("comprobante_url", url)),
    hay(cuenta("tickets").eq("user_id", uid).eq("foto_url", url)),
    hay(cuenta("tickets").eq("user_id", uid).contains("foto_urls", [url])),
    hay(cuenta("quejas_sugerencias").eq("user_id", uid).contains("fotos_urls", [url])),
    hay(cuenta("paqueteria").eq("cliente_id", uid).eq("foto_url", url)),
  ]);
  if (propios.some(Boolean)) return true;

  // Fotos que el staff adjunta en la conversación de un ticket del cliente.
  try {
    const { data: comentarios } = await admin
      .from("ticket_comentarios")
      .select("ticket_id")
      .contains("fotos_urls", [url])
      .limit(20);
    const ids = Array.from(new Set((comentarios || []).map((c: { ticket_id: string }) => c.ticket_id)));
    if (ids.length > 0) {
      return await hay(cuenta("tickets").eq("user_id", uid).in("id", ids));
    }
  } catch {
    // sin acceso
  }
  return false;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  const descargar = body?.descargar === true;
  const expiresIn = Math.min(Math.max(Number(body?.expiresIn) || 300, 60), 3600);

  // Solo URLs del almacenamiento de este proyecto, de buckets permitidos.
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/`;
  const ubicacion = url.startsWith(base) ? parseStorageUrl(url) : null;
  if (!ubicacion || !BUCKETS_PERMITIDOS.has(ubicacion.bucket)) {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: perfil } = await admin.from("profiles").select("rol").eq("id", session.user.id).maybeSingle();
  if (!perfil?.rol) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  if (perfil.rol === "cliente" && !(await esArchivoDelCliente(admin, session.user.id, url))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { data, error } = await admin.storage
    .from(ubicacion.bucket)
    .createSignedUrl(ubicacion.path, expiresIn, descargar ? { download: true } : undefined);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link" }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
