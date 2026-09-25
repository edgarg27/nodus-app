import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { crearCargoTarjeta } from "@/lib/openpay";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

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

  const { pagoId, facturaId, tokenId, deviceSessionId } = await req.json();
  if (!tokenId || !deviceSessionId || (!pagoId && !facturaId)) {
    return NextResponse.json({ error: "Faltan datos del pago" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Qué se va a cobrar: siempre algo que sea del cliente que pide el cobro.
  let monto = 0;
  let descripcion = "";
  let pagoExistenteId: string | null = null;
  let facturaDelPagoId: string | null = null;
  if (pagoId) {
    const { data: pago } = await admin
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, user_id")
      .eq("id", pagoId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!pago) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    if (pago.estado === "pagado") return NextResponse.json({ error: "Este pago ya está pagado" }, { status: 400 });
    monto = Number(pago.monto);
    descripcion = pago.concepto || "Pago Nodus";
    pagoExistenteId = pago.id;
    facturaDelPagoId = pago.factura_id;
  } else {
    const { data: factura } = await admin
      .from("facturas")
      .select("id, folio, concepto, monto, estado, user_id")
      .eq("id", facturaId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!factura) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    if (factura.estado === "pagada") return NextResponse.json({ error: "Esta factura ya está pagada" }, { status: 400 });
    monto = Number(factura.monto);
    descripcion = `${factura.folio} - ${factura.concepto}`;
    facturaDelPagoId = factura.id;
  }
  if (!(monto > 0)) return NextResponse.json({ error: "El monto a cobrar no es válido" }, { status: 400 });

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
    if (pagoExistenteId) {
      await admin
        .from("pagos")
        .update({ openpay_charge_id: cargo.id, notas: "Cargo con tarjeta vía Openpay" })
        .eq("id", pagoExistenteId);
    } else {
      const { error: insErr } = await admin.from("pagos").insert({
        factura_id: facturaDelPagoId,
        user_id: session.user.id,
        monto,
        estado: "pendiente",
        notas: "Cargo con tarjeta vía Openpay",
        openpay_charge_id: cargo.id,
      });
      if (insErr) {
        return NextResponse.json({ error: "El cargo se generó pero no se pudo registrar. Avisa al centro." }, { status: 500 });
      }
    }

    if (cargo.status === "completed") {
      const r = await confirmarPagoPorCargo(admin, cargo.id);
      return NextResponse.json({ ok: true, estado: r.estado });
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
