// Notificaciones push (avisos al celular) con Web Push y llaves VAPID.
//
// Los avisos de la app viven en la tabla `notificaciones` (la campana). Una tarea programada
// (app/api/cron/push-avisos) revisa los nuevos y los manda también al celular de quien le toca
// verlos, con las mismas reglas que la campana (lib/avisosPorRol.ts).

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { AVISOS_POR_ROL, AVISOS_PROPIOS, avisoEsParaRol } from "@/lib/avisosPorRol";

type Admin = ReturnType<typeof createAdminClient>;

let configurado = false;
export function pushConfigurado(): boolean {
  if (configurado) return true;
  const publica = process.env.VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  if (!publica || !privada) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:it.admin@nodusbc.mx", publica, privada);
  configurado = true;
  return true;
}

export type AvisoPush = { title: string; body: string; url: string; tag?: string };

// Manda un aviso a todos los dispositivos de las personas indicadas. Las suscripciones que el
// sistema de avisos del teléfono ya dio de baja (404/410) se borran solas.
export async function enviarPush(admin: Admin, userIds: string[], aviso: AvisoPush): Promise<{ enviados: number; fallidos: number; borrados: number }> {
  const resultado = { enviados: 0, fallidos: 0, borrados: 0 };
  if (!pushConfigurado() || userIds.length === 0) return resultado;

  const { data: subs } = await admin.from("push_suscripciones").select("id, endpoint, p256dh, auth").in("user_id", Array.from(new Set(userIds)));
  const carga = JSON.stringify(aviso);
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 60 * 60 * 24, urgency: "normal" });
      resultado.enviados++;
      await admin.from("push_suscripciones").update({ ultimo_envio_at: new Date().toISOString() }).eq("id", s.id);
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from("push_suscripciones").delete().eq("id", s.id);
        resultado.borrados++;
      } else {
        resultado.fallidos++;
        console.error("[push] no se pudo enviar:", err?.statusCode || "", err?.body || err?.message || err);
      }
    }
  }
  return resultado;
}

// ---- A quién le toca cada aviso (mismas reglas que la campana del panel) ----

// Roles del personal con alcance de todos los centros (igual que `esGlobal` de AdminPanel).
const ROLES_ALCANCE_GLOBAL = ["sistemas", "superadmin", "gerente", "gerente_ventas", "operaciones", "cobranza", "atencion_cliente", "diseno"];

const TIPOS_DE_PERSONAL = new Set(Object.values(AVISOS_POR_ROL).flat());

export type Aviso = { id: string; tipo: string; mensaje: string | null; centro: string | null; user_id: string | null; categoria?: string | null };

export async function destinatariosDeAviso(admin: Admin, n: Aviso): Promise<string[]> {
  const ids = new Set<string>();

  if (TIPOS_DE_PERSONAL.has(n.tipo)) {
    const roles = Object.entries(AVISOS_POR_ROL)
      .filter(([rol, tipos]) => tipos.includes(n.tipo) && avisoEsParaRol(rol, n))
      .map(([rol]) => rol);
    if (roles.length > 0) {
      const { data: personal } = await admin.from("profiles").select("id, rol, centro").in("rol", roles).eq("activo", true);
      for (const p of personal || []) {
        if (ROLES_ALCANCE_GLOBAL.includes(p.rol) || (p.centro && p.centro === n.centro)) ids.add(p.id);
      }
    }
  }
  // Respuestas a algo que pidió esa persona (reservación de sala confirmada, etc.) y avisos del cliente.
  if (n.user_id && (AVISOS_PROPIOS.includes(n.tipo) || !TIPOS_DE_PERSONAL.has(n.tipo))) ids.add(n.user_id);

  return Array.from(ids);
}

// A dónde lleva el aviso al tocarlo. Mismas pantallas que al abrirlo en la campana.
export function urlDeAviso(n: { tipo: string; mensaje: string | null }, esPersonal: boolean): string {
  if (!esPersonal) {
    if (n.tipo === "paquete_recibido" || n.tipo === "nuevo_paquete") return "/mi-paqueteria";
    if (["fecha_pago_hoy", "pago_hoy", "recordatorio_pago", "cuenta_pausada", "pago_confirmado"].includes(n.tipo)) return "/estado-cuenta";
    return "/dashboard-cliente";
  }
  switch (n.tipo) {
    case "nueva_reservacion":
    case "reservacion_confirmada":
    case "reservacion_rechazada":
    case "reservacion_cancelada_cliente":
      return "/sala-juntas";
    case "nuevo_tour":
      return "/tours";
    case "contrato_a_firma":
      return "/contratos";
    case "baja_extension":
    case "nuevo_did":
      return "/telefonia";
    case "nuevo_voucher":
      return "/centro/vouchers";
    case "ticket_en_proceso":
    case "ticket_resuelto":
    case "nuevo_ticket":
    case "ticket_comentario":
      return n.mensaje?.includes("📶") ? "/centro/vouchers" : "/tickets";
    case "proximo_mantenimiento":
      return "/mantenimiento";
    case "nuevo_gasto":
      return "/gastos";
    case "factura_automatica_fallida":
    case "complemento_pago_pendiente":
    case "cancelacion_factura":
      return "/facturas-admin";
    case "pago_confirmado":
    case "fecha_pago_hoy":
    case "pago_hoy":
    case "recordatorio_pago":
    case "cuenta_pausada":
      return "/cobranza";
    case "nueva_solicitud_invitado":
      return "/centro/invitados";
    case "nueva_tarjeta_fidelidad":
      return "/fidelidad-admin";
    case "solicitud_cliente":
      return "/centro/solicitudes";
    case "visita_cliente":
      return "/centro/visitas";
    case "nueva_queja":
      return "/atencion-cliente";
    case "nuevo_logro":
      return "/diseno";
    default:
      return "/dashboard";
  }
}

export function esAvisoDePersonal(tipo: string): boolean {
  return TIPOS_DE_PERSONAL.has(tipo);
}
