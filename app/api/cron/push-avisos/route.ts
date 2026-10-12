import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { pushConfigurado, enviarPush, destinatariosDeAviso, urlDeAviso, esAvisoDePersonal } from "@/lib/push";

// Manda al celular los avisos nuevos de la campana (tabla notificaciones). Se llama cada pocos
// minutos desde el cron de producción (deploy/cron/iniciar-cron.sh) con el secreto del cron.
// Cada aviso se reclama antes de enviarlo (push_enviado), así dos corridas no lo repiten, y los
// que llevan más de 2 horas esperando (p. ej. tras una caída) solo se marcan, no se mandan.
const EDAD_MAXIMA_MS = 2 * 60 * 60 * 1000;
const LOTE = 50;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!pushConfigurado()) return NextResponse.json({ ok: true, configurado: false });

  const admin = createAdminClient();
  const { data: pendientes, error } = await admin
    .from("notificaciones")
    .select("*")
    .eq("push_enviado", false)
    .order("created_at", { ascending: true })
    .limit(LOTE);
  if (error) {
    console.error("[push-avisos]", error.message);
    return NextResponse.json({ error: "No se pudieron leer los avisos" }, { status: 500 });
  }

  let revisados = 0;
  let conDestino = 0;
  let enviados = 0;
  let fallidos = 0;
  let borrados = 0;
  for (const n of pendientes || []) {
    const { data: reclamado } = await admin.from("notificaciones").update({ push_enviado: true }).eq("id", n.id).eq("push_enviado", false).select("id");
    if (!reclamado || reclamado.length === 0) continue; // otra corrida ya lo tomó
    revisados++;
    if (Date.now() - new Date(n.created_at).getTime() > EDAD_MAXIMA_MS) continue;

    const destinos = await destinatariosDeAviso(admin, n);
    if (destinos.length === 0) continue;
    conDestino++;
    const personal = esAvisoDePersonal(n.tipo);
    const r = await enviarPush(admin, destinos, {
      title: "Nodus",
      body: String(n.mensaje || "Tienes un aviso nuevo").slice(0, 180),
      url: urlDeAviso(n, personal),
      tag: String(n.id),
    });
    enviados += r.enviados;
    fallidos += r.fallidos;
    borrados += r.borrados;
  }
  return NextResponse.json({ ok: true, configurado: true, revisados, conDestino, enviados, fallidos, suscripcionesBorradas: borrados });
}
