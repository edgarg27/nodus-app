import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { refrescarCancelaciones } from "@/lib/facturapiCancelacion";
import { refrescarCancelacionesComplementos } from "@/lib/complementoPago";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Consulta a Facturapi cómo van las cancelaciones "en proceso" (las que esperan
// la aceptación del cliente) y actualiza su estatus. Se llama al abrir Facturas
// y desde el botón "Actualizar estatus".
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaCancelar") && !rolPuede(miProfile?.rol, "facturaDescargar")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { facturaIds } = await req.json().catch(() => ({ facturaIds: undefined }));
  let ids: string[] | undefined = Array.isArray(facturaIds) ? facturaIds.filter((i) => typeof i === "string") : undefined;

  const admin = createAdminClient();
  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    // Solo las del propio centro.
    const { data: delCentro } = await admin
      .from("facturas")
      .select("id")
      .eq("centro", miProfile!.centro)
      .eq("cancelacion_estatus", "en_proceso");
    const permitidos = new Set((delCentro || []).map((f) => f.id));
    ids = (ids ?? Array.from(permitidos)).filter((i) => permitidos.has(i));
  }

  const resultados = ids && ids.length === 0 ? [] : await refrescarCancelaciones(admin, ids);
  // También los complementos de pago cuya cancelación esperaba al cliente.
  const complementosCambiados = await refrescarCancelacionesComplementos(admin, ROLES_GLOBALES.includes(miProfile!.rol) ? null : miProfile!.centro);
  return NextResponse.json({ ok: true, resultados, complementosCambiados });
}
