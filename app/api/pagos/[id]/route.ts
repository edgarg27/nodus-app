import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Público, sin sesión — lo usa /pagar-simulado/[id] para mostrar el
// monto/concepto antes de confirmar. Solo expone pagos sin factura_id
// (el flujo simulado); los de facturación real no se resuelven aquí.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: pago } = await admin
    .from("pagos")
    .select("id, monto, concepto, estado, factura_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!pago || pago.factura_id) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ id: pago.id, monto: pago.monto, concepto: pago.concepto, estado: pago.estado });
}
