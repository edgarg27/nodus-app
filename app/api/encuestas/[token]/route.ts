import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Público, sin sesión — el link de /encuesta/{token} se manda por correo
// a cuentas reales del portal Y a contactos sin cuenta (tabla `clientes`),
// así que responder nunca puede depender de tener sesión. El `token` es
// lo único que protege un envío (mismo criterio que /pagar-simulado/[id]
// con su UUID de pago) — por eso siempre se usa createAdminClient() aquí,
// nunca una consulta directa del navegador con la anon key.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createAdminClient();

  const { data: envio } = await admin
    .from("encuestas_envios")
    .select("id, encuesta_id, nombre_destinatario, estado, respuestas")
    .eq("token", params.token)
    .maybeSingle();

  if (!envio) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }

  const { data: encuesta } = await admin
    .from("encuestas")
    .select("titulo, descripcion, preguntas")
    .eq("id", envio.encuesta_id)
    .single();

  if (!encuesta) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    titulo: encuesta.titulo,
    descripcion: encuesta.descripcion,
    preguntas: encuesta.preguntas,
    nombreDestinatario: envio.nombre_destinatario,
    estado: envio.estado,
    respuestas: envio.respuestas,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { respuestas } = await req.json();
  if (!Array.isArray(respuestas)) {
    return NextResponse.json({ error: "Faltan respuestas" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: envio } = await admin
    .from("encuestas_envios")
    .select("id, estado")
    .eq("token", params.token)
    .maybeSingle();

  if (!envio) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }
  if (envio.estado === "respondida") {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin
    .from("encuestas_envios")
    .update({ respuestas, estado: "respondida", respondido_en: new Date().toISOString() })
    .eq("id", envio.id);

  if (error) {
    return NextResponse.json({ error: "No se pudo guardar la respuesta" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
