import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { facturarPublicoGeneral } from "@/lib/facturaPublicoGeneral";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Factura a público en general (venta de mostrador): se timbra al momento, ya pagada.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { centro, concepto, monto, formaPago, adicionalTipo } = await req.json();
  if (typeof centro !== "string" || !centro || typeof concepto !== "string" || typeof formaPago !== "string" || typeof monto !== "number") {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }
  // Admin y cobranza solo facturan en su centro.
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes facturar en otro centro" }, { status: 403 });
  }

  const r = await facturarPublicoGeneral(createAdminClient(), {
    centro,
    concepto,
    monto,
    formaPago,
    adicionalTipo: typeof adicionalTipo === "string" && adicionalTipo ? adicionalTipo : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, facturaId: r.facturaId, uuid: r.uuid, folio: r.folio });
}
