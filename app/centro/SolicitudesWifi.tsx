"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AVISO_SOLO_COWORKING, clientesConCoworking } from "@/lib/coworking";

// Solicitudes de WiFi que mandan los clientes de Coworking desde "Mi WiFi"
// (tickets con asunto "📶 Solicitud de nuevo WiFi"). Antes eran una tarjeta
// aparte (/wifi-solicitudes); ahora viven dentro de Vouchers, que es donde
// se genera todo lo de WiFi. Las oficinas privadas ya no piden WiFi.

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

const ASUNTO_WIFI = "📶 Solicitud de nuevo WiFi";

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

export default function SolicitudesWifi({
  centro,
  esGlobal,
  onVoucherGenerado,
}: {
  // Centro a mostrar; los roles globales ven las de todos los centros.
  centro: string | null;
  esGlobal: boolean;
  // Para que Vouchers recargue su lista después de aprobar.
  onVoucherGenerado?: () => void;
}) {
  const supabase = createClient();
  const [pendientes, setPendientes] = useState<Solicitud[]>([]);
  const [historial, setHistorial] = useState<Solicitud[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [duracionPorId, setDuracionPorId] = useState<Record<string, number>>({});
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [clientesCoworking, setClientesCoworking] = useState<Set<string>>(new Set());
  // Rechazo con el modal de la app (antes era prompt() nativo).
  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  useEffect(() => {
    fetchTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, esGlobal]);

  async function fetchTodo() {
    setLoading(true);
    const base = () => {
      let q = supabase
        .from("tickets")
        .select("id, folio, descripcion, estado, urgencia, centro, cliente_nombre, cliente_email, user_id, created_at")
        .eq("asunto", ASUNTO_WIFI);
      if (!esGlobal && centro) q = q.eq("centro", centro);
      return q;
    };
    const [{ data: pend }, { data: hist }] = await Promise.all([
      base().neq("estado", "cerrado").order("created_at", { ascending: false }),
      base().eq("estado", "cerrado").order("created_at", { ascending: false }).limit(20),
    ]);
    setPendientes(pend || []);
    setHistorial(hist || []);
    setClientesCoworking(await clientesConCoworking(supabase, Array.from(new Set((pend || []).map((p) => p.user_id)))));
    setLoading(false);
  }

  async function aprobar(s: Solicitud) {
    setError("");
    if (!clientesCoworking.has(s.user_id)) {
      setError(AVISO_SOLO_COWORKING);
      return;
    }
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

      await fetchTodo();
      onVoucherGenerado?.();
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setProcesando(null);
  }

  async function confirmarRechazo() {
    const s = rechazando;
    if (!s) return;
    const motivo = motivoRechazo.trim();
    setRechazando(null);
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

  if (loading) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <p className="panel-section-label">Solicitudes de WiFi ({pendientes.length})</p>
      <p style={{ fontSize: 12, color: "#888", margin: "2px 0 6px" }}>
        Las mandan los clientes de Coworking desde su app. Elige la duración y genera su código.
      </p>
      {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

      {pendientes.length === 0 ? (
        <div className="empty-card">🎉 Sin solicitudes pendientes</div>
      ) : (
        pendientes.map((s) => (
          <div className="ticket-admin-card" key={s.id}>
            <div className="ticket-top">
              <div className="ticket-icono">
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
                className="btn-aceptar"
                style={{ width: "auto", padding: "8px 16px" }}
                disabled={procesando === s.id || !clientesCoworking.has(s.user_id)}
                title={clientesCoworking.has(s.user_id) ? undefined : AVISO_SOLO_COWORKING}
                onClick={() => aprobar(s)}
              >
                {procesando === s.id ? "..." : "✅ Generar y aprobar"}
              </button>
              <button
                className="tel-borrar-btn"
                disabled={procesando === s.id}
                onClick={() => {
                  setMotivoRechazo("");
                  setRechazando(s);
                }}
              >
                ❌ Rechazar
              </button>
              {!clientesCoworking.has(s.user_id) && (
                <span style={{ fontSize: 12, color: "#888" }}>No es cliente de Coworking: solo se puede rechazar.</span>
              )}
            </div>
          </div>
        ))
      )}

      {historial.length > 0 && (
        <>
          <button
            className="tel-borrar-btn"
            style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 6 }}
            onClick={() => setVerHistorial((v) => !v)}
          >
            {verHistorial ? "▲ Ocultar historial de solicitudes" : `▼ Ver historial de solicitudes (${historial.length})`}
          </button>
          {verHistorial &&
            historial.map((s) => {
              const aprobada = s.descripcion.includes("✅ Aprobada");
              return (
                <div className="ticket-admin-card" key={s.id}>
                  <div className="ticket-top">
                    <div className="ticket-icono">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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
                  <p style={{ fontSize: 12, color: "#888", margin: 0, whiteSpace: "pre-line" }}>{s.descripcion}</p>
                </div>
              );
            })}
        </>
      )}

      {rechazando && (
        <div className="modal-overlay" onClick={() => setRechazando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Rechazar solicitud de WiFi</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Rechazar la solicitud de {rechazando.cliente_nombre || "este cliente"}? El motivo lo va a ver el cliente.
            </p>
            <input
              type="text"
              placeholder="Motivo (opcional)"
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              style={{ marginTop: 8, width: "100%" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setRechazando(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={confirmarRechazo}>
                ❌ Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
