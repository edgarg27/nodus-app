import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminPanel from "./AdminPanel";
import PanelVentas from "./PanelVentas";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { calcularOcupacionPorCentro } from "@/lib/ocupacion";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre, rol, centro")
    .eq("id", session.user.id)
    .single();

  // Antes esta página mostraba el Panel Admin sin importar el rol — un
  // cliente (o cualquier cuenta sin perfil todavía, ej. si el alta falló a
  // medias) que entrara directo a /dashboard por URL veía el panel de
  // administrador completo. El login (app/login/page.tsx) ya manda a los
  // clientes a /dashboard-cliente, pero esta pantalla necesita el mismo
  // candado — no puede confiar en que siempre lleguen por esa puerta.
  if (!profile?.rol) redirect("/login");
  if (profile.rol === "cliente") redirect("/dashboard-cliente");

  // Ventas solo ve los contratos que la administradora manda a firma (ver PanelVentas).
  if (profile.rol === "ventas") {
    return <PanelVentas nombre={profile.nombre || session.user.email || "Ventas"} rol={profile.rol} centro={profile.centro || null} />;
  }

  const esGlobal = ROLES_GLOBALES.includes(profile?.rol || "");
  const miCentro = profile?.centro || null;

  // Clientes: si no es rol global, solo los de su propio centro
  let clientesQuery = supabase.from("profiles").select("*").eq("rol", "cliente");
  if (!esGlobal && miCentro) clientesQuery = clientesQuery.eq("centro", miCentro);
  const { data: clientes } = await clientesQuery.order("nombre");

  const idsClientesCentro = (clientes || []).map((c) => c.id);

  // Facturas: la tabla ya tiene columna "centro" directo
  let facturasPendQuery = supabase
    .from("facturas")
    .select("*", { count: "exact", head: true })
    .eq("estado", "pendiente");
  let facturasVencQuery = supabase.from("facturas").select("monto").eq("estado", "vencida");
  if (!esGlobal && miCentro) {
    facturasPendQuery = facturasPendQuery.eq("centro", miCentro);
    facturasVencQuery = facturasVencQuery.eq("centro", miCentro);
  }

  // Pagos no tiene columna "centro" directo, se filtra por los clientes de ese centro
  let comprobantesQuery = supabase
    .from("pagos")
    .select("*", { count: "exact", head: true })
    .eq("estado", "en_revision");
  if (!esGlobal) {
    comprobantesQuery = comprobantesQuery.in(
      "user_id",
      idsClientesCentro.length > 0 ? idsClientesCentro : ["00000000-0000-0000-0000-000000000000"]
    );
  }

  // Lo que la administradora tiene que atender hoy. Todo se acota al centro
  // del usuario salvo en roles globales.
  const filtrarCentro = (q: any) => (!esGlobal && miCentro ? q.eq("centro", miCentro) : q);
  const hoy = hoyMexicoISO();
  const en30Dias = new Date(hoy + "T00:00:00Z");
  en30Dias.setUTCDate(en30Dias.getUTCDate() + 30);
  const limite30 = en30Dias.toISOString().slice(0, 10);

  const [
    { count: facturasPendientes },
    { data: facturasVencidasRows },
    { count: comprobantesRevisar },
    { count: solicitudesInvitados },
    { count: solicitudesClientes },
    { count: reservacionesPendientes },
    { count: ticketsAbiertos },
    { count: ticketsUrgentes },
    { data: oficinasRows },
    { data: contratosOcupados },
    { count: contratosPorVencer },
  ] = await Promise.all([
    facturasPendQuery,
    facturasVencQuery,
    comprobantesQuery,
    filtrarCentro(supabase.from("solicitudes_invitados").select("*", { count: "exact", head: true }).eq("estado", "pendiente")),
    filtrarCentro(supabase.from("solicitudes_cliente").select("*", { count: "exact", head: true }).eq("estado", "pendiente")),
    filtrarCentro(
      supabase.from("reservaciones").select("*", { count: "exact", head: true }).eq("estado", "pendiente").gte("fecha", hoy)
    ),
    filtrarCentro(
      supabase.from("tickets").select("*", { count: "exact", head: true }).in("estado", ["abierto", "en_proceso"])
    ),
    filtrarCentro(
      supabase
        .from("tickets")
        .select("*", { count: "exact", head: true })
        .in("estado", ["abierto", "en_proceso"])
        .eq("urgencia", "urgente")
    ),
    filtrarCentro(supabase.from("oficinas").select("id, centro, tipo").limit(5000)),
    // Ocupación real: contratos vigentes con cliente de verdad (mismo criterio
    // que Reportes), no oficinas.estado.
    filtrarCentro(
      supabase.from("contratos").select("oficina_id").eq("estatus", "vigente").not("oficina_id", "is", null).not("user_id", "is", null)
    ),
    filtrarCentro(
      supabase
        .from("contratos")
        .select("*", { count: "exact", head: true })
        .eq("estatus", "vigente")
        .not("user_id", "is", null)
        .gte("fecha_vencimiento", hoy)
        .lte("fecha_vencimiento", limite30)
    ),
  ]);

  const facturasVencidas = facturasVencidasRows?.length || 0;
  const montoVencido = (facturasVencidasRows || []).reduce((suma, f: any) => suma + Number(f.monto || 0), 0);
  // Todo el coworking de un centro cuenta como un solo espacio (ver lib/ocupacion.ts).
  const ocupacionPorCentro = Object.values(calcularOcupacionPorCentro(oficinasRows || [], contratosOcupados || []));
  const oficinasTotal = ocupacionPorCentro.reduce((suma, c) => suma + c.total, 0);
  const oficinasOcupadas = ocupacionPorCentro.reduce((suma, c) => suma + c.ocupadas, 0);

  return (
    <AdminPanel
      nombre={profile?.nombre || session.user.email || "Sistemas"}
      rol={profile?.rol || ""}
      centro={miCentro}
      resumen={{
        totalClientes: (clientes || []).filter((c) => c.activo !== false && !c.suspendido).length,
        facturasPendientes: facturasPendientes || 0,
        facturasVencidas,
        montoVencido,
        comprobantesRevisar: comprobantesRevisar || 0,
        solicitudesInvitados: solicitudesInvitados || 0,
        solicitudesClientes: solicitudesClientes || 0,
        reservacionesPendientes: reservacionesPendientes || 0,
        ticketsAbiertos: ticketsAbiertos || 0,
        ticketsUrgentes: ticketsUrgentes || 0,
        oficinasTotal,
        oficinasOcupadas,
        contratosPorVencer: contratosPorVencer || 0,
      }}
      clientesIniciales={clientes || []}
    />
  );
}
