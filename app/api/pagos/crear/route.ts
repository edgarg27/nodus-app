import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Genera un registro de cobro suelto (sin factura ni cargo SPEI) para el
// módulo Cotizar: renta/depósito/adicionales al aprobar un contrato, o el
// pago inicial de una reserva. No hay dinero real de por medio — el
// cliente confirma manualmente desde /pagar-simulado/{id} (botón "Simular
// pago" → POST /api/pagos/simular), igual que documenta
// DOCUMENTACION_FACTURAS.md sección 1.1.
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

  const { clienteId, monto, concepto, contratoId, centro } = await req.json();
  if (!clienteId || !monto || !concepto || !centro) {
    return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pago, error } = await admin
    .from("pagos")
    .insert({
      user_id: clienteId,
      monto: Number(monto),
      concepto,
      contrato_id: contratoId || null,
      centro,
      estado: "pendiente",
    })
    .select()
    .single();

  if (error || !pago) {
    return NextResponse.json({ error: "No se pudo generar el pago" }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  const linkPago = `${origin}/pagar-simulado/${pago.id}`;
  await admin.from("pagos").update({ link_pago: linkPago }).eq("id", pago.id);

  return NextResponse.json({ ok: true, pago: { ...pago, link_pago: linkPago } });
}
