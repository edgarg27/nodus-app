"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Visita = {
  id: string;
  visitante_nombre: string;
  visitante_empresa: string | null;
  fecha: string;
  hora: string;
  motivo: string | null;
  estado: "esperada" | "llego" | "cancelada";
};

const ESTADO_BADGE: Record<Visita["estado"], { bg: string; color: string; label: string }> = {
  esperada: { bg: "#FAEEDA", color: "#854F0B", label: "⏳ Esperada" },
  llego: { bg: "#E1F5EE", color: "#0F6E56", label: "✓ Ya llegó" },
  cancelada: { bg: "#FCEBEB", color: "#A32D2D", label: "✗ Cancelada" },
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFecha(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "long" });
}

export default function MisVisitasPage() {
  const supabase = createClient();
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("");

  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [telefono, setTelefono] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [hora, setHora] = useState("10:00");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [registrada, setRegistrada] = useState(false);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: perfil } = await supabase.from("profiles").select("numero_oficina, centro").eq("id", user.id).single();
    if (perfil) {
      setSub(`${perfil.numero_oficina ? `Oficina ${perfil.numero_oficina} · ` : ""}${perfil.centro || ""}`);
    }
    const { data } = await supabase
      .from("visitas_cliente")
      .select("id, visitante_nombre, visitante_empresa, fecha, hora, motivo, estado")
      .eq("user_id", user.id)
      .order("fecha", { ascending: false })
      .order("hora", { ascending: false })
      .limit(60);
    setVisitas((data as Visita[]) || []);
    setLoading(false);
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setRegistrada(false);
    if (!nombre.trim()) {
      setError("Escribe el nombre del visitante");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/visitas-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, empresa, telefono, fecha, hora, motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo registrar la visita");
      } else {
        setRegistrada(true);
        setNombre("");
        setEmpresa("");
        setTelefono("");
        setMotivo("");
        await cargar();
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setEnviando(false);
  }

  async function cancelar(id: string) {
    if (!confirm("¿Cancelar esta visita?")) return;
    const res = await fetch("/api/visitas-cliente", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) await cargar();
  }

  const hoy = hoyISO();
  const proximas = visitas
    .filter((v) => v.estado === "esperada" && v.fecha >= hoy)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const historial = visitas.filter((v) => !proximas.includes(v));

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mis Visitas</p>
        <p className="rep-sub">{sub}</p>
      </div>

      <div className="sub-content">
        <form className="form-card" onSubmit={registrar}>
          <p className="modal-nombre" style={{ margin: 0 }}>
            Avisar de una visita
          </p>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 4px" }}>
            Recepción recibirá el aviso y esperará a tu visitante.
          </p>

          <p className="sub-label">Nombre del visitante</p>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" />

          <p className="sub-label">Empresa (opcional)</p>
          <input type="text" value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Empresa del visitante" />

          <p className="sub-label">Teléfono (opcional)</p>
          <input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Para contactarlo" />

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <p className="sub-label">Fecha</p>
              <input type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <p className="sub-label">Hora</p>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>

          <p className="sub-label">Motivo (opcional)</p>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Reunión, entrega de documentos" />

          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          {registrada && <p style={{ color: "#0F6E56", fontSize: 13 }}>Listo, recepción ya recibió el aviso.</p>}

          <button className="reservar-btn" type="submit" disabled={enviando}>
            {enviando ? "Enviando..." : "Avisar a recepción"}
          </button>
        </form>

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
            <p className="panel-section-label">Próximas visitas ({proximas.length})</p>
            {proximas.length === 0 ? (
              <div className="empty-card">No tienes visitas registradas</div>
            ) : (
              proximas.map((v) => (
                <div className="item-card" key={v.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">{v.visitante_nombre}</p>
                    <p className="item-card-sub">
                      {formatFecha(v.fecha)} · {v.hora}
                      {v.visitante_empresa ? ` · ${v.visitante_empresa}` : ""}
                    </p>
                  </div>
                  <button className="tel-borrar-btn" onClick={() => cancelar(v.id)}>
                    Cancelar
                  </button>
                </div>
              ))
            )}

            {historial.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 8 }}>
                  Historial
                </p>
                {historial.map((v) => {
                  const badge = ESTADO_BADGE[v.estado];
                  return (
                    <div className="item-card" key={v.id}>
                      <div className="item-card-info">
                        <p className="item-card-titulo">{v.visitante_nombre}</p>
                        <p className="item-card-sub">
                          {formatFecha(v.fecha)} · {v.hora}
                        </p>
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                      </span>
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
