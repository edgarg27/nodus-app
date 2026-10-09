import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { facturarCobro, facturarPagoSuelto } from "@/lib/facturarCobro";

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

  const cuerpo = await req.json();
  const facturaIds: string[] = Array.isArray(cuerpo.facturaIds) ? cuerpo.facturaIds : [];
  // Cobros sueltos (adicionales, depósitos…): registros de pago que aún no tienen factura.
  const pagoIds: string[] = Array.isArray(cuerpo.pagoIds) ? cuerpo.pagoIds : [];
  if (facturaIds.length + pagoIds.length === 0 || [...facturaIds, ...pagoIds].some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir los cobros" }, { status: 400 });
  }
  if (facturaIds.length + pagoIds.length > MAXIMO_POR_LLAMADA) {
    return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} cobros por vez` }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const { data: filas } = facturaIds.length ? await admin.from("facturas").select("id, centro").in("id", facturaIds) : { data: [] as { id: string; centro: string | null }[] };
    const { data: pagos } = pagoIds.length ? await admin.from("pagos").select("id, centro").in("id", pagoIds) : { data: [] as { id: string; centro: string | null }[] };
    const todasDelCentro =
      (filas || []).length === facturaIds.length &&
      (pagos || []).length === pagoIds.length &&
      [...(filas || []), ...(pagos || [])].every((f) => f.centro === miProfile!.centro);
    if (!todasDelCentro) {
      return NextResponse.json({ error: "No puedes facturar cobros de otro centro" }, { status: 403 });
    }
  }

  // Uno por uno: Facturapi y el SAT limitan el ritmo, y un error en uno no frena los demás.
  const resultados = [];
  for (const id of facturaIds) {
    resultados.push(await facturarCobro(admin, id));
  }
  for (const id of pagoIds) {
    resultados.push(await facturarPagoSuelto(admin, id));
  }

  const fallidas = resultados.filter((r) => !r.ok);
  return NextResponse.json({ ok: fallidas.length === 0, resultados }, { status: fallidas.length === resultados.length ? 400 : 200 });
}
