import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Quién puede ver los reportes de /reportes (ventas por centro, historial de facturas, seguimiento del equipo) y
// de qué centro: los roles globales eligen centro (o todos); un admin de centro solo ve el suyo.
const ROLES = ["admin", "gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive"];
const ROLES_GLOBALES = ["gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export { CENTROS_REPORTE } from "@/lib/centrosReporte";

type Acceso =
  | { ok: true; centro: string; desde: string; hasta: string; esGlobal: boolean }
  | { ok: false; respuesta: NextResponse };

// `fechasOpcionales`: sin ?desde/?hasta se toma todo el historial (desde = "", hasta = "").
export async function accesoReporte(req: NextRequest, fechasOpcionales = false): Promise<Acceso> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, respuesta: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!yo || !ROLES.includes(yo.rol)) return { ok: false, respuesta: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };

  const sp = req.nextUrl.searchParams;
  const desde = sp.get("desde") || "";
  const hasta = sp.get("hasta") || "";
  const sinFechas = fechasOpcionales && !desde && !hasta;
  if (!sinFechas && (!FECHA.test(desde) || !FECHA.test(hasta))) {
    return { ok: false, respuesta: NextResponse.json({ error: "Fechas no válidas" }, { status: 400 }) };
  }
  const esGlobal = ROLES_GLOBALES.includes(yo.rol);
  const centro = esGlobal ? sp.get("centro") || "" : yo.centro || "";
  return { ok: true, centro, desde, hasta, esGlobal };
}
