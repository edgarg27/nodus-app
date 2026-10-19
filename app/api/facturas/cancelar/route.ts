import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { cancelarFactura, MOTIVOS_CANCELACION } from "@/lib/facturapiCancelacion";

const REGEX_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// El folio de sustitución se puede escribir como serie-folio (A-9779), como el folio interno del estado de cuenta
// (A-914791) o como UUID. Devuelve el UUID de la factura que sustituye, o null si no la encuentra.
async function resolverSustituta(admin: ReturnType<typeof createAdminClient>, texto: string): Promise<string | null> {
  const t = texto.trim();
  if (REGEX_UUID.test(t)) return t.toLowerCase();
  const { data: porFolio } = await admin.from("facturas").select("uuid_cfdi").eq("folio", t).not("uuid_cfdi", "is", null).limit(1).maybeSingle();
  if (porFolio?.uuid_cfdi) return porFolio.uuid_cfdi;
  const m = t.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (m) {
    const { data: porSerie } = await admin.from("facturas").select("uuid_cfdi").eq("serie", m[1].toUpperCase()).eq("folio_fiscal", m[2]).not("uuid_cfdi", "is", null).limit(1).maybeSingle();
    if (porSerie?.uuid_cfdi) return porSerie.uuid_cfdi;
  }
  return null;
}

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
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
    if (!sustituta) {
      return NextResponse.json({ error: "Con ese motivo hay que indicar el folio de la factura que la sustituye" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  let sustitutaUuidFinal = sustituta;
  if (motivo === "01") {
    const uuid = await resolverSustituta(admin, sustituta);
    if (!uuid) {
      return NextResponse.json({ error: "No encontré la factura de sustitución con ese folio. Escribe su serie y folio (por ejemplo A-9779) o su UUID." }, { status: 400 });
    }
    sustitutaUuidFinal = uuid;
  }

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
    resultados.push(await cancelarFactura(admin, id, { motivo, sustitutaUuid: sustitutaUuidFinal || null, usuarioId: session.user.id }));
  }

  const fallidas = resultados.filter((r) => !r.ok);
  return NextResponse.json({ ok: fallidas.length === 0, resultados }, { status: fallidas.length === resultados.length ? 400 : 200 });
}
