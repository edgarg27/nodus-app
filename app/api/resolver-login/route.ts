import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { checkRateLimit } from "@/lib/rateLimit";

// Límite de intentos por IP: un usuario legítimo hace 1-2 intentos por
// sesión, así que 10 cada 5 minutos deja margen de sobra sin permitir
// que se automatice un barrido de los ~10,000 números de usuario posibles.
const MAX_INTENTOS = 10;
const VENTANA_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "desconocida";

  if (!checkRateLimit(ip, MAX_INTENTOS, VENTANA_MS)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const { identificador } = await req.json();

  if (!identificador || typeof identificador !== "string") {
    return NextResponse.json({ error: "Falta identificador" }, { status: 400 });
  }

  // Si ya parece correo, no hace falta buscar nada — se manda tal cual.
  if (identificador.includes("@")) {
    return NextResponse.json({ email: identificador });
  }

  // Si no, asumimos que es un número de usuario (ej. N-1356) y lo buscamos
  // con el cliente admin, porque un usuario sin sesión no puede leer `profiles`.
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("email")
    .ilike("numero_usuario", identificador.trim())
    .maybeSingle();

  return NextResponse.json({ email: data?.email || null });
}
