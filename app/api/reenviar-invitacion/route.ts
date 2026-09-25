import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";

// Botón "📧 Reenviar invitación" en el detalle de cliente de AdminPanel.tsx
// — por si el link/token del correo original (ver /api/crear-cliente) ya
// venció o el cliente nunca lo recibió. Mientras la cuenta siga sin
// confirmar (no le puso contraseña), volver a invitar por el mismo correo
// le manda un link nuevo — Supabase no lo bloquea como "ya registrado"
// hasta que la cuenta queda confirmada.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "reenviarInvitacion")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { email, nombre } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "Falta el correo del cliente" }, { status: 400 });
  }

  const admin = createAdminClient();
  const origin = req.nextUrl.origin;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/crear-password`,
    data: { nombre },
  });

  if (inviteError) {
    const esFalloDeCorreo = inviteError.status === 500 || inviteError.name === "AuthRetryableFetchError";
    const mensaje = esFalloDeCorreo
      ? "No se pudo mandar el correo — probablemente se alcanzó el límite de correos de Supabase. Espera unos minutos e intenta de nuevo."
      : inviteError.message || "No se pudo reenviar la invitación (¿ya confirmó su cuenta?)";
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
