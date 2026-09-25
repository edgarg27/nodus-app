import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { cobrarTarjetaGuardada } from "@/lib/openpay";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";
import { registrarCargoEnPago, resolverCobroCliente } from "@/lib/cobroCliente";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";
import { POLITICA_CANCELACION_VERSION } from "@/lib/politicaCancelacion";

// Pago de una factura o pago suelto del propio cliente con una tarjeta que ya tiene
// guardada (Mis tarjetas). El cliente está presente y confirma el pago, así que no
// cuenta como cobro automático: no toca los fallos ni la autorización del cobro
// automático de esa tarjeta.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!checkRateLimit(`pagar-tarjeta:${session.user.id}:${ipDeRequest(req.headers)}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
  }

  const { pagoId, facturaId, tarjetaId, politicaVersion } = await req.json();
  if (politicaVersion !== POLITICA_CANCELACION_VERSION) {
    return NextResponse.json({ error: "Para pagar, acepta la política de cancelación y reembolsos" }, { status: 400 });
  }
  if (!tarjetaId || (!pagoId && !facturaId)) {
    return NextResponse.json({ error: "Faltan datos del pago" }, { status: 400 });
  }

  const admin = createAdminClient();

  // La tarjeta tiene que ser del propio cliente y seguir activa.
  const { data: tarjeta } = await admin
    .from("tarjetas_guardadas")
    .select("id, openpay_customer_id, openpay_card_id, ultimos4")
    .eq("id", tarjetaId)
    .eq("user_id", session.user.id)
    .eq("activa", true)
    .maybeSingle();
  if (!tarjeta) return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });

  const r = await resolverCobroCliente(admin, session.user.id, { pagoId, facturaId });
  if (r.ok === false) return NextResponse.json({ error: r.error }, { status: r.status });
  const { cobro } = r;

  try {
    const cargo = await cobrarTarjetaGuardada({
      customerId: tarjeta.openpay_customer_id,
      cardId: tarjeta.openpay_card_id,
      monto: cobro.monto,
      descripcion: cobro.descripcion,
      ordenId: `${cobro.pagoExistenteId || cobro.facturaDelPagoId}-tg-${Date.now().toString(36)}`,
      deviceSessionId: randomUUID().replace(/-/g, ""),
    });

    const errorRegistro = await registrarCargoEnPago(
      admin,
      session.user.id,
      cobro,
      cargo.id,
      `Cargo con tarjeta guardada ****${tarjeta.ultimos4 || ""} vía Openpay`
    );
    if (errorRegistro) return NextResponse.json({ error: errorRegistro }, { status: 500 });

    // Queda registrado qué política aceptó (necesita migracion_politica_cancelacion.sql;
    // si esa migración aún no se corrió, el pago sigue su curso sin el registro).
    await admin
      .from("pagos")
      .update({ politica_version: politicaVersion, politica_aceptada_at: new Date().toISOString() })
      .eq("openpay_charge_id", cargo.id);

    if (cargo.status !== "completed") {
      // El banco no lo aprobó al momento (por ejemplo, pide verificación): se le pide otra tarjeta.
      return NextResponse.json(
        { error: cargo.error_message || "El banco no aprobó el cobro con esta tarjeta. Prueba con otra tarjeta o paga por SPEI." },
        { status: 402 }
      );
    }
    const resultado = await confirmarPagoPorCargo(admin, cargo.id);
    return NextResponse.json({ ok: true, estado: resultado.estado });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "No se pudo cobrar la tarjeta guardada" }, { status: 402 });
  }
}
