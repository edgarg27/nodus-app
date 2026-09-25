import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";

// El cliente vuelve del 3D Secure de su banco: se consulta el cargo en Openpay y,
// si ya se completó, el pago queda pagado (igual que hace el webhook).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { pagoId, facturaId } = await req.json();
  if (!pagoId && !facturaId) return NextResponse.json({ error: "Falta el pago" }, { status: 400 });

  const admin = createAdminClient();
  let consulta = admin
    .from("pagos")
    .select("id, estado, openpay_charge_id")
    .eq("user_id", session.user.id)
    .not("openpay_charge_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  consulta = pagoId ? consulta.eq("id", pagoId) : consulta.eq("factura_id", facturaId);
  const { data: filas } = await consulta;
  const pago = filas?.[0];
  if (!pago?.openpay_charge_id) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  if (pago.estado === "pagado") return NextResponse.json({ ok: true, estado: "pagado" });

  try {
    const r = await confirmarPagoPorCargo(admin, pago.openpay_charge_id);
    return NextResponse.json({ ok: true, estado: r.estado });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "No se pudo verificar el pago" }, { status: 500 });
  }
}
