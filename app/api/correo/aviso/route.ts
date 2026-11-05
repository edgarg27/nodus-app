import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { CORREOS_AREA, LINK, enviarAVarios, escapar, plantillaAviso } from "@/lib/avisosCorreo";

// Avisos por correo que antes mandaba la función "send-email" de Supabase. Los datos y los destinatarios salen de la
// base (no del navegador), salvo las encuestas, que solo puede mandar el personal.
//   nuevo_ticket { folio }                 → área (Sistemas o Mantenimiento)
//   ticket_resuelto { folio, nota? }       → cliente del reporte (solo personal)
//   nueva_reservacion { reservacionId }    → admins del centro
//   reservacion_confirmada / reservacion_rechazada { reservacionId, motivo? } → cliente (solo personal)
//   comunicado { destinatarios, asunto, cuerpo } → hasta 50 correos (solo personal)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  const esPersonal = !!yo?.rol && yo.rol !== "cliente";
  const b = await req.json().catch(() => ({}));
  const tipo = String(b.tipo || "");
  const admin = createAdminClient();
  const listo = (r: { enviados: number; errores: string[] }) =>
    r.enviados > 0 || r.errores.length === 0
      ? NextResponse.json({ ok: true, ...r })
      : NextResponse.json({ error: r.errores[0], ...r }, { status: 502 });

  if (tipo === "nuevo_ticket" || tipo === "ticket_resuelto") {
    const folio = String(b.folio || "");
    if (!folio) return NextResponse.json({ error: "Falta el folio" }, { status: 400 });
    const { data: t } = await admin
      .from("tickets")
      .select("user_id, folio, asunto, descripcion, categoria, cliente_nombre, cliente_email, centro, urgencia, foto_url, foto_urls")
      .eq("folio", folio)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!t) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });

    if (tipo === "nuevo_ticket") {
      if (!esPersonal && t.user_id !== session.user.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const destinos = CORREOS_AREA[t.categoria] || CORREOS_AREA.sistemas;
      const urgente = t.urgencia === "urgente";
      const html = plantillaAviso({
        etiqueta: `${t.categoria === "mantenimiento" ? "Reporte de Mantenimiento" : "Reporte de Sistemas"} · ${t.folio}`,
        titulo: `${urgente ? "🔴 URGENTE · " : ""}Nuevo reporte recibido`,
        filas: [
          ["Asunto", t.asunto],
          ["Descripción", t.descripcion],
          ["Cliente", t.cliente_nombre],
          ["Correo", t.cliente_email],
          ["Centro", t.centro],
        ],
        fotos: (t.foto_urls as string[] | null) || (t.foto_url ? [t.foto_url] : []),
        boton: { texto: "Ver reportes", url: LINK.tickets },
      });
      return listo(await enviarAVarios(destinos, `[${t.folio}] ${urgente ? "URGENTE · " : ""}Nuevo reporte: ${t.asunto}`, html));
    }

    if (!esPersonal) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    if (!t.cliente_email) return NextResponse.json({ error: "El reporte no tiene correo del cliente" }, { status: 400 });
    const nota = typeof b.nota === "string" ? b.nota.trim().slice(0, 1000) : "";
    const html = plantillaAviso({
      etiqueta: t.folio,
      titulo: "Tu reporte fue resuelto",
      parrafos: [
        `Hola ${escapar(t.cliente_nombre || "")}, tu reporte <b>${escapar(t.folio)}</b> (“${escapar(t.asunto)}”) ya fue resuelto.`,
        ...(nota ? [`<b>Comentario del equipo:</b> ${escapar(nota)}`] : []),
        "Si algo sigue fallando, puedes levantar un nuevo reporte desde tu panel.",
      ],
      boton: { texto: "Ver mis reportes", url: LINK.soporte },
    });
    return listo(await enviarAVarios([t.cliente_email], `[${t.folio}] Tu reporte fue resuelto`, html));
  }

  if (tipo === "nueva_reservacion" || tipo === "reservacion_confirmada" || tipo === "reservacion_rechazada") {
    const reservacionId = String(b.reservacionId || "");
    if (!reservacionId) return NextResponse.json({ error: "Falta la reservación" }, { status: 400 });
    const { data: r } = await admin.from("reservaciones").select("user_id, espacio, fecha, hora, centro, fuera_horario").eq("id", reservacionId).maybeSingle();
    if (!r) return NextResponse.json({ error: "Reservación no encontrada" }, { status: 404 });
    const { data: cliente } = r.user_id ? await admin.from("profiles").select("nombre, email").eq("id", r.user_id).maybeSingle() : { data: null };
    const filas: [string, string | null][] = [
      ["Espacio", r.espacio],
      ["Fecha", r.fecha],
      ["Horario", r.hora + (r.fuera_horario ? " (fuera de horario: hay que cotizarla)" : "")],
      ["Centro", r.centro],
    ];

    if (tipo === "nueva_reservacion") {
      if (!esPersonal && r.user_id !== session.user.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      const { data: admins } = await admin.from("profiles").select("email").eq("rol", "admin").eq("centro", r.centro);
      const html = plantillaAviso({
        etiqueta: "Nueva reservación",
        titulo: `${cliente?.nombre || "Un cliente"} pidió ${r.espacio}`,
        filas: [["Cliente", cliente?.nombre || null], ...filas],
        parrafos: ["Confírmala o recházala desde el panel del centro."],
        boton: { texto: "Abrir reservaciones", url: LINK.centro },
      });
      return listo(await enviarAVarios((admins || []).map((a) => a.email).filter(Boolean), `Nueva reservación: ${r.espacio} · ${r.fecha}`, html));
    }

    if (!esPersonal) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    if (!cliente?.email) return NextResponse.json({ error: "El cliente no tiene correo" }, { status: 400 });
    const confirmada = tipo === "reservacion_confirmada";
    const motivo = typeof b.motivo === "string" ? b.motivo.trim().slice(0, 500) : "";
    const html = plantillaAviso({
      etiqueta: confirmada ? "Reservación confirmada" : "Reservación no disponible",
      titulo: confirmada ? "¡Tu reservación está confirmada!" : "No pudimos confirmar tu reservación",
      parrafos: [
        `Hola ${escapar(cliente.nombre || "")},`,
        confirmada ? "Te esperamos. Estos son los datos de tu reservación:" : "Lo sentimos, esta reservación no se pudo confirmar:",
        ...(!confirmada && motivo ? [`<b>Motivo:</b> ${escapar(motivo)}`] : []),
      ],
      filas,
      boton: { texto: "Ver mis reservaciones", url: LINK.reservaciones },
    });
    return listo(
      await enviarAVarios([cliente.email], confirmada ? `Reservación confirmada: ${r.espacio} · ${r.fecha}` : `Reservación no confirmada: ${r.espacio} · ${r.fecha}`, html)
    );
  }

  if (tipo === "comunicado") {
    if (!esPersonal) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    const destinatarios: string[] = Array.isArray(b.destinatarios) ? b.destinatarios.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
    const asunto = String(b.asunto || "").slice(0, 200);
    const cuerpo = String(b.cuerpo || "");
    if (destinatarios.length === 0 || !asunto || !cuerpo) return NextResponse.json({ error: "Faltan destinatarios, asunto o mensaje" }, { status: 400 });
    // El cuerpo lo arma la pantalla del personal (HTML propio, p. ej. el link de una encuesta).
    const html = plantillaAviso({ titulo: asunto, parrafos: [cuerpo] });
    return listo(await enviarAVarios(destinatarios, asunto, html));
  }

  return NextResponse.json({ error: "Tipo de aviso no válido" }, { status: 400 });
}
