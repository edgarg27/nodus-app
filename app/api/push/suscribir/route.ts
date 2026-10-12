import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

const MAXIMO_DISPOSITIVOS = 10;

// Guarda el dispositivo de la persona que activó los avisos al celular.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    !endpoint.startsWith("https://") ||
    endpoint.length > 2000 ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length > 200 ||
    auth.length > 100
  ) {
    return NextResponse.json({ error: "Suscripción no válida" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Un mismo dispositivo identifica a una sola persona: si cambia de cuenta, se reasigna.
  const { error } = await admin
    .from("push_suscripciones")
    .upsert({ user_id: session.user.id, endpoint, p256dh, auth, user_agent: (req.headers.get("user-agent") || "").slice(0, 300) }, { onConflict: "endpoint" });
  if (error) {
    console.error("[push] suscribir:", error.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  // Tope de dispositivos por persona: se quitan los más antiguos.
  const { data: todas } = await admin.from("push_suscripciones").select("id").eq("user_id", session.user.id).order("created_at", { ascending: false });
  const sobrantes = (todas || []).slice(MAXIMO_DISPOSITIVOS).map((s) => s.id);
  if (sobrantes.length > 0) await admin.from("push_suscripciones").delete().in("id", sobrantes);

  return NextResponse.json({ ok: true });
}
