import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

// Los folios son consecutivos: sin límite se podrían recorrer todos para
// sacar nombres de clientes. 20 consultas por IP cada 5 minutos sobra para
// un uso normal.
const MAX_CONSULTAS = 20;
const VENTANA_MS = 5 * 60 * 1000;

// Público: nombre de pila + iniciales del resto ("Juan Pérez García" ->
// "Juan P. G."). Suficiente para que el dueño reconozca su tarjeta sin
// exponer nombres completos a quien adivine un folio.
function nombreParcial(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] || "";
  return [partes[0], ...partes.slice(1).map((p) => p[0].toUpperCase() + ".")].join(" ");
}

// Endpoint público (sin sesión) — lo usa la consulta de tarjeta para que el
// cliente vea el estado de su tarjeta con solo su folio. Nunca regresa
// teléfono/correo (igual de discreto que /api/day-pass).
export async function GET(req: NextRequest, { params }: { params: { folio: string } }) {
  if (!checkRateLimit(`fidelidad:${ipDeRequest(req.headers)}`, MAX_CONSULTAS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiadas consultas. Intenta más tarde." }, { status: 429 });
  }

  const folio = Number(params.folio);
  if (!folio || !Number.isInteger(folio)) {
    return NextResponse.json({ error: "Folio inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: tarjeta, error } = await admin
    .from("tarjetas_fidelidad")
    .select("id, folio, nombre, centro, estado")
    .eq("folio", folio)
    .maybeSingle();

  if (error || !tarjeta) {
    return NextResponse.json({ error: "Tarjeta no encontrada" }, { status: 404 });
  }

  const { data: sellos } = await admin
    .from("tarjetas_fidelidad_sellos")
    .select("numero, tipo_espacio, detalle, created_at")
    .eq("tarjeta_id", tarjeta.id)
    .order("numero", { ascending: true });

  return NextResponse.json({
    folio: tarjeta.folio,
    nombre: nombreParcial(tarjeta.nombre || ""),
    centro: tarjeta.centro,
    estado: tarjeta.estado,
    sellos: sellos || [],
  });
}
