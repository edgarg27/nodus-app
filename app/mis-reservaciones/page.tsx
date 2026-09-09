"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Reservacion = {
  id: string;
  espacio: string;
  fecha: string;
  hora: string;
  hora_inicio: string | null;
  centro: string;
  estado: string;
};

// Regla: ya no se puede cancelar en línea si faltan menos de 30 minutos
// para que empiece la reservación (o si ya empezó).
const MINUTOS_LIMITE_CANCELACION = 30;

function puedeCancelarEnLinea(r: Reservacion) {
  if (!r.hora_inicio) return true; // sin dato de hora, no bloqueamos por seguridad
  const [y, m, d] = r.fecha.split("-").map(Number);
  const [h, min] = r.hora_inicio.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(h)) return true;
  const inicio = new Date(y, m - 1, d, h, min || 0);
  const limite = new Date(inicio.getTime() - MINUTOS_LIMITE_CANCELACION * 60000);
  return new Date() < limite;
}

const ESTADO_BADGE: Record<string, { bg: string; label: string }> = {
  confirmada: { bg: "#E1F5EE", label: "✓ Confirmada" },
  cancelada: { bg: "#FCEBEB", label: "✗ Cancelada" },
  rechazada: { bg: "#FCEBEB", label: "✗ Rechazada" },
  pendiente: { bg: "#FAEEDA", label: "⏳ Pendiente" },
};

export default function MisReservacionesPage() {
  const supabase = createClient();
  const [reservaciones, setReservaciones] = useState<Reservacion[]>([]);
  const [motivosRechazo, setMotivosRechazo] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("Cliente");

  const [cancelando, setCancelando] = useState<Reservacion | null>(null);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [guardandoCancelacion, setGuardandoCancelacion] = useState(false);

  useEffect(() => {
    fetchReservaciones();
  }, []);

  async function fetchReservaciones() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre")
      .eq("id", user.id)
      .single();
    if (profile?.nombre) setNombre(profile.nombre);

    const { data } = await supabase
      .from("reservaciones")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setReservaciones(data || []);

    // No hay columna `motivo_rechazo` en `reservaciones` — se resuelve desde
    // `notificaciones` (mismo criterio que CentroPanel.tsx del lado admin).
    const rechazadaIds = (data || []).filter((r) => r.estado === "rechazada").map((r) => r.id);
    if (rechazadaIds.length > 0) {
      const { data: notifs } = await supabase
        .from("notificaciones")
        .select("reservacion_id, mensaje")
        .eq("user_id", user.id)
        .eq("tipo", "reservacion_rechazada")
        .in("reservacion_id", rechazadaIds);
      const mapa: Record<string, string> = {};
      (notifs || []).forEach((n) => {
        if (n.reservacion_id) mapa[n.reservacion_id] = n.mensaje;
      });
      setMotivosRechazo(mapa);
    }
    setLoading(false);
  }

  function cancelar(id: string) {
    const reserva = reservaciones.find((r) => r.id === id);
    if (!reserva || !puedeCancelarEnLinea(reserva)) return;
    setMotivoCancelacion("");
    setCancelando(reserva); // solo abre el modal, no cancela todavía
  }

  async function confirmarCancelacion() {
    if (!cancelando) return;
    if (!motivoCancelacion.trim()) {
      alert("Cuéntanos por qué cancelas para poder ayudarte mejor.");
      return;
    }
    setGuardandoCancelacion(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("reservaciones")
      .update({ estado: "cancelada" })
      .eq("id", cancelando.id);
    if (!error) {
      // Se guarda como notificación (mismo criterio que ya usa el admin
      // para el motivo de rechazo) para que en Panel de Centro se vea el
      // motivo por el que el cliente canceló, junto a la reservación.
      await supabase.from("notificaciones").insert({
        centro: cancelando.centro,
        user_id: user?.id || null,
        tipo: "reservacion_cancelada_cliente",
        mensaje: motivoCancelacion.trim(),
        reservacion_id: cancelando.id,
      });
      setCancelando(null);
      setMotivoCancelacion("");
      fetchReservaciones();
    }
    setGuardandoCancelacion(false);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mis Reservaciones</p>
        <p className="rep-sub">{nombre}</p>
      </div>

      <div className="sub-content">
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
        ) : reservaciones.length === 0 ? (
          <div className="empty-card">
            <p style={{ fontSize: 48, margin: 0 }}>📅</p>
            <p style={{ fontWeight: 700, color: "#1a1a1a", margin: "8px 0 4px" }}>
              Sin reservaciones
            </p>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 12px" }}>
              Aún no tienes reservaciones activas
            </p>
            <a className="reservar-btn" href="/reservaciones" style={{ display: "inline-block" }}>
              Hacer una reservación
            </a>
          </div>
        ) : (
          <>
            <p className="panel-section-label">{reservaciones.length} reservación(es)</p>
            {reservaciones.map((r) => (
              <div className="reservacion-card" key={r.id}>
                <div className="reservacion-top">
                  <div className="servicio-icono">
                    {r.espacio.includes("Sala") ? (
                      <img src="/icons/sala-juntas.png" alt="" className="icon-img-24" />
                    ) : r.espacio.includes("Coworking") ? (
                      "💻"
                    ) : (
                      "📚"
                    )}
                  </div>
                  <div className="reservacion-info">
                    <p className="reservacion-espacio">{r.espacio}</p>
                    <p className="reservacion-detalle">
                      {r.fecha} · {r.hora}
                    </p>
                    <p className="reservacion-centro">{r.centro}</p>
                  </div>
                  <span
                    className="estado-badge"
                    style={{ background: (ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente).bg }}
                  >
                    {(ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente).label}
                  </span>
                </div>

                {r.estado === "rechazada" && motivosRechazo[r.id] && (
                  <p style={{ fontSize: 12, color: "#A32D2D", margin: "6px 0 0" }}>{motivosRechazo[r.id]}</p>
                )}

                {r.estado === "confirmada" &&
                  (puedeCancelarEnLinea(r) ? (
                    <button className="cancelar-btn" onClick={() => cancelar(r.id)}>
                      Cancelar reservación
                    </button>
                  ) : (
                    <p style={{ fontSize: 12, color: "#a3701f", margin: "6px 0 0" }}>
                      Ya no puedes cancelar esta reservación en línea (falta menos de {MINUTOS_LIMITE_CANCELACION} min o
                      ya comenzó). Contacta a recepción si necesitas cancelarla.
                    </p>
                  ))}
              </div>
            ))}
          </>
        )}
      </div>

      {cancelando && (
        <div
          className="modal-overlay"
          onClick={() => {
            setCancelando(null);
            setMotivoCancelacion("");
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Cancelar reservación</p>
            <p className="modal-email">
              {cancelando.espacio} · {cancelando.fecha} · {cancelando.hora}
            </p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Por qué cancelas? (el equipo del centro lo verá)
            </p>
            <textarea
              autoFocus
              placeholder="Ej. Ya no la voy a necesitar / cambio de planes"
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="tel-borrar-btn"
                onClick={() => {
                  setCancelando(null);
                  setMotivoCancelacion("");
                }}
              >
                Regresar
              </button>
              <button className="btn-rechazar" onClick={confirmarCancelacion} disabled={guardandoCancelacion}>
                {guardandoCancelacion ? "Cancelando..." : "Confirmar cancelación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
