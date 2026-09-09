"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Solicitud = {
  id: string;
  folio: string;
  descripcion: string;
  estado: string;
  urgencia: string | null;
  centro: string | null;
  cliente_nombre: string | null;
  cliente_email: string | null;
  user_id: string;
  created_at: string;
};

const URGENCIA_INFO: Record<string, { label: string; color: string; bg: string }> = {
  urgente: { label: "🔴 Urgente", color: "#A32D2D", bg: "#FCEBEB" },
  media: { label: "🟡 Media", color: "#8A6D00", bg: "#FEF6D8" },
  baja: { label: "🟢 No urgente", color: "#0F6E56", bg: "#E1F5EE" },
};

const DURACIONES = [
  { label: "1 hora", minutos: 60 },
  { label: "8 horas", minutos: 480 },
  { label: "1 día", minutos: 1440 },
  { label: "7 días", minutos: 10080 },
  { label: "30 días", minutos: 43200 },
  { label: "90 días", minutos: 129600 },
];

export default function WifiSolicitudesPage() {
  const supabase = createClient();
  const [pendientes, setPendientes] = useState<Solicitud[]>([]);
  const [historial, setHistorial] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [duracionPorId, setDuracionPorId] = useState<Record<string, number>>({});
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchTodo();
  }, []);

  async function fetchTodo() {
    setLoading(true);
    const [{ data: pend }, { data: hist }] = await Promise.all([
      supabase
        .from("tickets")
        .select("id, folio, descripcion, estado, urgencia, centro, cliente_nombre, cliente_email, user_id, created_at")
        .eq("asunto", "📶 Solicitud de nuevo WiFi")
        .neq("estado", "cerrado")
        .order("created_at", { ascending: false }),
      supabase
        .from("tickets")
        .select("id, folio, descripcion, estado, urgencia, centro, cliente_nombre, cliente_email, user_id, created_at")
        .eq("asunto", "📶 Solicitud de nuevo WiFi")
        .eq("estado", "cerrado")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setPendientes(pend || []);
    setHistorial(hist || []);
    setLoading(false);
  }

  async function aprobar(s: Solicitud) {
    setError("");
    setProcesando(s.id);
    const minutos = duracionPorId[s.id] || 43200;
    const centroCliente = s.centro || "Bosques";

    try {
      let codigo = "";

      if (centroCliente === "Bosques") {
        const res = await fetch("/api/generar-voucher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteId: s.user_id, minutos }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "No se pudo generar el voucher");
          setProcesando(null);
          return;
        }
        codigo = data.voucher.codigo;
      } else {
        const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let c = "";
        for (let i = 0; i < 8; i++) c += letras[Math.floor(Math.random() * letras.length)];
        codigo = `${c.slice(0, 4)}-${c.slice(4)}`;
        const folioVoucher = `VCH-${Date.now().toString().slice(-6)}`;
        const expiraEn = new Date(Date.now() + minutos * 60 * 1000).toISOString();

        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error: insertError } = await supabase.from("vouchers").insert({
          user_id: s.user_id,
          codigo,
          folio: folioVoucher,
          centro: centroCliente,
          generado_por: user?.id,
          duracion_minutos: minutos,
          expira_en: expiraEn,
        });
        if (insertError) {
          setError("No se pudo guardar el voucher");
          setProcesando(null);
          return;
        }
      }

      await supabase
        .from("tickets")
        .update({
          estado: "cerrado",
          descripcion: `${s.descripcion}\n\n✅ Aprobada — código generado: ${codigo}`,
        })
        .eq("id", s.id);

      await supabase.from("notificaciones").insert({
        centro: centroCliente,
        tipo: "nuevo_voucher",
        mensaje: `🎟️ Solicitud de WiFi de ${s.cliente_nombre || "cliente"} aprobada (${centroCliente})`,
      });

      fetchTodo();
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setProcesando(null);
  }

  async function rechazar(s: Solicitud) {
    const motivo = prompt("¿Por qué la rechazas? (opcional, se lo va a ver el cliente)") || "";
    setProcesando(s.id);
    await supabase
      .from("tickets")
      .update({
        estado: "cerrado",
        descripcion: `${s.descripcion}\n\n❌ Rechazada${motivo ? `: ${motivo}` : ""}`,
      })
      .eq("id", s.id);
    setProcesando(null);
    fetchTodo();
  }

  return (
    <div className="rep-page">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Solicitudes de WiFi</p>
        <p className="rep-sub">De todos los centros</p>
      </div>

      <div className="rep-content">
        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : (
          <>
            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <p className="panel-section-label">Pendientes ({pendientes.length})</p>
            {pendientes.length === 0 ? (
              <div className="empty-card">🎉 Sin solicitudes pendientes</div>
            ) : (
              pendientes.map((s) => (
                <div className="ticket-admin-card" key={s.id}>
                  <div className="ticket-top">
                    <div className="ticket-icono">
                    <img src="/icons/wifi.png" alt="" className="icon-img-20" />
                  </div>
                    <div className="ticket-info">
                      <p className="ticket-folio">{s.folio}</p>
                      <p className="ticket-asunto">{s.cliente_nombre || s.cliente_email || "Cliente"}</p>
                      <p className="ticket-categoria">
                        {s.centro || "—"} · {new Date(s.created_at).toLocaleDateString("es-MX")}
                      </p>
                      {s.urgencia && URGENCIA_INFO[s.urgencia] && (
                        <span
                          style={{
                            display: "inline-block",
                            marginTop: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: URGENCIA_INFO[s.urgencia].bg,
                            color: URGENCIA_INFO[s.urgencia].color,
                          }}
                        >
                          {URGENCIA_INFO[s.urgencia].label}
                        </span>
                      )}
                    </div>
                  </div>

                  <p style={{ fontSize: 13, color: "#555", margin: 0 }}>{s.descripcion}</p>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <select
                      className="ticket-admin-select"
                      value={duracionPorId[s.id] || 43200}
                      onChange={(e) => setDuracionPorId({ ...duracionPorId, [s.id]: Number(e.target.value) })}
                    >
                      {DURACIONES.map((d) => (
                        <option key={d.minutos} value={d.minutos}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={"btn-enviar" + (procesando === s.id ? " sending" : "")}
                      style={{ width: "auto", padding: "8px 16px" }}
                      disabled={procesando === s.id}
                      onClick={() => aprobar(s)}
                    >
                      <span className="btn-enviar-icon-wrapper">
                        <svg
                          className="btn-enviar-icon"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path fill="none" d="M0 0h24v24H0z"></path>
                          <path
                            fill="currentColor"
                            d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                          ></path>
                        </svg>
                      </span>
                      <span className="btn-enviar-text">
                        {procesando === s.id ? "..." : "✅ Generar y aprobar"}
                      </span>
                    </button>
                    <button
                      className="tel-borrar-btn"
                      disabled={procesando === s.id}
                      onClick={() => rechazar(s)}
                    >
                      ❌ Rechazar
                    </button>
                  </div>
                </div>
              ))
            )}

            {historial.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 20 }}>
                  Historial reciente
                </p>
                {historial.map((s) => {
                  const aprobada = s.descripcion.includes("✅ Aprobada");
                  return (
                    <div className="ticket-admin-card" key={s.id}>
                      <div className="ticket-top">
                        <div className="ticket-icono">
                    <img src="/icons/wifi.png" alt="" className="icon-img-20" />
                  </div>
                        <div className="ticket-info">
                          <p className="ticket-folio">{s.folio}</p>
                          <p className="ticket-asunto">{s.cliente_nombre || s.cliente_email || "Cliente"}</p>
                          <p className="ticket-categoria">
                            {s.centro || "—"} · {new Date(s.created_at).toLocaleDateString("es-MX")}
                          </p>
                        </div>
                        <span
                          className="estado-badge"
                          style={{
                            background: aprobada ? "#E1F5EE" : "#FCEBEB",
                            color: aprobada ? "#0F6E56" : "#A32D2D",
                            flexShrink: 0,
                          }}
                        >
                          {aprobada ? "✓ Aprobada" : "✕ Rechazada"}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: "#888", margin: 0, whiteSpace: "pre-line" }}>
                        {s.descripcion}
                      </p>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
