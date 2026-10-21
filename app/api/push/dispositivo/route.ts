import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

const MAXIMO_DISPOSITIVOS = 10;
const PLATAFORMAS = ["android", "ios"];

async function sesion() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

// App móvil: guarda el token de avisos del celular (Firebase en Android, APNs en iPhone) de quien inició sesión.
export async function POST(req: NextRequest) {
  const session = await sesion();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!token || token.length > 4096 || !PLATAFORMAS.includes(b.plataforma)) return NextResponse.json({ error: "Dispositivo no válido" }, { status: 400 });

  const admin = createAdminClient();
  // Un mismo celular es de una sola persona: si alguien más inicia sesión en él, se reasigna.
  const { error } = await admin
    .from("push_dispositivos")
    .upsert({ user_id: session.user.id, token, plataforma: b.plataforma }, { onConflict: "token" });
  if (error) {
    console.error("[push] dispositivo:", error.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
  // Tope por persona: se quedan los más recientes.
  const { data: suyos } = await admin.from("push_dispositivos").select("id").eq("user_id", session.user.id).order("created_at", { ascending: false });
  const sobrantes = (suyos || []).slice(MAXIMO_DISPOSITIVOS).map((d) => d.id);
  if (sobrantes.length) await admin.from("push_dispositivos").delete().in("id", sobrantes);
  return NextResponse.json({ ok: true });
}

// Al apagar los avisos o cerrar sesión en la app.
export async function DELETE(req: NextRequest) {
  const session = await sesion();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.token !== "string") return NextResponse.json({ error: "Falta el dispositivo" }, { status: 400 });
  const admin = createAdminClient();
  await admin.from("push_dispositivos").delete().eq("token", b.token).eq("user_id", session.user.id);
  return NextResponse.json({ ok: true });
}
