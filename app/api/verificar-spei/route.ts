import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consultarCargo } from "@/lib/openpay";

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

  const { data: pago } = await supabase
    .from("pagos")
    .select("id, openpay_charge_id, factura_id, user_id, estado")
    .eq("id", pagoId)
    .eq("user_id", session.user.id)
    .single();

  if (!pago || !pago.openpay_charge_id) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }

  if (pago.estado === "pagado") {
    return NextResponse.json({ ok: true, estado: "pagado" });
  }

  try {
    const cargo = await consultarCargo(pago.openpay_charge_id);

    if (cargo.status === "completed") {
      await supabase.from("pagos").update({ estado: "pagado" }).eq("id", pago.id);
      await supabase.from("profiles").update({ suspendido: false }).eq("id", session.user.id);

      const { data: factura } = await supabase
        .from("facturas")
        .update({ estado: "pagada" })
        .eq("id", pago.factura_id)
        .select("folio, monto, centro")
        .single();

      const { data: cliente } = await supabase
        .from("profiles")
        .select("nombre")
        .eq("id", session.user.id)
        .single();

      if (factura?.centro) {
        await supabase.from("notificaciones").insert({
          centro: factura.centro,
          tipo: "pago_confirmado",
          mensaje: `💰 Se confirmó el pago de ${cliente?.nombre || "un cliente"} — factura ${factura.folio} · $${Number(factura.monto).toLocaleString("es-MX")}`,
        });
      }

      return NextResponse.json({ ok: true, estado: "pagado" });
    }

    return NextResponse.json({ ok: true, estado: "pendiente_spei", openpayStatus: cargo.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "No se pudo verificar el pago" }, { status: 500 });
  }
}
