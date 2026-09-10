import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Endpoint público (sin sesión) — lo llama el cliente desde
// /firmar-contrato/[id] al dar clic en "Firmo y acepto". El id del
// contrato es un uuid de Supabase, mismo criterio de seguridad que ya
// usan las ligas públicas de archivo_url en Storage en todo el proyecto.
export async function POST(req: NextRequest) {
  const { contratoId } = await req.json();
  if (!contratoId) {
    return NextResponse.json({ error: "Falta el id del contrato" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: contrato, error: contratoError } = await admin
    .from("contratos")
    .select("id, archivo_url, firmado")
    .eq("id", contratoId)
    .single();
  if (contratoError || !contrato) {
    return NextResponse.json({ error: "No se encontró el contrato" }, { status: 404 });
  }
  if (contrato.firmado) {
    return NextResponse.json({ error: "Este contrato ya fue firmado" }, { status: 400 });
  }
  if (!contrato.archivo_url) {
    return NextResponse.json({ error: "Este contrato todavía no tiene documento para firmar" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "desconocida";

  const { error: updateError } = await admin
    .from("contratos")
    .update({
      firmado: true,
      firmado_at: new Date().toISOString(),
      firmado_ip: ip,
      firma_url: contrato.archivo_url,
    })
    .eq("id", contratoId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
