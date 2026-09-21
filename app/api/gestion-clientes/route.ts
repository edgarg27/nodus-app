import { NextRequest, NextResponse } from "next/server";
import { createClient as createClientJs } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Panel "Editar cliente" del detalle de cliente en AdminPanel.tsx. Permite
// al admin cambiar TODOS los datos de una cuenta de cliente (incluido el
// correo de acceso) y resolver problemas de contraseña. Solo para admin,
// gerente y superadmin, y solo sobre cuentas con rol "cliente".
const ROLES_PERMITIDOS = ["admin", "gerente", "superadmin"];

async function verificarPermiso() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || !ROLES_PERMITIDOS.includes(miProfile.rol)) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  }
  return { ok: true as const };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const permiso = await verificarPermiso();
  if ("error" in permiso) return permiso.error;

  const body = await req.json().catch(() => null);
  const accion = body?.accion as string | undefined;
  const userId = body?.userId as string | undefined;
  if (!accion || !userId) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: objetivo } = await admin.from("profiles").select("id, rol, email, nombre").eq("id", userId).maybeSingle();
  if (!objetivo || objetivo.rol !== "cliente") {
    return NextResponse.json({ error: "Solo se pueden gestionar cuentas de cliente" }, { status: 400 });
  }

  // ---------------------------------------------------------------- actualizar
  if (accion === "actualizar") {
    const nombre = String(body.nombre ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "El correo no es válido" }, { status: 400 });

    const diaPagoTexto = String(body.diaPago ?? "").trim();
    const diaPago = diaPagoTexto ? Number(diaPagoTexto) : null;
    if (diaPago != null && (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31)) {
      return NextResponse.json({ error: "El día de pago debe ser un número del 1 al 31" }, { status: 400 });
    }

    const { data: authActual, error: authGetError } = await admin.auth.admin.getUserById(userId);
    if (authGetError || !authActual?.user) {
      return NextResponse.json({ error: "No se encontró la cuenta de acceso de este cliente" }, { status: 404 });
    }

    // El correo (y el nombre) también viven en la cuenta de acceso; si solo
    // se cambiara el perfil, el cliente seguiría entrando con el correo
    // viejo. Solo se marca el correo como confirmado si ya lo estaba, para
    // no "confirmar" por sorpresa una cuenta invitada que nunca entró.
    const correoCambio = (authActual.user.email || "").toLowerCase() !== email;
    if (correoCambio || nombre !== objetivo.nombre) {
      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ...(correoCambio ? { email, ...(authActual.user.email_confirmed_at ? { email_confirm: true } : {}) } : {}),
        user_metadata: { ...(authActual.user.user_metadata || {}), nombre },
      });
      if (authError) {
        return NextResponse.json(
          { error: "No se pudo actualizar la cuenta de acceso: " + authError.message },
          { status: 400 }
        );
      }
    }

    const cambios = {
      nombre,
      email,
      telefono: String(body.telefono ?? "").trim() || null,
      empresa: String(body.empresa ?? "").trim() || null,
      rfc: String(body.rfc ?? "").trim().toUpperCase() || null,
      centro: String(body.centro ?? "").trim() || null,
      numero_oficina: String(body.numeroOficina ?? "").trim() || null,
      ocupantes_oficina: String(body.ocupantes ?? "").trim() || null,
      dia_pago: diaPago,
      activo: body.activo === false ? false : true,
    };
    const { error: profileError } = await admin.from("profiles").update(cambios).eq("id", userId);
    if (profileError) {
      return NextResponse.json({ error: "No se pudo guardar el perfil: " + profileError.message }, { status: 500 });
    }

    // La facturación lee el día de pago del CONTRATO, no del perfil — se
    // refleja ahí también. Mes a mes queda fuera: siempre es del 1 al 10.
    if (diaPago != null) {
      await admin
        .from("contratos")
        .update({ dia_pago: diaPago })
        .eq("user_id", userId)
        .in("estatus", ["vigente", "pre_aprobado"])
        .or("forma_pago.is.null,forma_pago.neq.mensual");
    }

    return NextResponse.json({ ok: true, cliente: cambios });
  }

  // ---------------------------------------------------- restablecer_correo
  if (accion === "restablecer_correo") {
    const { data: authActual } = await admin.auth.admin.getUserById(userId);
    const correo = authActual?.user?.email || objetivo.email;
    if (!correo) return NextResponse.json({ error: "El cliente no tiene correo" }, { status: 400 });

    // Cliente sin sesión y con la llave pública: es lo que hace que
    // Supabase MANDE el correo de recuperación (con el admin solo se
    // generaría el link sin enviarlo). Flujo implícito para que el link
    // traiga el token en el "#", que es lo que lee /crear-password.
    const publico = createClientJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false, flowType: "implicit" },
    });
    const { error } = await publico.auth.resetPasswordForEmail(correo, {
      redirectTo: `${req.nextUrl.origin}/crear-password`,
    });
    if (error) {
      const esFalloDeCorreo = error.status === 500 || error.name === "AuthRetryableFetchError" || error.status === 429;
      return NextResponse.json(
        {
          error: esFalloDeCorreo
            ? "No se pudo mandar el correo — probablemente se alcanzó el límite de correos. Espera unos minutos, o ponle una contraseña nueva directamente."
            : error.message || "No se pudo enviar el correo de restablecimiento",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, correo });
  }

  // ------------------------------------------------------- poner_password
  if (accion === "poner_password") {
    const password = String(body.password ?? "");
    if (password.length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }
    // Si el admin le pone contraseña es porque quiere que entre ya: se marca
    // el correo como confirmado para que pueda iniciar sesión de inmediato.
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) {
      return NextResponse.json({ error: "No se pudo cambiar la contraseña: " + error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}
