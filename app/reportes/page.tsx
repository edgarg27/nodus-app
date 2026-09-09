import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ReportesPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("rol, centro")
    .eq("id", session.user.id)
    .single();

  if (profile?.rol === "cliente") redirect("/dashboard-cliente");

  const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
  const esGlobal = ROLES_GLOBALES.includes(profile?.rol || "");
  const miCentro = profile?.centro || null;

  let oficinasQuery = supabase.from("oficinas").select("centro, estado");
  let ticketsAbiertosQuery = supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("estado", "abierto");
  let ticketsEnProcesoQuery = supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("estado", "en_proceso");
  let ticketsCerradosQuery = supabase
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("estado", "cerrado");
  let resPendientesQuery = supabase
    .from("reservaciones")
    .select("*", { count: "exact", head: true })
    .eq("estado", "pendiente");
  let resConfirmadasQuery = supabase
    .from("reservaciones")
    .select("*", { count: "exact", head: true })
    .eq("estado", "confirmada");
  let resCanceladasQuery = supabase
    .from("reservaciones")
    .select("*", { count: "exact", head: true })
    .eq("estado", "cancelada");
  let clientesQuery = supabase.from("profiles").select("centro").eq("rol", "cliente");

  if (!esGlobal && miCentro) {
    oficinasQuery = oficinasQuery.eq("centro", miCentro);
    ticketsAbiertosQuery = ticketsAbiertosQuery.eq("centro", miCentro);
    ticketsEnProcesoQuery = ticketsEnProcesoQuery.eq("centro", miCentro);
    ticketsCerradosQuery = ticketsCerradosQuery.eq("centro", miCentro);
    resPendientesQuery = resPendientesQuery.eq("centro", miCentro);
    resConfirmadasQuery = resConfirmadasQuery.eq("centro", miCentro);
    resCanceladasQuery = resCanceladasQuery.eq("centro", miCentro);
    clientesQuery = clientesQuery.eq("centro", miCentro);
  }

  const [
    { data: oficinasRaw },
    { count: ticketsAbiertos },
    { count: ticketsEnProceso },
    { count: ticketsCerrados },
    { count: resPendientes },
    { count: resConfirmadas },
    { count: resCanceladas },
    { data: clientesRaw },
  ] = await Promise.all([
    oficinasQuery,
    ticketsAbiertosQuery,
    ticketsEnProcesoQuery,
    ticketsCerradosQuery,
    resPendientesQuery,
    resConfirmadasQuery,
    resCanceladasQuery,
    clientesQuery,
  ]);

  // Ocupación por centro
  const centrosMap: Record<string, { total: number; ocupadas: number; disponibles: number }> = {};
  (oficinasRaw || []).forEach((o) => {
    const centro = o.centro || "Sin centro";
    if (!centrosMap[centro]) centrosMap[centro] = { total: 0, ocupadas: 0, disponibles: 0 };
    centrosMap[centro].total++;
    if (o.estado === "ocupada") centrosMap[centro].ocupadas++;
    if (o.estado === "disponible") centrosMap[centro].disponibles++;
  });
  const ocupacion = Object.entries(centrosMap).map(([centro, d]) => ({
    centro,
    ...d,
    porcentaje: d.total ? Math.round((d.ocupadas / d.total) * 100) : 0,
  }));

  // Clientes por centro
  const clientesCentroMap: Record<string, number> = {};
  (clientesRaw || []).forEach((c) => {
    const centro = c.centro || "Sin centro";
    clientesCentroMap[centro] = (clientesCentroMap[centro] || 0) + 1;
  });
  const clientesPorCentro = Object.entries(clientesCentroMap)
    .map(([centro, count]) => ({ centro, count }))
    .sort((a, b) => b.count - a.count);

  const tickets = {
    abiertos: ticketsAbiertos || 0,
    enProceso: ticketsEnProceso || 0,
    cerrados: ticketsCerrados || 0,
    total: (ticketsAbiertos || 0) + (ticketsEnProceso || 0) + (ticketsCerrados || 0),
  };
  const reservaciones = {
    pendientes: resPendientes || 0,
    confirmadas: resConfirmadas || 0,
    canceladas: resCanceladas || 0,
    total: (resPendientes || 0) + (resConfirmadas || 0) + (resCanceladas || 0),
  };

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Reportes</p>
        <p className="rep-sub">
          {esGlobal ? "Estadísticas de todos los centros" : `Estadísticas de ${miCentro || "tu centro"}`}
        </p>
      </div>

      <div className="rep-content">
        <p className="rep-section-label">🏢 Ocupación por centro</p>
        {ocupacion.length === 0 ? (
          <div className="empty-card">Sin oficinas registradas</div>
        ) : (
          ocupacion.map((c) => (
            <div className="rep-ocupacion-card" key={c.centro}>
              <div className="rep-ocupacion-header">
                <span className="rep-ocupacion-centro">{c.centro}</span>
                <span className="rep-ocupacion-porcentaje">{c.porcentaje}%</span>
              </div>
              <div className="rep-progress-bar">
                <div
                  className="rep-progress-fill"
                  style={{
                    width: `${c.porcentaje}%`,
                    background:
                      c.porcentaje >= 80 ? "#A32D2D" : c.porcentaje >= 50 ? "#F07E3A" : "#0F6E56",
                  }}
                />
              </div>
              <div className="rep-ocupacion-detalle">
                <span>🔴 {c.ocupadas} ocupadas</span>
                <span>✅ {c.disponibles} disponibles</span>
                <span>📊 {c.total} total</span>
              </div>
            </div>
          ))
        )}

        <p className="rep-section-label">👥 Clientes registrados ({clientesRaw?.length || 0})</p>
        <div className="rep-card">
          {clientesPorCentro.length === 0 ? (
            <span style={{ color: "#888", fontSize: 13 }}>Sin clientes registrados</span>
          ) : (
            clientesPorCentro.map((c) => (
              <div className="rep-cliente-row" key={c.centro}>
                <span className="rep-cliente-centro">🏢 {c.centro}</span>
                <span className="rep-cliente-count-badge">{c.count}</span>
              </div>
            ))
          )}
        </div>

        <p className="rep-section-label">🎫 Tickets de soporte ({tickets.total})</p>
        <div className="rep-stats-row">
          <div className="rep-stat-card" style={{ borderLeftColor: "#185FA5" }}>
            <p className="rep-stat-num">{tickets.abiertos}</p>
            <p className="rep-stat-lbl">Abiertos</p>
          </div>
          <div className="rep-stat-card" style={{ borderLeftColor: "#854F0B" }}>
            <p className="rep-stat-num">{tickets.enProceso}</p>
            <p className="rep-stat-lbl">En proceso</p>
          </div>
          <div className="rep-stat-card" style={{ borderLeftColor: "#0F6E56" }}>
            <p className="rep-stat-num">{tickets.cerrados}</p>
            <p className="rep-stat-lbl">Resueltos</p>
          </div>
        </div>
        {tickets.total > 0 && (
          <div className="rep-barra-horizontal">
            <div
              className="rep-barra-segmento"
              style={{ flex: tickets.abiertos || 0.1, background: "#185FA5" }}
            />
            <div
              className="rep-barra-segmento"
              style={{ flex: tickets.enProceso || 0.1, background: "#854F0B" }}
            />
            <div
              className="rep-barra-segmento"
              style={{ flex: tickets.cerrados || 0.1, background: "#0F6E56" }}
            />
          </div>
        )}

        <p className="rep-section-label">📅 Reservaciones ({reservaciones.total})</p>
        <div className="rep-stats-row">
          <div className="rep-stat-card" style={{ borderLeftColor: "#854F0B" }}>
            <p className="rep-stat-num">{reservaciones.pendientes}</p>
            <p className="rep-stat-lbl">Pendientes</p>
          </div>
          <div className="rep-stat-card" style={{ borderLeftColor: "#0F6E56" }}>
            <p className="rep-stat-num">{reservaciones.confirmadas}</p>
            <p className="rep-stat-lbl">Confirmadas</p>
          </div>
          <div className="rep-stat-card" style={{ borderLeftColor: "#A32D2D" }}>
            <p className="rep-stat-num">{reservaciones.canceladas}</p>
            <p className="rep-stat-lbl">Canceladas</p>
          </div>
        </div>
        {reservaciones.total > 0 && (
          <div className="rep-barra-horizontal">
            <div
              className="rep-barra-segmento"
              style={{ flex: reservaciones.pendientes || 0.1, background: "#854F0B" }}
            />
            <div
              className="rep-barra-segmento"
              style={{ flex: reservaciones.confirmadas || 0.1, background: "#0F6E56" }}
            />
            <div
              className="rep-barra-segmento"
              style={{ flex: reservaciones.canceladas || 0.1, background: "#A32D2D" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
