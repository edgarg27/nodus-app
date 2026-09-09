import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
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
