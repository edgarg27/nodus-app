import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import { leerCorreosExtra } from "@/lib/correosFactura";
import {
  DATOS_PUBLICO_GENERAL,
  RFC_PUBLICO_GENERAL,
  domicilioParaGuardar,
  normalizarRfc,
  validarDatosFiscales,
  type TipoPersonaFiscal,
} from "@/lib/datosFiscales";
import { cpLugarExpedicion } from "@/lib/facturapi";

// Un contrato que sigue en curso (o por empezar): a ese cliente se le factura cada mes, a veces antes de
// que pague (PPD) y con complemento de pago, y eso no se puede con el RFC de público en general.
const ESTATUS_CONTRATO_EN_CURSO = ["vigente", "pre_aprobado"];

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

  let datos = {
    rfc: normalizarRfc(body?.rfc),
    nombre_fiscal: String(body?.nombre_fiscal || "").trim().toUpperCase(),
    regimen_fiscal: String(body?.regimen_fiscal || ""),
    cp_fiscal: String(body?.cp_fiscal || "").trim(),
    uso_cfdi: String(body?.uso_cfdi || ""),
  };
  // Público en general: solo para clientes SIN contrato en curso (Day Pass, sala de juntas…). Su nombre,
  // régimen y uso van fijos, y en CFDI 4.0 su código postal es el del lugar de expedición del emisor.
  if (datos.rfc === RFC_PUBLICO_GENERAL) {
    const { count } = await admin
      .from("contratos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("estatus", ESTATUS_CONTRATO_EN_CURSO);
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: "Este cliente tiene un contrato vigente: escribe su RFC real (el de público en general no admite sus facturas mensuales)" },
        { status: 400 }
      );
    }
    let cp = datos.cp_fiscal;
    try {
      cp = await cpLugarExpedicion();
    } catch {
      // Sin acceso a Facturapi se queda el que escribieron; al timbrar se valida.
    }
    datos = { ...datos, ...DATOS_PUBLICO_GENERAL, cp_fiscal: cp };
  }
  // El tipo de persona sale del RFC: 12 caracteres es empresa (moral), 13 es persona física.
  const tipo: TipoPersonaFiscal = datos.rfc.length === 12 ? "moral" : "fisica";
  const msg = validarDatosFiscales(datos, tipo);
  if (msg) return NextResponse.json({ error: msg }, { status: 400 });

  // El domicilio solo va en el perfil: los contratos no tienen esas columnas.
  const domicilio = domicilioParaGuardar(body);
  // Concepto predefinido de sus facturas: solo si viene (el modal del cliente en el panel no lo manda). Vacío = el del sistema.
  const concepto =
    body && "concepto_factura" in body ? { concepto_factura: String(body.concepto_factura || "").trim().replace(/\s+/g, " ").slice(0, 200) || null } : {};
  // Correos adicionales para sus facturas (opcionales): solo si vienen.
  let correos: { correos_factura?: string[] | null } = {};
  if (body && "correos_factura" in body) {
    const { data: cuenta } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
    const leidos = leerCorreosExtra(body.correos_factura, cuenta?.email);
    if ("error" in leidos) return NextResponse.json({ error: "Correos adicionales: " + leidos.error }, { status: 400 });
    correos = { correos_factura: leidos.correos.length > 0 ? leidos.correos : null };
  }
  const { error } = await admin.from("profiles").update({ ...datos, ...domicilio, ...concepto, ...correos }).eq("id", userId);
  if (error) return NextResponse.json({ error: "No se pudieron guardar los datos fiscales: " + error.message }, { status: 500 });

  // Contratos sin RFC real (vacío o público en general): se ponen al día. Los que ya traen un RFC van con el documento firmado.
  await admin.from("contratos").update(datos).eq("user_id", userId).or(`rfc.is.null,rfc.eq.,rfc.eq.${RFC_PUBLICO_GENERAL}`);

  return NextResponse.json({ ok: true, datos: { ...datos, ...domicilio, ...concepto, ...correos } });
}
