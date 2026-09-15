import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Endpoint público (sin sesión) — lo usa /tarjeta-fidelidad/consultar para
// que el cliente vea el estado de su tarjeta con solo su folio. Nunca
// regresa teléfono/correo completos (igual de discreto que /api/day-pass).
export async function GET(_req: NextRequest, { params }: { params: { folio: string } }) {
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
    nombre: tarjeta.nombre,
    centro: tarjeta.centro,
    estado: tarjeta.estado,
    sellos: sellos || [],
  });
}
