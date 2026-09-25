import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";

// Asocia uno o más pagos existentes (sin factura) a una factura — lo usa
// facturas-admin para vincular un pago suelto (ej. de comprobante o SPEI
// generado aparte) a la factura correspondiente. Solo cambia `factura_id`,
// no `estado` — si alguno de esos pagos ya estaba "pagado" antes de
// vincularse, el trigger sync_factura_estado no se dispara con este update
// (ver DOCUMENTACION_FACTURAS.md sección 3); la factura se actualiza sola
// hasta el siguiente cambio de estado de algún pago vinculado.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { pagoIds, facturaId } = await req.json();
  if (!facturaId || !Array.isArray(pagoIds) || pagoIds.length === 0) {
    return NextResponse.json({ error: "Faltan pagoIds o facturaId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
  const esGlobal = ROLES_GLOBALES.includes(miProfile.rol);

  if (!esGlobal) {
    const [{ data: factura }, { data: pagos }] = await Promise.all([
      admin.from("facturas").select("centro").eq("id", facturaId).single(),
      admin.from("pagos").select("id, centro").in("id", pagoIds),
    ]);

    const facturaOk = factura?.centro === miProfile.centro;
    const pagosOk = !!pagos && pagos.length === pagoIds.length && pagos.every((p) => p.centro === miProfile.centro);

    if (!facturaOk || !pagosOk) {
      return NextResponse.json({ error: "No puedes vincular pagos o facturas de otro centro" }, { status: 403 });
    }
  }

  const { error } = await admin.from("pagos").update({ factura_id: facturaId }).in("id", pagoIds);
  if (error) {
    return NextResponse.json({ error: "No se pudieron vincular los pagos" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
