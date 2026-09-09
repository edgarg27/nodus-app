"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string;
  cliente_nombre: string | null;
  empresa: string | null;
  centro: string | null;
  tipo: string;
  mensaje: string;
  fotos_urls: string[] | null;
  estado: string;
  respuesta: string | null;
  created_at: string;
};

const ESTADOS = [
  { id: "pendiente", label: "📋 Pendiente", bg: "#E6F1FB" },
  { id: "en_revision", label: "⏳ En revisión", bg: "#FAEEDA" },
  { id: "resuelta", label: "✓ Resuelta", bg: "#E1F5EE" },
];

export default function AtencionClientePage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"pendientes" | "todas">("pendientes");
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [respuestaTexto, setRespuestaTexto] = useState("");
  const [nuevoEstado, setNuevoEstado] = useState("en_revision");
  const [guardando, setGuardando] = useState(false);
  const [lightboxFotos, setLightboxFotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const { data: perfil } = await supabase.from("profiles").select("rol, nombre").eq("id", user.id).single();
    setMiRol(perfil?.rol || "");
    setMiNombre(perfil?.nombre || "");

    const { data } = await supabase
      .from("quejas_sugerencias")
      .select("*")
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  function abrirResponder(it: Item) {
    if (abiertoId === it.id) {
      setAbiertoId(null);
      return;
    }
    setAbiertoId(it.id);
    setRespuestaTexto(it.respuesta || "");
    setNuevoEstado(it.estado === "pendiente" ? "en_revision" : it.estado);
  }

  async function guardarRespuesta(it: Item) {
    setGuardando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("quejas_sugerencias")
      .update({
        respuesta: respuestaTexto.trim() || null,
        estado: nuevoEstado,
        atendido_por: user?.id,
        atendido_por_nombre: miNombre,
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.id);

    setGuardando(false);
    if (error) {
      alert("No se pudo guardar: " + error.message);
      return;
    }
    setAbiertoId(null);
    fetchTodo();
  }

  const sinPermiso = !loading && miRol !== "atencion_cliente" && miRol !== "superadmin" && miRol !== "gerente";
  const visibles = filtro === "pendientes" ? items.filter((it) => it.estado !== "resuelta") : items;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Atención al Cliente</p>
        <p className="rep-sub">Quejas y sugerencias de todos los centros</p>
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
        ) : sinPermiso ? (
          <div className="empty-card">No tienes permiso para ver esta sección.</div>
        ) : (
          <>
            <div className="categorias-row" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className={"categoria-card" + (filtro === "pendientes" ? " active" : "")}
                onClick={() => setFiltro("pendientes")}
              >
                <span className="categoria-nombre">Pendientes</span>
              </button>
              <button
                type="button"
                className={"categoria-card" + (filtro === "todas" ? " active" : "")}
                onClick={() => setFiltro("todas")}
              >
                <span className="categoria-nombre">Todas ({items.length})</span>
              </button>
            </div>

            {visibles.length === 0 ? (
              <div className="empty-card">🎉 Sin pendientes por aquí</div>
            ) : (
              visibles.map((it) => (
                <div className="ticket-card" key={it.id}>
                  <div className="ticket-top">
                    <div className="ticket-icono">
                      <img
                        src={it.tipo === "queja" ? "/icons/queja.png" : "/icons/sugerencia.png"}
                        alt=""
                        className="icon-img-20"
                      />
                    </div>
                    <div className="ticket-info">
                      <p className="ticket-asunto">
                        {it.empresa || it.cliente_nombre || "Cliente"}
                        {it.centro ? ` · ${it.centro}` : ""}
                      </p>
                      <p className="ticket-categoria">
                        {it.tipo === "queja" ? "Queja" : "Sugerencia"} ·{" "}
                        {new Date(it.created_at).toLocaleDateString("es-MX")}
                      </p>
                    </div>
                    <span
                      className="estado-badge"
                      style={{ background: ESTADOS.find((e) => e.id === it.estado)?.bg || "#E6F1FB" }}
                    >
                      {ESTADOS.find((e) => e.id === it.estado)?.label || it.estado}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: "#444", margin: "8px 0 0" }}>{it.mensaje}</p>
                  {it.fotos_urls && it.fotos_urls.length > 0 && (
                    <div className="ticket-admin-foto-grid" style={{ marginTop: 8 }}>
                      {it.fotos_urls.map((url, i) => (
                        <img
                          key={url}
                          src={url}
                          alt={`Foto ${i + 1}`}
                          className="ticket-admin-foto-mini"
                          onClick={() => {
                            setLightboxFotos(it.fotos_urls as string[]);
                            setLightboxIndex(i);
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {it.respuesta && abiertoId !== it.id && (
                    <p
                      style={{
                        fontSize: 12,
                        color: "#185FA5",
                        background: "#E6F1FB",
                        borderRadius: 8,
                        padding: "6px 10px",
                        margin: "8px 0 0",
                      }}
                    >
                      💬 {it.respuesta} {it.atendido_por_nombre ? `— ${it.atendido_por_nombre}` : ""}
                    </p>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      className="tel-borrar-btn"
                      style={{ color: "#0d1b3e", fontWeight: 600 }}
                      onClick={() => abrirResponder(it)}
                    >
                      {abiertoId === it.id ? "Cancelar" : it.respuesta ? "✎ Editar respuesta" : "💬 Responder"}
                    </button>
                  </div>

                  {abiertoId === it.id && (
                    <div className="form-card" style={{ marginTop: 8 }}>
                      <select value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)}>
                        {ESTADOS.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        placeholder="Escribe tu respuesta para el cliente..."
                        value={respuestaTexto}
                        onChange={(e) => setRespuestaTexto(e.target.value)}
                      />
                      <button
                        className={"btn-enviar" + (guardando ? " sending" : "")}
                        type="button"
                        disabled={guardando}
                        onClick={() => guardarRespuesta(it)}
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
                        <span className="btn-enviar-text">Guardar</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>

      {lightboxIndex !== null && lightboxFotos[lightboxIndex] && (
        <div className="lightbox-overlay" onClick={() => setLightboxIndex(null)}>
          <img src={lightboxFotos[lightboxIndex]} className="lightbox-img" alt="Foto ampliada" />
          {lightboxFotos.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav-btn lightbox-nav-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i === null ? i : (i - 1 + lightboxFotos.length) % lightboxFotos.length));
                }}
                aria-label="Foto anterior"
              >
                ‹
              </button>
              <button
                type="button"
                className="lightbox-nav-btn lightbox-nav-next"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i === null ? i : (i + 1) % lightboxFotos.length));
                }}
                aria-label="Foto siguiente"
              >
                ›
              </button>
              <span className="lightbox-counter">
                {lightboxIndex + 1} / {lightboxFotos.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
