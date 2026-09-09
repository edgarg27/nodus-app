import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Endpoint público (sin sesión) — es lo que abre el invitado cuando el staff
// le comparte el link de su Day Pass. Solo regresa los campos necesarios
// para pintar el pase (nunca la tabla completa ni datos de otros pases).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("day_passes")
    .select("folio, tipo, centro, nombre, fecha, emitido_por_nombre")
    .eq("id", params.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Day Pass no encontrado" }, { status: 404 });
  }

  return NextResponse.json(data);
}
