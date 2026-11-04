import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { enviarFacturaAlCliente } from "@/lib/envioCfdi";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const MAXIMO_POR_LLAMADA = 50;

// Manda (o reenvía) por correo al cliente el PDF y el XML de una o varias facturas ya timbradas: botón del estado de
// cuenta y "Enviar por correo" en Facturas timbradas (para las que se emitieron antes de que se mandaran solas).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { facturaIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(facturaIds) || facturaIds.length === 0 || facturaIds.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir las facturas" }, { status: 400 });
  }
  if (facturaIds.length > MAXIMO_POR_LLAMADA) return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} por vez` }, { status: 400 });

  const admin = createAdminClient();
  const { data: filas } = await admin.from("facturas").select("id, folio, serie, folio_fiscal, centro").in("id", facturaIds);
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && !(filas || []).every((f) => f.centro === miProfile!.centro)) {
    return NextResponse.json({ error: "No puedes enviar facturas de otro centro" }, { status: 403 });
  }

  const resultados: { id: string; folio: string; ok: boolean; correo?: string; error?: string }[] = [];
  for (const id of facturaIds as string[]) {
    const fila = (filas || []).find((f) => f.id === id);
    const folio = fila ? (fila.serie && fila.folio_fiscal ? `${fila.serie}-${fila.folio_fiscal}` : fila.folio) : "";
    const r = await enviarFacturaAlCliente(admin, id);
    resultados.push("error" in r ? { id, folio, ok: false, error: r.error } : { id, folio, ok: true, correo: r.correo });
  }
  return NextResponse.json({ ok: true, resultados });
}
