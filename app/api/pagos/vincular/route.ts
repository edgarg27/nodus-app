import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

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

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { pagoIds, facturaId } = await req.json();
  if (!facturaId || !Array.isArray(pagoIds) || pagoIds.length === 0) {
    return NextResponse.json({ error: "Faltan pagoIds o facturaId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("pagos").update({ factura_id: facturaId }).in("id", pagoIds);
  if (error) {
    return NextResponse.json({ error: "No se pudieron vincular los pagos" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
