import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Público (sin sesión) — lo llama /tarjeta-fidelidad para crear la tarjeta y
// recibir su folio. Se hace desde el servidor porque leer el folio de vuelta
// exigiría dar permiso de lectura público sobre la tabla (nombres y teléfonos
// de todos los clientes), que no queremos.
const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const centro = String(body?.centro || "");
  const nombre = String(body?.nombre || "").trim().slice(0, 120);
  const telefono = String(body?.telefono || "").trim().slice(0, 30);
  const email = String(body?.email || "").trim().slice(0, 160);

  if (!CENTROS.includes(centro)) return NextResponse.json({ error: "Centro no válido" }, { status: 400 });
  if (!nombre || !telefono) return NextResponse.json({ error: "Nombre y teléfono son obligatorios" }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "El correo no es válido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tarjetas_fidelidad")
    .insert({ centro, nombre, telefono, email: email || null })
    .select("folio")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No se pudo crear la tarjeta" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, folio: data.folio });
}
