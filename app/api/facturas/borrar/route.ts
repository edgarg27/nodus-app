import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { registrarBitacora } from "@/lib/bitacora";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const MAXIMO_POR_LLAMADA = 50;

const MOTIVO: Record<string, string> = {
  no_existe: "ya no existe",
  timbrada: "ya está timbrada: cancélala ante el SAT",
  pagada: "ya está pagada o cancelada",
  cobro_diario: "la generó el cobro diario: si no procede, cancélala",
  con_pago: "ya tiene un pago registrado o un cargo en línea",
};

// Borra integraciones (estados de cuenta) que todavía no se timbran ni se cobran: Estados de cuenta > casilla >
// Borrar. Lo hace la base en un solo paso (borrar_estado_de_cuenta, migracion_concepto_factura_y_borrar_estado_cuenta.sql):
// los adicionales que se habían ligado vuelven a quedar por integrar y la renta del mes vuelve a salir en Previa.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaCancelar")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { facturaIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(facturaIds) || facturaIds.length === 0 || facturaIds.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir los estados de cuenta" }, { status: 400 });
  }
  if (facturaIds.length > MAXIMO_POR_LLAMADA) return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} por vez` }, { status: 400 });

  const admin = createAdminClient();
  const { data: filas } = await admin.from("facturas").select("id, folio, centro, user_id").in("id", facturaIds);
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && !(filas || []).every((f) => f.centro === miProfile!.centro)) {
    return NextResponse.json({ error: "No puedes borrar estados de cuenta de otro centro" }, { status: 403 });
  }

  const resultados: { id: string; folio: string; ok: boolean; error?: string }[] = [];
  for (const id of facturaIds as string[]) {
    const folio = (filas || []).find((f) => f.id === id)?.folio || "";
    const { data, error } = await admin.rpc("borrar_estado_de_cuenta", { p_factura: id });
    if (error) resultados.push({ id, folio, ok: false, error: "no se pudo borrar: " + error.message });
    else if (data !== "ok") resultados.push({ id, folio, ok: false, error: MOTIVO[String(data)] || String(data) });
    else resultados.push({ id, folio, ok: true });
  }

  // Bitácora: quién borró el estado de cuenta y cuándo (se registra después, aunque la factura ya no exista).
  for (const r of resultados.filter((x) => x.ok)) {
    const f = (filas || []).find((x) => x.id === r.id);
    await registrarBitacora(admin, {
      actorId: session.user.id,
      accion: "factura_borrada",
      entidad: "factura",
      entidadId: r.id,
      folio: r.folio,
      clienteId: f?.user_id || null,
      centro: f?.centro || null,
    });
  }

  return NextResponse.json({ ok: true, resultados });
}
