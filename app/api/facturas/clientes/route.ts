import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const CAMPOS = "id, nombre, email, empresa, nombre_fiscal, rfc, regimen_fiscal, cp_fiscal, centro";

// Clientes que se pueden facturar desde un centro: los de ese centro más los que, aunque su perfil sea de otro,
// tienen un contrato en este centro.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const centro = ROLES_GLOBALES.includes(miProfile!.rol) ? req.nextUrl.searchParams.get("centro") || miProfile!.centro : miProfile!.centro;
  if (!centro) return NextResponse.json({ error: "Falta el centro" }, { status: 400 });

  const admin = createAdminClient();
  const { data: propios } = await admin.from("profiles").select(CAMPOS).eq("rol", "cliente").eq("centro", centro).order("nombre");
  const idsPropios = new Set((propios || []).map((p) => p.id));

  const { data: contratos } = await admin.from("contratos").select("user_id").eq("centro", centro).not("user_id", "is", null);
  const idsContrato = Array.from(new Set((contratos || []).map((c) => c.user_id as string))).filter((id) => !idsPropios.has(id));
  const { data: porContrato } = idsContrato.length
    ? await admin.from("profiles").select(CAMPOS).eq("rol", "cliente").in("id", idsContrato).order("nombre")
    : { data: [] as typeof propios };

  const clientes = [
    ...(propios || []).map((p) => ({ ...p, porContrato: false })),
    ...(porContrato || []).map((p) => ({ ...p, porContrato: true })),
  ].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

  return NextResponse.json({ clientes });
}
