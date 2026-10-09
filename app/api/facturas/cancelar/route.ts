import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { cancelarFactura, MOTIVOS_CANCELACION } from "@/lib/facturapiCancelacion";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const MAXIMO_POR_LLAMADA = 50;

// Cancela ante el SAT una o varias facturas (CFDI) emitidas desde Nodus, todas
// con el mismo motivo. El motivo 01 exige el UUID de la factura que la
// sustituye, así que solo se acepta de una en una.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaCancelar")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { facturaIds, motivo, sustitutaUuid } = await req.json();
  if (!Array.isArray(facturaIds) || facturaIds.length === 0 || facturaIds.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir las facturas" }, { status: 400 });
  }
  if (facturaIds.length > MAXIMO_POR_LLAMADA) {
    return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} facturas por vez` }, { status: 400 });
  }
  if (!motivo || !MOTIVOS_CANCELACION[motivo]) {
    return NextResponse.json({ error: "Elige el motivo de cancelación" }, { status: 400 });
  }
  const sustituta = typeof sustitutaUuid === "string" ? sustitutaUuid.trim() : "";
  if (motivo === "01") {
    if (facturaIds.length > 1) {
      return NextResponse.json({ error: "El motivo 01 se cancela de una en una (cada una lleva su sustituta)" }, { status: 400 });
    }
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sustituta)) {
      return NextResponse.json({ error: "Con el motivo 01 hay que indicar el UUID de la factura que la sustituye" }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const { data: filas } = await admin.from("facturas").select("id, centro").in("id", facturaIds);
    const todasDelCentro = !!filas && filas.length === facturaIds.length && filas.every((f) => f.centro === miProfile!.centro);
    if (!todasDelCentro) {
      return NextResponse.json({ error: "No puedes cancelar facturas de otro centro" }, { status: 403 });
    }
  }

  // Una por una (el SAT y Facturapi limitan el ritmo); un error en una no frena las demás.
  const resultados = [];
  for (const id of facturaIds) {
    resultados.push(await cancelarFactura(admin, id, { motivo, sustitutaUuid: sustituta || null, usuarioId: session.user.id }));
  }

  const fallidas = resultados.filter((r) => !r.ok);
  return NextResponse.json({ ok: fallidas.length === 0, resultados }, { status: fallidas.length === resultados.length ? 400 : 200 });
}
