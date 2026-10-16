import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarEmpresa } from "@/lib/empresa";
import { rolPuede } from "@/lib/permisosApi";
import { mandarCorreoContrasena } from "@/lib/correoContrasena";
import { origenPublico } from "@/lib/origenPublico";
import { correoFicticio } from "@/lib/correoFicticio";
import { randomInt } from "crypto";

// Contraseña para las cuentas que se crean sin mandar correo: fácil de dictar o mandar por WhatsApp
// (sin letras que se confunden, como O/0 o l/1).
function generarContrasena() {
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const digitos = "23456789";
  let p = "Nodus-";
  for (let i = 0; i < 4; i++) p += letras[randomInt(letras.length)];
  for (let i = 0; i < 4; i++) p += digitos[randomInt(digitos.length)];
  return p;
}

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

  if (!rolPuede(miProfile?.rol, "crearCliente")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { nombre, empresa, rfc, telefono, centro: centroBody, diaPago, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi } = body;
  // sinCorreo: la cuenta se crea con una contraseña generada y NO se le manda correo (quien solo renta una sala de
  // juntas, o clientes que se migran de ZORA). Si no dio correo se le pone uno ficticio y entra con su número N-.
  const sinCorreo = body.sinCorreo === true;
  const emailBody = typeof body.email === "string" ? body.email.trim() : "";

  const centro = miProfile.rol === "sistemas" || miProfile.rol === "superadmin" || miProfile.rol === "gerente" || miProfile.rol === "gerente_ventas" ? centroBody : miProfile.centro;

  if (!nombre || (!emailBody && !sinCorreo) || !centro) {
    return NextResponse.json({ error: "Faltan datos obligatorios (nombre, correo, centro)" }, { status: 400 });
  }

  const admin = createAdminClient();
  const numeroUsuario = await generarNumeroUsuarioUnico(admin);
  const email = emailBody || correoFicticio(numeroUsuario);
  let nuevoId: string;
  let contrasena: string | null = null;

  if (sinCorreo) {
    contrasena = generarContrasena();
    const { data: creado, error: errorCrear } = await admin.auth.admin.createUser({
      email,
      password: contrasena,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (errorCrear || !creado?.user) {
      const mensaje = /already|registered|exists/i.test(errorCrear?.message || "")
        ? "No se pudo crear la cuenta del cliente: ya existe ese correo"
        : "No se pudo crear la cuenta: " + (errorCrear?.message || "error desconocido");
      return NextResponse.json({ error: mensaje }, { status: 400 });
    }
    nuevoId = creado.user.id;
  } else {
    const origin = origenPublico(req);
    const invitacion = await mandarCorreoContrasena({ email, nombre, tipo: "invite", origin });

    if (!invitacion.ok || !invitacion.userId) {
      const mensaje = invitacion.error?.includes("already been registered")
        ? "No se pudo crear la cuenta del cliente: ya existe ese correo"
        : invitacion.error || "No se pudo mandar la invitación al cliente";
      return NextResponse.json({ error: mensaje }, { status: 400 });
    }
    nuevoId = invitacion.userId;
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: nuevoId,
    email,
    nombre,
    rol: "cliente",
    centro,
    ciudad: CIUDAD_POR_CENTRO[centro] || null,
    empresa: empresa ? normalizarEmpresa(empresa) : null,
    rfc: rfc || null,
    // Datos fiscales capturados al aceptar la cotización (si los hay).
    ...(regimen_fiscal || cp_fiscal || nombre_fiscal
      ? { nombre_fiscal: nombre_fiscal || null, regimen_fiscal: regimen_fiscal || null, cp_fiscal: cp_fiscal || null, uso_cfdi: uso_cfdi || null }
      : {}),
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

  return NextResponse.json({ ok: true, numeroUsuario, id: nuevoId, contrasena, sinCorreo: !emailBody });
}
