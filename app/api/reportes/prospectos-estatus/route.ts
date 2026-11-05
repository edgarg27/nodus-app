import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";

export const dynamic = "force-dynamic";

// Diseño (marketing) lo ve de todos los centros, igual que "Prospectos y ventas por medio".
const ROLES = ["admin", "gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive", "diseno"];
const ROLES_GLOBALES = ["gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive", "diseno"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const ESTADOS_PROSPECTO = ["nuevo", "contactado", "en_seguimiento", "convertido", "perdido"] as const;

export type FilaCentroEstatus = { centro: string; total: number } & Record<(typeof ESTADOS_PROSPECTO)[number], number>;

export type ProspectoEstatus = {
  id: string;
  fecha: string;
  centro: string;
  nombre: string;
  empresa: string | null;
  medio: string;
  interes: string | null;
  estado: string;
  registro: string;
  motivoPerdido: string | null;
};

// Reporte "Estatus de prospectos por centro": en qué estado van hoy los prospectos registrados en el periodo (o en
// todo el historial), contados por centro, y la lista para ver cuáles son. Sin teléfono ni correo del prospecto.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!yo || !ROLES.includes(yo.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const desde = sp.get("desde") || "";
  const hasta = sp.get("hasta") || "";
  const todo = !desde && !hasta;
  if (!todo && (!FECHA.test(desde) || !FECHA.test(hasta))) return NextResponse.json({ error: "Fechas no válidas" }, { status: 400 });
  const esGlobal = ROLES_GLOBALES.includes(yo.rol);
  const centro = esGlobal ? sp.get("centro") || "" : yo.centro || "";
  if (!esGlobal && !centro) return NextResponse.json({ error: "Tu cuenta no tiene centro asignado" }, { status: 403 });

  const admin = createAdminClient();
  let q = admin.from("prospectos").select("id, centro, nombre, empresa, medio, interes, estado, registrado_por, created_at, comentario_perdido");
  if (!todo) q = q.gte("created_at", `${desde}T00:00:00-06:00`).lte("created_at", `${hasta}T23:59:59-06:00`);
  if (centro) q = q.eq("centro", centro);
  const { data: prospectos, error } = await q.order("created_at", { ascending: false }).limit(20000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const idsPersona = Array.from(new Set((prospectos || []).map((p) => p.registrado_por).filter(Boolean))) as string[];
  const { data: personas } = idsPersona.length
    ? await admin.from("profiles").select("id, nombre").in("id", idsPersona)
    : { data: [] as { id: string; nombre: string | null }[] };
  const nombrePersona = new Map((personas || []).map((p) => [p.id, p.nombre || ""]));

  // Todos los centros aparecen (aunque estén en cero) para poder comparar; los que no son del catálogo, al final.
  const filas = new Map<string, FilaCentroEstatus>();
  const fila = (c: string) => {
    if (!filas.has(c)) filas.set(c, { centro: c, total: 0, nuevo: 0, contactado: 0, en_seguimiento: 0, convertido: 0, perdido: 0 });
    return filas.get(c) as FilaCentroEstatus;
  };
  (centro ? [centro] : CENTROS_REPORTE).forEach(fila);

  const lista: ProspectoEstatus[] = [];
  for (const p of prospectos || []) {
    const c = (p.centro || "").trim() || "Sin centro";
    const estado = (ESTADOS_PROSPECTO as readonly string[]).includes(p.estado) ? p.estado : "nuevo";
    const f = fila(c);
    f.total++;
    f[estado as (typeof ESTADOS_PROSPECTO)[number]]++;
    lista.push({
      id: p.id,
      fecha: String(p.created_at).slice(0, 10),
      centro: c,
      nombre: p.nombre || "Prospecto",
      empresa: p.empresa || null,
      medio: (p.medio || "").trim() || "Sin medio",
      interes: p.interes || null,
      estado,
      registro: (p.registrado_por && nombrePersona.get(p.registrado_por)) || "Sin registrar",
      motivoPerdido: estado === "perdido" ? p.comentario_perdido || null : null,
    });
  }

  return NextResponse.json({
    centro: centro || null,
    desde,
    hasta,
    filas: Array.from(filas.values()),
    prospectos: lista,
  });
}
