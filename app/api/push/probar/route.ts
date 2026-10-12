import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { pushConfigurado, enviarPush } from "@/lib/push";

// Manda un aviso de prueba a los dispositivos de la persona que lo pide.
export async function POST() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!pushConfigurado()) return NextResponse.json({ error: "Los avisos al celular todavía no están activados en el servidor" }, { status: 503 });

  const r = await enviarPush(createAdminClient(), [session.user.id], {
    title: "Nodus",
    body: "Así te llegarán los avisos a este dispositivo.",
    url: "/",
    tag: "prueba",
  });
  if (r.enviados === 0) {
    return NextResponse.json({ error: "No hay ningún dispositivo con los avisos activados" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, enviados: r.enviados });
}
