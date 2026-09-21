import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

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
  if (!id) return NextResponse.json({ error: "Falta la factura" }, { status: 400 });

  const admin = createAdminClient();
  const { data: factura } = await admin
    .from("facturas")
    .select("id, user_id, folio, archivo_url, xml_url")
    .eq("id", id)
    .maybeSingle();
  if (!factura) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  if (factura.user_id !== session.user.id) {
    const { data: perfil } = await admin.from("profiles").select("rol").eq("id", session.user.id).maybeSingle();
    if (!perfil || perfil.rol === "cliente") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const url = tipo === "xml" ? factura.xml_url : factura.archivo_url;
  if (!url) return NextResponse.json({ error: `Esta factura no tiene ${tipo.toUpperCase()}` }, { status: 404 });

  // Solo se sirven archivos del almacenamiento de este proyecto de Supabase.
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`;
  if (!url.startsWith(base)) {
    return NextResponse.json({ error: "Archivo no disponible" }, { status: 400 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok) return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 502 });
  const contenido = await upstream.arrayBuffer();

  const nombre = String(factura.folio || "factura").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "factura";
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": tipo === "xml" ? "application/xml" : "application/pdf",
      "Content-Disposition": `attachment; filename="Factura-${nombre}.${tipo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
