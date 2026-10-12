import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Quita el dispositivo de la persona (desactivar los avisos al celular).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { endpoint } = await req.json().catch(() => ({ endpoint: null }));
  if (typeof endpoint !== "string" || !endpoint) return NextResponse.json({ error: "Falta el dispositivo" }, { status: 400 });

  await createAdminClient().from("push_suscripciones").delete().eq("user_id", session.user.id).eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
