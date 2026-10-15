import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import { RFC_PUBLICO_GENERAL, normalizarRfc, validarDatosFiscales, type TipoPersonaFiscal } from "@/lib/datosFiscales";

// Configuración fiscal (Facturación): finanzas corrige los datos fiscales de un cliente (los que se capturaron al
// ligar su contrato) si vienen con errores o si la empresa los cambió. Las facturas ya timbradas no cambian: si
// estaban mal, se cancelan y se vuelven a emitir.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) {
    return NextResponse.json({ error: "Solo finanzas y administración pueden cambiar los datos fiscales" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId: string = typeof body?.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, miProfile!.rol, miProfile!.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok) return NextResponse.json({ error: "No puedes cambiar clientes de otro centro" }, { status: 403 });

  const datos = {
    rfc: normalizarRfc(body?.rfc),
    nombre_fiscal: String(body?.nombre_fiscal || "").trim().toUpperCase(),
    regimen_fiscal: String(body?.regimen_fiscal || ""),
    cp_fiscal: String(body?.cp_fiscal || "").trim(),
    uso_cfdi: String(body?.uso_cfdi || ""),
  };
  if (datos.rfc === RFC_PUBLICO_GENERAL) {
    return NextResponse.json({ error: "Escribe el RFC del cliente: el genérico de público en general no aplica a un cliente con contrato" }, { status: 400 });
  }
  // El tipo de persona sale del RFC: 12 caracteres es empresa (moral), 13 es persona física.
  const tipo: TipoPersonaFiscal = datos.rfc.length === 12 ? "moral" : "fisica";
  const msg = validarDatosFiscales(datos, tipo);
  if (msg) return NextResponse.json({ error: msg }, { status: 400 });

  const { error } = await admin.from("profiles").update(datos).eq("id", userId);
  if (error) return NextResponse.json({ error: "No se pudieron guardar los datos fiscales: " + error.message }, { status: 500 });

  // Contratos sin RFC real (vacío o público en general): se ponen al día. Los que ya traen un RFC van con el documento firmado.
  await admin.from("contratos").update(datos).eq("user_id", userId).or(`rfc.is.null,rfc.eq.,rfc.eq.${RFC_PUBLICO_GENERAL}`);

  return NextResponse.json({ ok: true, datos });
}
