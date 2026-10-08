import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { mandarCorreoContrasena } from "@/lib/correoContrasena";
import { origenPublico } from "@/lib/origenPublico";

const ROLES_STAFF = ["admin", "superadmin", "gerente", "sistemas", "operaciones", "cobranza", "atencion_cliente", "diseno", "ventas", "gerente_ventas", "ceo", "captive"];

async function verificarSoyGerente(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: miProfile } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", session.user.id)
    .single();

  if (miProfile?.rol !== "superadmin" && miProfile?.rol !== "gerente") return null;
  return { id: session.user.id, rol: miProfile.rol as string };
}

// Crear una cuenta de staff nueva
export async function POST(req: NextRequest) {
  const yo = await verificarSoyGerente(req);
  if (!yo) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json();
  const { nombre, email, rol, centro, password } = body;

  if (!nombre || !email || !rol) {
    return NextResponse.json({ error: "Faltan datos obligatorios (nombre, correo, rol)" }, { status: 400 });
  }
  if (!ROLES_STAFF.includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  // Solo un superadmin puede dar de alta a otro superadmin (el gerente tiene
  // sus mismos privilegios, pero esta alta se reserva).
  if (rol === "superadmin" && yo.rol !== "superadmin") {
    return NextResponse.json({ error: "Solo un superadmin puede crear cuentas superadmin" }, { status: 403 });
  }

  const admin = createAdminClient();
  let nuevoId: string;

  if (password) {
    // Modo directo: crea la cuenta ya con la contraseña que pusiste, sin
    // depender de que le llegue un correo (útil para cuentas de prueba).
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (error || !data?.user) {
      return NextResponse.json(
        { error: error?.message || "No se pudo crear la cuenta (¿ya existe ese correo?)" },
        { status: 400 }
      );
    }
    nuevoId = data.user.id;
  } else {
    // Modo invitación: le manda un correo para que el propio usuario ponga
    // su contraseña la primera vez que entra.
    const origin = origenPublico(req);
    const invitacion = await mandarCorreoContrasena({ email, nombre, tipo: "invite", origin });
    if (!invitacion.ok || !invitacion.userId) {
      return NextResponse.json(
        { error: invitacion.error || "No se pudo invitar la cuenta (¿ya existe ese correo?)" },
        { status: 400 }
      );
    }
    nuevoId = invitacion.userId;
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: nuevoId,
    email,
    nombre,
    rol,
    centro: centro || null,
    activo: true,
  });

  if (profileError) {
    return NextResponse.json(
      { error: "La cuenta se creó pero no se pudo guardar el perfil: " + profileError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: nuevoId });
}

// Borrar una cuenta de staff
export async function DELETE(req: NextRequest) {
  const yo = await verificarSoyGerente(req);
  if (!yo) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Falta el id del usuario" }, { status: 400 });
  if (userId === yo.id) {
    return NextResponse.json({ error: "No puedes borrar tu propia cuenta desde aquí" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    return NextResponse.json({ error: "No se pudo borrar la cuenta: " + authError.message }, { status: 500 });
  }

  // Por si el trigger de borrado en cascada no existe, limpiamos el perfil
  // también a mano.
  await admin.from("profiles").delete().eq("id", userId);

  return NextResponse.json({ ok: true });
}
