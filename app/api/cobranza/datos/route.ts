import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { cargarCobranza } from "@/lib/cobranza";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];

// Cobranza: clientes, lo que deben (con fecha límite), lo que han pagado y sus promesas de pago.
// ?centro= (vacío = todos los centros, solo roles globales).
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const esGlobal = ROLES_GLOBALES.includes(yo!.rol);
  const pedido = req.nextUrl.searchParams.get("centro") || "";
  const centro = esGlobal ? pedido || null : yo!.centro;

  const admin = createAdminClient();
  const { clientes, cargos, pagados, bajas } = await cargarCobranza(admin, { centro });

  // Promesas de pago (la tabla existe después de migracion_cobranza_promesas.sql).
  let promesas: any[] = [];
  const ids = clientes.map((c) => c.id);
  if (ids.length > 0) {
    const { data, error } = await admin
      .from("promesas_pago")
      .select("id, user_id, monto, fecha_promesa, fecha_contacto, medio, nota, estado, created_at")
      .in("user_id", ids.slice(0, 1000))
      .order("fecha_promesa", { ascending: true });
    if (!error) promesas = data || [];
  }

  return NextResponse.json({
    centro,
    esGlobal,
    puedeRegistrar: rolPuede(yo?.rol, "pagosMarcarPagado"),
    clientes,
    cargos,
    pagados,
    bajas,
    promesas,
  });
}
