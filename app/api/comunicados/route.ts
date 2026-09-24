import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { construirHtmlComunicado } from "@/lib/comunicado";

// Correos masivos (pantalla /correos). Antes se mandaban desde el navegador
// con una función de Supabase; ahora el servidor:
//  - comprueba que quien manda sea staff con acceso a Correos,
//  - toma los correos de los clientes de la base (no confía en lo que mande
//    el navegador),
//  - manda UN correo por cliente (nadie ve las direcciones de los demás),
//  - sale "de" la persona que lo envía si tiene correo @nodusbc.mx y las
//    respuestas le llegan a ella.
// Requiere RESEND_API_KEY en .env.local (y el dominio nodusbc.mx verificado
// en Resend, que ya lo está porque los otros correos salen de ahí).

const ROLES_CORREOS = ["admin", "superadmin", "gerente"];
const ROLES_GLOBALES = ["superadmin", "gerente"];
const FROM_RESPALDO = process.env.EMAIL_FROM || "Nodus Flex Center <notificaciones@nodusbc.mx>";
const MAX_DESTINATARIOS = 500;
const MAX_IMAGENES = 6;

function nombreSeguro(nombre: string) {
  return nombre.replace(/["<>\r\n]/g, "").trim() || "Nodus Flex Center";
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("nombre, email, rol, centro").eq("id", session.user.id).single();
  if (!yo || !ROLES_CORREOS.includes(yo.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "El envío de correos no está configurado (falta RESEND_API_KEY en el servidor)." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const asunto = String(body?.asunto || "").trim().slice(0, 200);
  const cuerpo = String(body?.cuerpo || "").trim().slice(0, 10000);
  const ids: string[] = Array.isArray(body?.destinatarioIds) ? body.destinatarioIds.map(String) : [];
  const imagenes: string[] = Array.isArray(body?.imagenes) ? body.imagenes.map(String) : [];
  const copiaParaMi = !!body?.copiaParaMi;

  if (!asunto || !cuerpo) return NextResponse.json({ error: "Falta el asunto o el mensaje" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "Elige al menos un destinatario" }, { status: 400 });
  if (ids.length > MAX_DESTINATARIOS) {
    return NextResponse.json({ error: `Máximo ${MAX_DESTINATARIOS} destinatarios por envío` }, { status: 400 });
  }
  if (imagenes.length > MAX_IMAGENES) {
    return NextResponse.json({ error: `Máximo ${MAX_IMAGENES} imágenes` }, { status: 400 });
  }

  // Solo imágenes subidas al bucket público "comunicados" de este proyecto.
  const prefijoImagenes = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/comunicados/`;
  if (imagenes.some((u) => !u.startsWith(prefijoImagenes))) {
    return NextResponse.json({ error: "Imagen no válida" }, { status: 400 });
  }

  // Destinatarios: clientes activos con correo; quien no ve todos los centros
  // solo puede escribirle a los de su propio centro.
  const admin = createAdminClient();
  let consulta = admin.from("profiles").select("id, nombre, email").in("id", ids).eq("rol", "cliente").eq("activo", true);
  if (!ROLES_GLOBALES.includes(yo.rol) && yo.centro) consulta = consulta.eq("centro", yo.centro);
  const { data: clientes, error: errClientes } = await consulta;
  if (errClientes) return NextResponse.json({ error: "No se pudieron leer los destinatarios" }, { status: 500 });
  const conCorreo = (clientes || []).filter((c) => c.email);
  if (conCorreo.length === 0) return NextResponse.json({ error: "Ningún destinatario tiene correo" }, { status: 400 });

  // Remitente: su propio correo si es del dominio de Nodus; si no, el general.
  const miEmail = (yo.email || session.user.email || "").trim();
  const usaSuCorreo = /@nodusbc\.mx$/i.test(miEmail);
  const from = usaSuCorreo ? `${nombreSeguro(yo.nombre || "")} <${miEmail}>` : FROM_RESPALDO;
  const html = construirHtmlComunicado({ cuerpo, imagenes, remitente: yo.nombre || undefined });

  const mensajes = conCorreo.map((c) => ({
    from,
    to: [c.email as string],
    subject: asunto,
    html,
    ...(miEmail ? { reply_to: miEmail } : {}),
  }));
  if (copiaParaMi && miEmail) {
    mensajes.push({ from, to: [miEmail], subject: `[Copia] ${asunto}`, html, reply_to: miEmail });
  }

  // Resend acepta hasta 100 correos por llamada.
  let enviados = 0;
  let fallidos = 0;
  let ultimoError = "";
  for (let i = 0; i < mensajes.length; i += 100) {
    const lote = mensajes.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote),
      });
      if (res.ok) {
        enviados += lote.length;
      } else {
        fallidos += lote.length;
        const detalle = await res.json().catch(() => null);
        ultimoError = detalle?.message || `Error ${res.status} del proveedor de correo`;
        console.error("[comunicados] Resend respondió", res.status, detalle);
      }
    } catch (e: any) {
      fallidos += lote.length;
      ultimoError = e?.message || "No se pudo conectar con el proveedor de correo";
      console.error("[comunicados] Excepción al enviar:", e?.message);
    }
  }

  if (enviados === 0) {
    return NextResponse.json({ error: ultimoError || "No se pudo enviar el correo" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    enviados,
    fallidos,
    clientes: conCorreo.length,
    omitidos: ids.length - conCorreo.length,
    desde: from,
    usaSuCorreo,
  });
}
