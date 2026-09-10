import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Datos mínimos y no sensibles de un contrato, para la página pública
// /firmar-contrato/[id] (sin sesión) — evita exponer RFC, correo,
// teléfono, etc. a quien solo tenga la liga.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: contrato, error } = await admin
    .from("contratos")
    .select("id, centro, cliente_nombre_historico, fecha_inicio, fecha_vencimiento, renta_mensual, archivo_url, firmado, firmado_at, estatus")
    .eq("id", params.id)
    .single();

  if (error || !contrato) {
    return NextResponse.json({ error: "No se encontró el contrato" }, { status: 404 });
  }

  return NextResponse.json({ contrato });
}
