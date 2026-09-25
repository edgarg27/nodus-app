import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";

// Openpay manda un POST aquí cuando cambia el estatus de un cargo (SPEI o
// tarjeta). Nunca confiamos en el contenido del webhook a ciegas: confirmarPagoPorCargo
// vuelve a consultar el cargo directo en Openpay con la llave privada antes de
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

  try {
    await confirmarPagoPorCargo(createAdminClient(), chargeId);
  } catch (err) {
    console.error("Error procesando webhook de Openpay:", err);
  }

  // Openpay solo necesita un 200 para dejar de reintentar
  return NextResponse.json({ ok: true });
}
