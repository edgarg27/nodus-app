import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarEmpresa } from "@/lib/empresa";

async function generarNumeroUsuarioUnico(admin: ReturnType<typeof createAdminClient>) {
  for (let intento = 0; intento < 15; intento++) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const candidato = `N-${num}`;
    const { data } = await admin.from("profiles").select("id").eq("numero_usuario", candidato).maybeSingle();
    if (!data) return candidato;
  }
  // Si por mala suerte 15 intentos chocan, usamos timestamp como respaldo
  return `N-${Date.now().toString().slice(-4)}`;
}

const CIUDAD_POR_CENTRO: Record<string, string> = {
  "Bosques": "Aguascalientes",
  "Punto 45": "Aguascalientes",
  "San Telmo": "Aguascalientes",
  "Puerta Bajío Piso 2": "León",
  "Puerta Bajío Piso 8": "León",
  "Stadium": "León",
  "ILEVA": "San Luis Potosí",
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase
    .from("profiles")
    .select("rol, centro")
    .eq("id", session.user.id)
    .single();

  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { nombre, email, empresa, rfc, telefono, centro: centroBody, diaPago } = body;

  const centro = miProfile.rol === "sistemas" || miProfile.rol === "superadmin" || miProfile.rol === "gerente" ? centroBody : miProfile.centro;

  if (!nombre || !email || !centro) {
    return NextResponse.json({ error: "Faltan datos obligatorios (nombre, correo, centro)" }, { status: 400 });
  }

  const admin = createAdminClient();
  const numeroUsuario = await generarNumeroUsuarioUnico(admin);

  const origin = req.nextUrl.origin;
  const { data: invitado, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/crear-password`,
    data: { nombre },
  });

  if (inviteError || !invitado?.user) {
    return NextResponse.json(
      { error: inviteError?.message || "No se pudo crear la cuenta del cliente (¿ya existe ese correo?)" },
      { status: 400 }
    );
  }

  const nuevoId = invitado.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    id: nuevoId,
    email,
    nombre,
    rol: "cliente",
    centro,
    ciudad: CIUDAD_POR_CENTRO[centro] || null,
    empresa: empresa ? normalizarEmpresa(empresa) : null,
    rfc: rfc || null,
    numero_usuario: numeroUsuario,
    telefono: telefono || null,
    dia_pago: diaPago ? Number(diaPago) : null,
    activo: true,
    registrado_por: session.user.id,
  });

  if (profileError) {
    return NextResponse.json(
      { error: "La cuenta se creó pero no se pudo guardar el perfil: " + profileError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, numeroUsuario, id: nuevoId });
}
