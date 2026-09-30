import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";

// Botón "verificar pago" del cliente en /pagar-spei. Usa el mismo camino que
// el webhook y la verificación de tarjeta (confirmarPagoPorCargo) para no
// duplicar la lógica de marcar pagado — incluye la factura automática.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { pagoId } = await req.json();
  if (!pagoId) {
    return NextResponse.json({ error: "Falta pagoId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pago } = await admin
    .from("pagos")
    .select("id, openpay_charge_id, estado")
    .eq("id", pagoId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!pago || !pago.openpay_charge_id) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }

  if (pago.estado === "pagado") {
    return NextResponse.json({ ok: true, estado: "pagado" });
  }

  try {
    const resultado = await confirmarPagoPorCargo(admin, pago.openpay_charge_id);
    if (resultado.estado === "pagado") {
      return NextResponse.json({ ok: true, estado: "pagado" });
    }
    return NextResponse.json({ ok: true, estado: "pendiente_spei", openpayStatus: resultado.estado });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "No se pudo verificar el pago" }, { status: 500 });
  }
}
