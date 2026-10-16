import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];

// Descartar (✕) o marcar como leído un aviso de la campana. Se hace aquí con la llave de servicio porque la base no
// deja al personal borrar avisos directo: el ✕ los quitaba de la pantalla pero regresaban al recargar.
// Solo los de su centro (o todos, si su rol ve todos los centros) y los suyos propios.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!yo || yo.rol === "cliente") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const ids: string[] = (Array.isArray(b.ids) ? b.ids : [b.id]).filter((x: unknown) => typeof x === "string").slice(0, 100);
  if (ids.length === 0 || !["descartar", "leida"].includes(b.accion)) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const admin = createAdminClient();
  const { data: avisos } = await admin.from("notificaciones").select("id, centro, user_id").in("id", ids);
  const esGlobal = ROLES_GLOBALES.includes(yo.rol);
  const permitidos = (avisos || [])
    .filter((n) => n.user_id === session.user.id || esGlobal || !n.centro || n.centro === yo.centro)
    .map((n) => n.id);
  if (permitidos.length === 0) return NextResponse.json({ ok: true, cambiados: 0 });

  const { error } =
    b.accion === "descartar"
      ? await admin.from("notificaciones").delete().in("id", permitidos)
      : await admin.from("notificaciones").update({ leida: true }).in("id", permitidos);
  if (error) return NextResponse.json({ error: "No se pudo actualizar el aviso" }, { status: 500 });
  return NextResponse.json({ ok: true, cambiados: permitidos.length });
}
