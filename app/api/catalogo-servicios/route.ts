import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { cargarCatalogo, claveDesdeEtiqueta, puedeEditarCatalogo, validarCamposServicio } from "@/lib/catalogoServicios";

async function sesionPersonal() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const { data: perfil } = await supabase.from("profiles").select("rol, email").eq("id", session.user.id).single();
  if (!perfil || perfil.rol === "cliente") return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  const email = perfil.email || session.user.email || "";
  return { userId: session.user.id, puedeEditar: puedeEditarCatalogo(email, perfil.rol) };
}

// Servicios del catálogo. Todo el personal los ve (para elegirlos); quien puede editar ve además los quitados.
export async function GET(req: NextRequest) {
  const s = await sesionPersonal();
  if ("error" in s) return s.error;
  const todos = s.puedeEditar && req.nextUrl.searchParams.get("todos") === "1";
  const { servicios, deBase } = await cargarCatalogo(createAdminClient(), { todos });
  return NextResponse.json({ servicios, puedeEditar: s.puedeEditar, deBase });
}

// Agregar un servicio nuevo (solo quien edita el catálogo).
export async function POST(req: NextRequest) {
  const s = await sesionPersonal();
  if ("error" in s) return s.error;
  if (!s.puedeEditar) return NextResponse.json({ error: "No tienes permiso para cambiar los servicios" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const etiqueta = String(b.etiqueta || "").trim();
  const campos = {
    etiqueta,
    concepto: String(b.concepto ?? etiqueta).trim(),
    satProdServ: String(b.satProdServ || "").trim(),
    satUnidad: String(b.satUnidad || "").trim().toUpperCase(),
    precio: b.precio === "" || b.precio == null ? null : Number(b.precio),
  };
  const err = validarCamposServicio(campos);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const admin = createAdminClient();
  const base = claveDesdeEtiqueta(etiqueta);
  if (base.length < 2) return NextResponse.json({ error: "El nombre debe llevar letras o números" }, { status: 400 });
  const { data: existentes } = await admin.from("catalogo_servicios").select("clave, orden").like("clave", base + "%");
  const usadas = new Set((existentes || []).map((e) => e.clave));
  let clave = base;
  for (let n = 2; usadas.has(clave); n++) clave = `${base.slice(0, 36)}_${n}`;
  const { data: ult } = await admin.from("catalogo_servicios").select("orden").lt("orden", 900).order("orden", { ascending: false }).limit(1);
  const orden = ((ult && ult[0]?.orden) || 0) + 10;

  const { error } = await admin.from("catalogo_servicios").insert({
    clave,
    etiqueta: campos.etiqueta,
    concepto: campos.concepto,
    sat_prod_serv: campos.satProdServ,
    sat_unidad: campos.satUnidad,
    precio: campos.precio,
    orden,
    actualizado_por: s.userId,
  });
  if (error) {
    console.error("[catalogo-servicios] crear:", error.message);
    return NextResponse.json({ error: "No se pudo guardar el servicio (¿ya corriste la migración del catálogo?)" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, clave });
}

// Cambiar el precio, el nombre o las claves de un servicio, o quitarlo/reactivarlo (activo).
export async function PUT(req: NextRequest) {
  const s = await sesionPersonal();
  if ("error" in s) return s.error;
  if (!s.puedeEditar) return NextResponse.json({ error: "No tienes permiso para cambiar los servicios" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const clave = String(b.clave || "");
  if (!clave) return NextResponse.json({ error: "Falta el servicio" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  const campos: { etiqueta?: string; concepto?: string; satProdServ?: string; satUnidad?: string; precio?: number | null } = {};
  if (b.etiqueta !== undefined) campos.etiqueta = String(b.etiqueta).trim();
  if (b.concepto !== undefined) campos.concepto = String(b.concepto).trim();
  if (b.satProdServ !== undefined) campos.satProdServ = String(b.satProdServ).trim();
  if (b.satUnidad !== undefined) campos.satUnidad = String(b.satUnidad).trim().toUpperCase();
  if (b.precio !== undefined) campos.precio = b.precio === "" || b.precio === null ? null : Number(b.precio);
  const err = validarCamposServicio(campos);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (campos.etiqueta !== undefined) cambios.etiqueta = campos.etiqueta;
  if (campos.concepto !== undefined) cambios.concepto = campos.concepto;
  if (campos.satProdServ !== undefined) cambios.sat_prod_serv = campos.satProdServ;
  if (campos.satUnidad !== undefined) cambios.sat_unidad = campos.satUnidad;
  if (campos.precio !== undefined) cambios.precio = campos.precio;
  if (typeof b.activo === "boolean") cambios.activo = b.activo;
  if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "No hay nada que cambiar" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("catalogo_servicios")
    .update({ ...cambios, actualizado_por: s.userId, actualizado_en: new Date().toISOString() })
    .eq("clave", clave)
    .select("clave");
  if (error) {
    console.error("[catalogo-servicios] actualizar:", error.message);
    return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 500 });
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "No se encontró el servicio" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
