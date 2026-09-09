import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { consultarCargo } from "@/lib/openpay";

// Openpay manda un POST aquí cuando cambia el estatus de un cargo. Nunca
// confiamos en el contenido del webhook a ciegas — siempre se vuelve a
// consultar el cargo directo en Openpay con la llave privada antes de
// marcar algo como pagado.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // Openpay solo necesita un 200
  }

  const chargeId = body?.transaction?.id || body?.data?.transaction?.id;
  if (!chargeId) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  try {
    const cargo = await consultarCargo(chargeId);
    if (cargo.status !== "completed") {
      return NextResponse.json({ ok: true });
    }

    const { data: pago } = await admin
      .from("pagos")
      .select("id, factura_id, estado, user_id")
      .eq("openpay_charge_id", chargeId)
      .maybeSingle();

    if (pago && pago.estado !== "pagado") {
      await admin.from("pagos").update({ estado: "pagado" }).eq("id", pago.id);
      await admin.from("profiles").update({ suspendido: false }).eq("id", pago.user_id);

      const { data: factura } = await admin
        .from("facturas")
        .update({ estado: "pagada" })
        .eq("id", pago.factura_id)
        .select("folio, monto, centro")
        .single();

      const { data: cliente } = await admin
        .from("profiles")
        .select("nombre, email")
        .eq("id", pago.user_id)
        .single();

      if (factura?.centro) {
        await admin.from("notificaciones").insert({
          centro: factura.centro,
          tipo: "pago_confirmado",
          mensaje: `💰 Se confirmó el pago de ${cliente?.nombre || "un cliente"} — factura ${factura.folio} · $${Number(factura.monto).toLocaleString("es-MX")}`,
        });
      }
    }
  } catch (err) {
    console.error("Error procesando webhook de Openpay:", err);
  }

  // Openpay solo necesita un 200 para dejar de reintentar
  return NextResponse.json({ ok: true });
}
