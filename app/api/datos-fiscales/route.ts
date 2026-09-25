import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { RFC_PUBLICO_GENERAL, normalizarRfc, validarDatosFiscales, type TipoPersonaFiscal } from "@/lib/datosFiscales";

// El cliente completa o corrige sus propios datos fiscales (por ejemplo, después de
// haber entrado como "público en general"). Se guardan en su perfil y, en sus
// contratos que todavía no tenían un RFC real, para que la facturación use los datos
// buenos. Los contratos que ya traen un RFC no se tocan: van con el documento firmado.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const tipo: TipoPersonaFiscal = body?.tipo === "moral" ? "moral" : "fisica";
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

  const admin = createAdminClient();
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
