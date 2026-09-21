import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";

// Un cliente (con sesión) le manda una solicitud al staff desde Mi Contrato:
// renovar, más horas de sala, cambiar/ampliar espacio u otra cosa. Se guarda,
// aparece en la pestaña "Solicitudes" del panel del centro, genera una
// notificación y un correo a los admins del centro.
const TIPOS: Record<string, string> = {
  renovar: "Renovar mi contrato",
  mas_horas: "Más horas de sala de juntas",
  cambiar_espacio: "Cambiar o ampliar mi espacio",
  otro: "Otra solicitud",
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const tipo = String(body?.tipo || "");
  const mensaje = String(body?.mensaje || "").trim().slice(0, 1000);
  const contratoId = body?.contratoId ? String(body.contratoId) : null;
  if (!TIPOS[tipo]) return NextResponse.json({ error: "Tipo de solicitud no válido" }, { status: 400 });

  const admin = createAdminClient();

  const { data: perfil } = await admin
    .from("profiles")
    .select("id, rol, nombre, email, telefono, centro")
    .eq("id", session.user.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== "cliente") {
    return NextResponse.json({ error: "Solo los clientes pueden mandar solicitudes" }, { status: 403 });
  }

  // El contrato tiene que ser del propio cliente.
  let centro: string | null = perfil.centro;
  let contratoValido: string | null = null;
  if (contratoId) {
    const { data: contrato } = await admin
      .from("contratos")
      .select("id, user_id, centro")
      .eq("id", contratoId)
      .maybeSingle();
    if (contrato && contrato.user_id === perfil.id) {
      contratoValido = contrato.id;
      centro = contrato.centro || centro;
    }
  }

  // Evita duplicar: si ya tiene una pendiente del mismo tipo, no se crea otra.
  const { data: pendiente } = await admin
    .from("solicitudes_cliente")
    .select("id")
    .eq("user_id", perfil.id)
    .eq("tipo", tipo)
    .eq("estado", "pendiente")
    .limit(1)
    .maybeSingle();
  if (pendiente) {
    return NextResponse.json(
      { error: "Ya tienes una solicitud de este tipo pendiente. El equipo del centro te contactará pronto." },
      { status: 409 }
    );
  }

  const { error: insertError } = await admin.from("solicitudes_cliente").insert({
    user_id: perfil.id,
    contrato_id: contratoValido,
    centro,
    tipo,
    mensaje: mensaje || null,
    cliente_nombre: perfil.nombre,
    cliente_email: perfil.email,
    cliente_telefono: perfil.telefono,
  });
  if (insertError) {
    return NextResponse.json({ error: "No se pudo enviar la solicitud: " + insertError.message }, { status: 500 });
  }

  // Aviso dentro del panel del centro + correo a sus admins (best-effort).
  if (centro) {
    await admin.from("notificaciones").insert({
      centro,
      tipo: "solicitud_cliente",
      mensaje: `📨 ${perfil.nombre || "Un cliente"} mandó una solicitud: ${TIPOS[tipo]} — revisa la pestaña Solicitudes.`,
    });

    const { data: admins } = await admin.from("profiles").select("email").eq("rol", "admin").eq("centro", centro);
    const html = `
      <p>El cliente <strong>${perfil.nombre || "—"}</strong> (${perfil.email || "sin correo"}${
      perfil.telefono ? ` · ${perfil.telefono}` : ""
    }) mandó una solicitud desde su panel:</p>
      <p><strong>${TIPOS[tipo]}</strong></p>
      ${mensaje ? `<p>Mensaje: ${mensaje.replace(/</g, "&lt;")}</p>` : ""}
      <p>Puedes verla y marcarla como atendida en la pestaña <strong>Solicitudes</strong> del Panel de Centro.</p>`;
    for (const a of admins || []) {
      if (a.email) {
        await enviarCorreo({ to: a.email, subject: `Solicitud de cliente: ${TIPOS[tipo]}`, html });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
