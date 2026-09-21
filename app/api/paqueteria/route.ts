import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { ROLES_PAQUETERIA } from "@/lib/paqueteria";

// Recepción (staff) registra un paquete o correspondencia para un cliente.
// Se guarda, se le avisa al cliente en su panel y por correo.
const TIPOS: Record<string, string> = {
  paquete: "un paquete",
  correspondencia: "correspondencia",
  otro: "algo para ti",
};

const esc = (t: string) => t.replace(/</g, "&lt;");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || !ROLES_PAQUETERIA.includes(miProfile.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const clienteId = String(body?.clienteId || "");
  const tipo = String(body?.tipo || "paquete");
  const remitente = String(body?.remitente || "").trim().slice(0, 120);
  const descripcion = String(body?.descripcion || "").trim().slice(0, 300);
  if (!clienteId) return NextResponse.json({ error: "Elige el cliente" }, { status: 400 });
  if (!TIPOS[tipo]) return NextResponse.json({ error: "Tipo no válido" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cliente } = await admin
    .from("profiles")
    .select("id, rol, nombre, email, empresa, centro, numero_oficina")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente || cliente.rol !== "cliente") {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const { error: insertError } = await admin.from("paqueteria_cliente").insert({
    user_id: cliente.id,
    centro: cliente.centro,
    tipo,
    remitente: remitente || null,
    descripcion: descripcion || null,
    cliente_nombre: cliente.nombre,
    cliente_empresa: cliente.empresa,
    numero_oficina: cliente.numero_oficina,
    recibido_por: session.user.id,
  });
  if (insertError) {
    return NextResponse.json({ error: "No se pudo registrar: " + insertError.message }, { status: 500 });
  }

  const detalle = [remitente && `de ${remitente}`, descripcion].filter(Boolean).join(" — ");

  // Aviso dentro del panel del cliente.
  await admin.from("notificaciones").insert({
    centro: cliente.centro,
    user_id: cliente.id,
    tipo: "paquete_recibido",
    mensaje: `📦 Te llegó ${TIPOS[tipo]}${detalle ? ` (${detalle})` : ""}. Pásalo a recoger a recepción.`,
  });

  // Correo (best-effort).
  if (cliente.email) {
    await enviarCorreo({
      to: cliente.email,
      subject: `Te llegó ${TIPOS[tipo]} a Nodus`,
      html: `
        <p>Hola ${esc(cliente.nombre || "cliente")},</p>
        <p>Recibimos <strong>${TIPOS[tipo]}</strong> para ti${cliente.centro ? ` en <strong>${esc(cliente.centro)}</strong>` : ""}.</p>
        ${detalle ? `<p>${esc(detalle)}</p>` : ""}
        <p>Puedes pasar a recogerlo a recepción. También lo ves en la sección <strong>Paquetes</strong> de tu panel.</p>
        <p>Nodus Flex Center</p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
