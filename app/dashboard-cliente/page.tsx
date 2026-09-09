import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClientePanel from "./ClientePanel";

export default async function DashboardClientePage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre, email, rol, centro, ciudad, rfc, numero_oficina, tipo_oficina, numero_usuario")
    .eq("id", session.user.id)
    .single();

  // La tarjeta de estado en el dashboard lee exclusivamente de `pagos`
  // (no de `facturas`) — un pago sin factura (renta, depósito,
  // adicionales generados al aprobar un contrato) pesa igual que uno con
  // factura para efectos de "cuánto debo". `/estado-cuenta` sigue usando
  // `facturas` para el detalle completo, sin cambios.
  const { data: pagosPendientes } = await supabase
    .from("pagos")
    .select("estado, fecha_limite")
    .eq("user_id", session.user.id)
    .neq("estado", "pagado");

  const { data: vouchers } = await supabase
    .from("vouchers")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: miExtension } = await supabase
    .from("extensiones")
    .select("extension, did, tipo")
    .eq("user_id", session.user.id)
    .eq("activo", true)
    .limit(1)
    .maybeSingle();

  // El banco de horas (sala de juntas / bolsa) ahora es por contrato, no
  // por cliente — un cliente puede tener más de un contrato vigente a la
  // vez. Esa lógica (selector de contrato + cálculo de horas) vive del
  // lado del cliente en ClientePanel.tsx, no aquí.

  const { data: ticketsEnProceso } = await supabase
    .from("tickets")
    .select("id, folio, asunto")
    .eq("user_id", session.user.id)
    .eq("estado", "en_proceso");

  const { data: ticketResuelto } = await supabase
    .from("tickets")
    .select("id, folio, asunto, descripcion")
    .eq("user_id", session.user.id)
    .eq("estado", "cerrado")
    .eq("notificado_resuelto", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <ClientePanel
      profile={profile}
      email={session.user.email || ""}
      pagosPendientes={pagosPendientes || []}
      voucher={vouchers?.[0] || null}
      extension={miExtension || null}
      ticketsEnProceso={ticketsEnProceso || []}
      ticketResuelto={ticketResuelto || null}
    />
  );
}
