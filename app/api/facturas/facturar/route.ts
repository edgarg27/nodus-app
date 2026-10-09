import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { facturarCobro } from "@/lib/facturarCobro";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const MAXIMO_POR_LLAMADA = 50;

// Emite la factura (CFDI, pago diferido) de uno o varios cobros pendientes.
// Es lo equivalente al "Facturar electrónicamente masiva" de ZORA.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { facturaIds } = await req.json();
  if (!Array.isArray(facturaIds) || facturaIds.length === 0 || facturaIds.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir los cobros" }, { status: 400 });
  }
  if (facturaIds.length > MAXIMO_POR_LLAMADA) {
    return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} cobros por vez` }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const { data: filas } = await admin.from("facturas").select("id, centro").in("id", facturaIds);
    const todasDelCentro = !!filas && filas.length === facturaIds.length && filas.every((f) => f.centro === miProfile!.centro);
    if (!todasDelCentro) {
      return NextResponse.json({ error: "No puedes facturar cobros de otro centro" }, { status: 403 });
    }
  }

  // Uno por uno: Facturapi y el SAT limitan el ritmo, y un error en uno no frena los demás.
  const resultados = [];
  for (const id of facturaIds) {
    resultados.push(await facturarCobro(admin, id));
  }

  const fallidas = resultados.filter((r) => !r.ok);
  return NextResponse.json({ ok: fallidas.length === 0, resultados }, { status: fallidas.length === resultados.length ? 400 : 200 });
}
