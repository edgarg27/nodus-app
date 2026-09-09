import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Endpoint público (sin sesión) — lo llama la página /agendar-invitado justo
// después de guardar la solicitud, para avisarle al centro. Usa el cliente
// con permisos totales porque quien llama esto no tiene sesión (es un
// visitante sin cuenta) y por lo tanto no podría leer `profiles` ni
// insertar en `notificaciones` bajo las políticas normales de RLS.

const LABEL_TIPO: Record<string, string> = {
  sala_juntas: "Sala de juntas",
  coworking: "Coworking",
  oficina_privada: "Oficina privada",
  day_pass_coworking: "Day Pass · Coworking",
  day_pass_oficina_privada: "Day Pass · Oficina privada",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const tipo = body?.tipo as string | undefined;
  const centro = body?.centro as string | undefined;
  const nombre = body?.nombre as string | undefined;

  if (!tipo || !centro || !nombre) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const label = LABEL_TIPO[tipo] || tipo;

  // 1) Notificación dentro de la app (la campanita del panel del centro).
  //    Esto SIEMPRE funciona porque no depende de ninguna función externa.
  await admin.from("notificaciones").insert({
    centro,
    tipo: "nueva_solicitud_invitado",
    mensaje: `🙋 ${nombre} pidió "${label}" desde la página de invitados — revisa la pestaña Invitados.`,
  });

  // 2) Best-effort: intenta también un correo a los admins del centro. Esto
  //    depende de que la función "send-email" ya desplegada soporte este
  //    tipo — si no lo soporta, simplemente no se manda, sin romper nada.
  const { data: admins } = await admin.from("profiles").select("email").eq("rol", "admin").eq("centro", centro);
  const emails = (admins || []).map((a) => a.email).filter(Boolean);

  if (emails.length > 0) {
    try {
      await admin.functions.invoke("send-email", {
        body: {
          tipo: "nueva_solicitud_invitado",
          to: emails,
          nombreInvitado: nombre,
          tipoSolicitud: label,
          centro,
        },
      });
    } catch {
      // no crítico
    }
  }

  return NextResponse.json({ ok: true });
}
