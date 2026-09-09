"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Voucher = {
  id: string;
  codigo: string;
  folio: string;
  created_at: string;
  expira_en: string | null;
};

type Solicitud = {
  id: string;
  folio: string;
  descripcion: string;
  estado: string;
  created_at: string;
};

const badgeInfo = (s: Solicitud) => {
  if (s.estado === "cerrado") {
    if (s.descripcion.includes("✅ Aprobada")) return { bg: "#E1F5EE", color: "#0F6E56", texto: "✓ Aprobada" };
    if (s.descripcion.includes("❌ Rechazada")) return { bg: "#FCEBEB", color: "#A32D2D", texto: "✕ Rechazada" };
    return { bg: "#E1F5EE", color: "#0F6E56", texto: "✓ Atendida" };
  }
  if (s.estado === "en_proceso") return { bg: "#FEF6D8", color: "#8A6D00", texto: "⏳ En proceso" };
  return { bg: "#E6F1FB", color: "#185FA5", texto: "📋 Enviada" };
};

export default function MiWifiPage() {
  const supabase = createClient();
  const [nombre, setNombre] = useState("");
  const [centro, setCentro] = useState("");
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [tabWifi, setTabWifi] = useState<"activos" | "vencidos">("activos");

  function renderVoucherCard(v: Voucher) {
    const vencido = v.expira_en && new Date(v.expira_en) < new Date();
    return (
      <div
        key={v.id}
        style={{
          background: "#0d1b3e",
          borderRadius: 16,
          padding: 16,
          marginBottom: 10,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          opacity: vencido ? 0.7 : 1,
        }}
      >
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, margin: 0 }}>Folio: {v.folio}</p>
        <p
          style={{
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 1,
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {v.codigo}
        </p>
        {v.expira_en && (
          <p
            style={{
              color: vencido ? "#f07e3a" : "rgba(255,255,255,0.6)",
              fontSize: 11,
              margin: "2px 0 0",
              fontWeight: 600,
            }}
          >
            {vencido && (
              <img
                src="/icons/advertencia.png"
                alt=""
                style={{ width: 12, height: 12, verticalAlign: -1, marginRight: 4 }}
              />
            )}
            {vencido ? "Venció el " : "Vence el "}
            {new Date(v.expira_en).toLocaleString("es-MX")}
          </p>
        )}
      </div>
    );
  }

  const vouchersActivos = vouchers.filter((v) => !v.expira_en || new Date(v.expira_en) >= new Date());
  const vouchersVencidos = vouchers.filter((v) => v.expira_en && new Date(v.expira_en) < new Date());

  useEffect(() => {
    fetchTodo();
  }, []);

  async function fetchTodo() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre, centro")
      .eq("id", user.id)
      .single();
    setNombre(profile?.nombre || "");
    setCentro(profile?.centro || "");

    const [{ data: vch }, { data: sols }] = await Promise.all([
      supabase
        .from("vouchers")
        .select("id, codigo, folio, created_at, expira_en")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tickets")
        .select("id, folio, descripcion, estado, created_at")
        .eq("user_id", user.id)
        .eq("asunto", "📶 Solicitud de nuevo WiFi")
        .order("created_at", { ascending: false }),
    ]);

    setVouchers(vch || []);
    setSolicitudes(sols || []);
    setLoading(false);
  }

  async function enviarSolicitud(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setEnviando(false);
      return;
    }

    const folio = `REP-${Date.now().toString().slice(-6)}`;
    const { error } = await supabase.from("tickets").insert({
      user_id: user.id,
      folio,
      asunto: "📶 Solicitud de nuevo WiFi",
      descripcion: notas.trim() || "El cliente solicita un nuevo código de WiFi.",
      categoria: "sistemas",
      estado: "abierto",
      urgencia: "media",
      cliente_nombre: nombre,
      cliente_email: user.email,
      centro,
    });

    if (error) {
      setMensaje("No se pudo enviar la solicitud. Intenta de nuevo.");
      setEnviando(false);
      return;
    }

    await supabase.from("notificaciones").insert({
      centro,
      tipo: "nuevo_ticket",
      categoria: "sistemas",
      mensaje: `📶 ${nombre || "Un cliente"} solicitó un nuevo WiFi`,
    });

    setNotas("");
    setMostrarForm(false);
    setMensaje("✓ Tu solicitud fue enviada. Sistemas la va a revisar y generar tu WiFi.");
    setEnviando(false);
    fetchTodo();
  }

  return (
    <div className="rep-page">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">WiFi</p>
        <p className="rep-sub">{centro || "Tu centro"}</p>
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
            <p className="panel-section-label">Tus códigos de WiFi</p>
            {vouchers.length === 0 ? (
              <div className="empty-card">Todavía no tienes ningún código de WiFi generado</div>
            ) : (
              <>
                <div className="panel-tabs" style={{ borderRadius: 10, marginBottom: 4 }}>
                  <button
                    className={`panel-tab ${tabWifi === "activos" ? "active" : ""}`}
                    onClick={() => setTabWifi("activos")}
                  >
                    Activos{vouchersActivos.length > 0 ? ` (${vouchersActivos.length})` : ""}
                  </button>
                  <button
                    className={`panel-tab ${tabWifi === "vencidos" ? "active" : ""}`}
                    onClick={() => setTabWifi("vencidos")}
                  >
                    Vencidos{vouchersVencidos.length > 0 ? ` (${vouchersVencidos.length})` : ""}
                  </button>
                </div>

                {tabWifi === "activos" &&
                  (vouchersActivos.length > 0 ? (
                    vouchersActivos.map((v) => renderVoucherCard(v))
                  ) : (
                    <div className="empty-card">No tienes códigos activos</div>
                  ))}

                {tabWifi === "vencidos" &&
                  (vouchersVencidos.length > 0 ? (
                    vouchersVencidos.map((v) => renderVoucherCard(v))
                  ) : (
                    <div className="empty-card">No tienes códigos vencidos</div>
                  ))}
              </>
            )}

            <button
              className="btn-enviar"
              style={{ marginTop: 4 }}
              onClick={() => setMostrarForm((v) => !v)}
            >
              {mostrarForm ? (
                "Cancelar"
              ) : (
                <>
                  <img
                    src="/icons/wifi.png"
                    alt=""
                    style={{ width: 16, height: 16, verticalAlign: -3, marginRight: 6 }}
                  />
                  Solicitar nuevo WiFi
                </>
              )}
            </button>

            {mensaje && (
              <p style={{ fontSize: 13, color: mensaje.startsWith("✓") ? "#0F6E56" : "#A32D2D", marginTop: 8 }}>
                {mensaje}
              </p>
            )}

            {mostrarForm && (
              <form className="form-card" onSubmit={enviarSolicitud} style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                  Sistemas va a revisar tu solicitud y generarte un nuevo código.
                </p>
                <textarea
                  placeholder="Cuéntanos para qué lo necesitas (opcional)"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                />
                <button className="btn-enviar" type="submit" disabled={enviando}>
                  {enviando ? "Enviando..." : "Enviar solicitud"}
                </button>
              </form>
            )}

            {solicitudes.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 20 }}>
                  Tus solicitudes
                </p>
                {solicitudes.map((s) => (
                  <div className="ticket-card" key={s.id}>
                    <div className="ticket-top">
                      <div className="ticket-icono">
                        <img src="/icons/wifi.png" alt="" className="icon-img-20" />
                      </div>
                      <div className="ticket-info">
                        <p className="ticket-folio">{s.folio}</p>
                        <p className="ticket-asunto">{s.descripcion}</p>
                        <p className="ticket-categoria">
                          {new Date(s.created_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                      <span
                        className="estado-badge"
                        style={{ background: badgeInfo(s).bg, color: badgeInfo(s).color, flexShrink: 0 }}
                      >
                        {badgeInfo(s).texto}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
