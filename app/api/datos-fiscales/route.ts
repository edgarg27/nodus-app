import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { RFC_PUBLICO_GENERAL, normalizarRfc, validarDatosFiscales, type TipoPersonaFiscal } from "@/lib/datosFiscales";

// El cliente completa o corrige sus propios datos fiscales (por ejemplo, después de
// haber entrado como "público en general"). Se guardan en su perfil y, en sus
// contratos que todavía no tenían un RFC real, para que la facturación use los datos
// buenos. Los contratos que ya traen un RFC no se tocan: van con el documento firmado.
// El tipo de persona (física/moral) NO lo elige el cliente: es el que se
// capturó al cotizar. Se toma de la cotización ligada a su contrato más
// reciente; si no hay, de cualquier cotización a su nombre; si tampoco,
// del RFC que ya tenga guardado (12 caracteres = moral).
async function tipoPersonaDelCliente(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<TipoPersonaFiscal> {
  const { data: contratos } = await admin
    .from("contratos")
    .select("cotizacion_id")
    .eq("user_id", userId)
    .not("cotizacion_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const ids = (contratos || []).map((c) => c.cotizacion_id).filter(Boolean);
  let cot: { tipo_persona: string | null } | null = null;
  if (ids.length > 0) {
    const { data } = await admin
      .from("cotizaciones_comerciales")
      .select("tipo_persona, created_at")
      .in("id", ids)
      .not("tipo_persona", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    cot = data;
  }
  if (!cot) {
    const { data } = await admin
      .from("cotizaciones_comerciales")
      .select("tipo_persona")
      .eq("cliente_id", userId)
      .not("tipo_persona", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    cot = data;
  }
  if (cot?.tipo_persona) return cot.tipo_persona === "moral" ? "moral" : "fisica";
  const { data: perfil } = await admin.from("profiles").select("rfc").eq("id", userId).maybeSingle();
  return normalizarRfc(perfil?.rfc || "").length === 12 ? "moral" : "fisica";
}

// Para que la pantalla muestre (sin dejar cambiar) si es persona física o moral.
export async function GET() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const tipo = await tipoPersonaDelCliente(createAdminClient(), session.user.id);
  return NextResponse.json({ tipo });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const admin = createAdminClient();
  // Se ignora el tipo que mande el navegador: manda el de su cotización.
  const tipo = await tipoPersonaDelCliente(admin, session.user.id);
  const datos = {
    rfc: normalizarRfc(body?.rfc),
    nombre_fiscal: String(body?.nombre_fiscal || "").trim(),
    regimen_fiscal: String(body?.regimen_fiscal || ""),
    cp_fiscal: String(body?.cp_fiscal || "").trim(),
    uso_cfdi: String(body?.uso_cfdi || ""),
  };

  if (datos.rfc === RFC_PUBLICO_GENERAL) {
    return NextResponse.json({ error: "Escribe tu RFC: el genérico de público en general no sirve para deducir tu factura" }, { status: 400 });
  }
  const msg = validarDatosFiscales(datos, tipo);
  if (msg) return NextResponse.json({ error: msg }, { status: 400 });

  const { error: perfilError } = await admin.from("profiles").update(datos).eq("id", session.user.id);
  if (perfilError) {
    return NextResponse.json({ error: "No se pudieron guardar tus datos fiscales: " + perfilError.message }, { status: 500 });
  }

  // Contratos sin RFC real (vacío o público en general): se ponen al día.
  await admin
    .from("contratos")
    .update(datos)
    .eq("user_id", session.user.id)
    .or(`rfc.is.null,rfc.eq.,rfc.eq.${RFC_PUBLICO_GENERAL}`);

  return NextResponse.json({ ok: true });
}
