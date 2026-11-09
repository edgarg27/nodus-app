import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { parseStorageUrl } from "@/lib/storage";
import { rolPuede } from "@/lib/permisosApi";

// Descarga real (con nombre de archivo) del PDF o XML de una factura. El
// cliente solo puede bajar las suyas; el staff cualquiera. Se sirve a través
// del servidor porque el atributo "download" no funciona con archivos de otro
// dominio (Supabase Storage) y así también se valida quién lo pide.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") || "";
  const tipo = req.nextUrl.searchParams.get("tipo") === "xml" ? "xml" : "pdf";
  // ?ver=1: el PDF se abre en el visor (vista previa) en vez de descargarse.
  const enLinea = tipo === "pdf" && req.nextUrl.searchParams.get("ver") === "1";
  if (!id) return NextResponse.json({ error: "Falta la factura" }, { status: 400 });

  const admin = createAdminClient();
  // ?origen=complemento baja el PDF/XML de un complemento de pago en vez de una factura.
  const esComplemento = req.nextUrl.searchParams.get("origen") === "complemento";
  const { data: fila } = esComplemento
    ? await admin.from("complementos_pago").select("id, user_id, serie, folio_fiscal, archivo_url, xml_url").eq("id", id).maybeSingle()
    : await admin.from("facturas").select("id, user_id, folio, serie, folio_fiscal, nombre_receptor, archivo_url, xml_url").eq("id", id).maybeSingle();
  if (!fila) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  // El nombre del archivo es el folio que trae el CFDI (serie + folio, ej. "A425"), no el folio interno de la app
  // ("A-228476"); si la factura todavía no tiene folio fiscal, se usa el interno.
  const f = fila as any;
  const folioCfdi = f.folio_fiscal ? `${f.serie || ""}${f.folio_fiscal}` : "";
  const factura = {
    ...fila,
    folio: folioCfdi || (esComplemento ? "" : f.folio),
    receptor: esComplemento ? "" : f.nombre_receptor || "",
  } as { id: string; user_id: string | null; folio: string; receptor: string; archivo_url: string | null; xml_url: string | null };

  if (factura.user_id !== session.user.id) {
    const { data: perfil } = await admin.from("profiles").select("rol").eq("id", session.user.id).maybeSingle();
    if (!rolPuede(perfil?.rol, "facturaDescargar")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const url = tipo === "xml" ? factura.xml_url : factura.archivo_url;
  if (!url) return NextResponse.json({ error: `Esta factura no tiene ${tipo.toUpperCase()}` }, { status: 404 });

  // Solo se sirven archivos del almacenamiento de este proyecto de Supabase
  // (no se pide una URL arbitraria) y se descargan con permisos de servidor,
  // así funciona igual si el bucket es público o privado.
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`;
  const ubicacion = url.startsWith(base) ? parseStorageUrl(url) : null;
  if (!ubicacion) {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 400 });
  }

  const { data: blob, error: descargaError } = await admin.storage.from(ubicacion.bucket).download(ubicacion.path);
  if (descargaError || !blob) return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 502 });
  const contenido = await blob.arrayBuffer();

  // "Factura A425 - CLIENTE SA DE CV.pdf". filename lleva la versión sin acentos (navegadores viejos) y filename*
  // la completa en UTF-8.
  const limpio = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const nombreBase = limpio(
    `${esComplemento ? "Complemento" : "Factura"} ${factura.folio || ""}${factura.receptor ? ` - ${factura.receptor}` : ""}`
  ).slice(0, 150) || (esComplemento ? "Complemento" : "Factura");
  const nombreArchivo = `${nombreBase}.${tipo}`;
  const nombreAscii = nombreArchivo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": tipo === "xml" ? "application/xml" : "application/pdf",
      "Content-Disposition": `${enLinea ? "inline" : "attachment"}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
