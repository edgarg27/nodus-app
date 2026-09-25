import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { crearCargoTarjeta } from "@/lib/openpay";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";
import { registrarCargoEnPago, resolverCobroCliente } from "@/lib/cobroCliente";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";
import { POLITICA_CANCELACION_VERSION } from "@/lib/politicaCancelacion";

// Cobro con tarjeta de un pago del propio cliente (una factura o un pago suelto
// como la renta o el depósito de un contrato). El navegador manda solo el token
// que generó Openpay.js: el número de la tarjeta nunca pasa por aquí.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Tope de intentos por cuenta: evita que se use para probar tarjetas.
  if (!checkRateLimit(`pagar-tarjeta:${session.user.id}:${ipDeRequest(req.headers)}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
  }

  const { pagoId, facturaId, tokenId, deviceSessionId, politicaVersion } = await req.json();
  if (politicaVersion !== POLITICA_CANCELACION_VERSION) {
    return NextResponse.json({ error: "Para pagar, acepta la política de cancelación y reembolsos" }, { status: 400 });
  }
  if (!tokenId || !deviceSessionId || (!pagoId && !facturaId)) {
    return NextResponse.json({ error: "Faltan datos del pago" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Qué se va a cobrar: siempre algo que sea del cliente que pide el cobro.
  const r = await resolverCobroCliente(admin, session.user.id, { pagoId, facturaId });
  if (r.ok === false) return NextResponse.json({ error: r.error }, { status: r.status });
  const { monto, descripcion, pagoExistenteId, facturaDelPagoId } = r.cobro;

  const { data: perfil } = await admin.from("profiles").select("nombre, email").eq("id", session.user.id).maybeSingle();
  // A dónde regresa el cliente después de verificarse con su banco. En producción
  // conviene fijar NEXT_PUBLIC_SITE_URL (https://tu-dominio) para no depender del
  // encabezado de la petición.
  const origen = (process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin).replace(/\/+$/, "");
  const referencia = pagoExistenteId ? `pagoId=${pagoExistenteId}` : `facturaId=${facturaDelPagoId}`;

  try {
    const cargo = await crearCargoTarjeta({
      tokenId,
      deviceSessionId,
      monto,
      descripcion,
      ordenId: `${pagoExistenteId || facturaDelPagoId}-${Date.now().toString(36)}`,
      nombre: perfil?.nombre || "Cliente Nodus",
      email: perfil?.email || session.user.email || "",
      redirectUrl: `${origen}/pagar-tarjeta?${referencia}&retorno=1`,
    });

    // Se registra el cargo en el pago (o se crea el pago de la factura) para que
    // el webhook y la verificación lo encuentren.
    const errorRegistro = await registrarCargoEnPago(admin, session.user.id, r.cobro, cargo.id, "Cargo con tarjeta vía Openpay");
    if (errorRegistro) return NextResponse.json({ error: errorRegistro }, { status: 500 });

    // Queda registrado qué política aceptó (necesita migracion_politica_cancelacion.sql;
    // si esa migración aún no se corrió, el pago sigue su curso sin el registro).
    await admin
      .from("pagos")
      .update({ politica_version: politicaVersion, politica_aceptada_at: new Date().toISOString() })
      .eq("openpay_charge_id", cargo.id);

    if (cargo.status === "completed") {
      const resultado = await confirmarPagoPorCargo(admin, cargo.id);
      return NextResponse.json({ ok: true, estado: resultado.estado });
    }
    if (cargo.payment_method?.url) {
      return NextResponse.json({ ok: true, estado: "verificacion", redirect: cargo.payment_method.url });
    }
    return NextResponse.json({ ok: true, estado: cargo.status });
  } catch (err: any) {
    // Tarjeta rechazada, fondos insuficientes, etc.: Openpay explica el motivo.
    return NextResponse.json({ error: err?.message || "No se pudo procesar el cargo con tarjeta" }, { status: 402 });
  }
}
