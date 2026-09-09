"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Cliente = { id: string; nombre: string; email: string; empresa: string | null; numero_oficina: string | null };

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

export default function CorreosPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");

  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    setMiRol(profile?.rol || "");
    setCentro(profile?.centro || null);

    let query = supabase
      .from("profiles")
      .select("id, nombre, email, empresa, numero_oficina")
      .eq("rol", "cliente")
      .eq("activo", true)
      .order("nombre");
    if (!ROLES_GLOBALES.includes(profile?.rol || "") && profile?.centro) {
      query = query.eq("centro", profile.centro);
    }
    const { data } = await query;
    setClientes(data || []);
    setLoading(false);
  }

  const clientesFiltrados = useMemo(() => {
    if (!busqueda.trim()) return clientes;
    const q = busqueda.toLowerCase();
    return clientes.filter(
      (c) => c.nombre?.toLowerCase().includes(q) || c.empresa?.toLowerCase().includes(q)
    );
  }, [busqueda, clientes]);

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function seleccionarTodos() {
    if (seleccionados.size === clientesFiltrados.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(clientesFiltrados.map((c) => c.id)));
    }
  }

  async function enviarComunicado() {
    setError("");
    if (seleccionados.size === 0) {
      setError("Selecciona al menos un destinatario");
      return;
    }
    if (!asunto.trim() || !cuerpo.trim()) {
      setError("Falta el asunto o el contenido del correo");
      return;
    }
    if (!confirm(`¿Enviar este correo a ${seleccionados.size} cliente(s)?`)) return;

    setEnviando(true);
    const destinatarios = clientes.filter((c) => seleccionados.has(c.id)).map((c) => c.email);
    const cuerpoHtml = cuerpo.split("\n").map((linea) => `<p>${linea}</p>`).join("");

    try {
      const { error: fnError } = await supabase.functions.invoke("send-email", {
        body: { tipo: "comunicado", destinatarios, asunto, cuerpo: cuerpoHtml },
      });
      if (fnError) throw fnError;
      setEnviado(true);
    } catch {
      setError("No se pudo enviar el correo. Intenta de nuevo.");
    }
    setEnviando(false);
  }

  if (enviado) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Correo enviado</p>
        </div>
        <div className="sub-content">
          <div className="cli-al-corriente">
            <p className="cli-al-corriente-icon">✅</p>
            <p className="cli-al-corriente-text">Comunicado enviado</p>
            <p className="cli-al-corriente-sub">Se mandó a {seleccionados.size} cliente(s).</p>
          </div>
          <button
            className="reservar-btn"
            onClick={() => {
              setEnviado(false);
              setAsunto("");
              setCuerpo("");
              setSeleccionados(new Set());
            }}
          >
            Enviar otro comunicado
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Correos masivos</p>
        <p className="rep-sub">
          {esGlobal ? "Envía comunicados a clientes de cualquier centro" : `Clientes de ${centro || "tu centro"}`}
        </p>
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
            <p className="panel-section-label">Redactar comunicado</p>
            <div className="form-card">
              <input
                type="text"
                placeholder="Asunto del correo"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
              />
              <textarea
                placeholder="Escribe el mensaje... (cada línea se convierte en un párrafo)"
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                style={{ minHeight: 160 }}
              />
            </div>

            {(asunto || cuerpo) && (
              <div className="correo-preview">
                <p className="correo-preview-asunto">{asunto || "(sin asunto)"}</p>
                {cuerpo.split("\n").map((linea, i) => (
                  <p key={i} style={{ fontSize: 13, color: "#333", margin: "4px 0" }}>
                    {linea}
                  </p>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Destinatarios ({seleccionados.size} de {clientesFiltrados.length} seleccionados)
              </p>
              <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={seleccionarTodos}>
                {seleccionados.size === clientesFiltrados.length ? "Deseleccionar todos" : "Seleccionar todos"}
              </button>
            </div>

            <input
              type="text"
              placeholder="Buscar por nombre o empresa..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            />

            {clientesFiltrados.length === 0 ? (
              <div className="empty-card">Sin clientes que coincidan</div>
            ) : (
              clientesFiltrados.map((c) => (
                <div
                  key={c.id}
                  className={"destinatario-chip" + (seleccionados.has(c.id) ? " seleccionado" : "")}
                  onClick={() => toggleSeleccionado(c.id)}
                >
                  <span className="destinatario-check">{seleccionados.has(c.id) ? "✓" : ""}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>
                      {c.nombre} {c.empresa ? `· ${c.empresa}` : ""}
                    </p>
                    <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                      {c.email} {c.numero_oficina ? `· Oficina ${c.numero_oficina}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={enviarComunicado} disabled={enviando}>
              {enviando ? "Enviando..." : `📧 Enviar a ${seleccionados.size} cliente(s)`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
