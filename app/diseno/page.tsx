"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";

type Logro = {
  id: string;
  cliente_nombre: string | null;
  empresa: string | null;
  centro: string | null;
  titulo: string;
  descripcion: string | null;
  estado: string;
  banner_url: string | null;
  created_at: string;
};

const ESTADOS = [
  { id: "pendiente", label: "📋 Pendiente", bg: "#E6F1FB" },
  { id: "en_diseno", label: "🎨 En diseño", bg: "#FAEEDA" },
  { id: "publicado", label: "🎉 Publicado", bg: "#E1F5EE" },
];

export default function DisenoPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [logros, setLogros] = useState<Logro[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"pendientes" | "todos">("pendientes");
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [nuevoEstado, setNuevoEstado] = useState("en_diseno");
  const [banner, setBanner] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);

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

    const { data } = await supabase.from("logros").select("*").order("created_at", { ascending: false });
    setLogros(data || []);
    setLoading(false);
  }

  function abrirTrabajar(l: Logro) {
    if (abiertoId === l.id) {
      setAbiertoId(null);
      return;
    }
    setAbiertoId(l.id);
    setNuevoEstado(l.estado === "pendiente" ? "en_diseno" : l.estado);
    setBanner([]);
  }

  async function guardarBanner(l: Logro) {
    setGuardando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let bannerUrl = l.banner_url;
    if (banner[0]) {
      const fileName = `logro-${l.id}-${Date.now()}.${banner[0].name.split(".").pop() || "jpg"}`;
      const { error: uploadError } = await supabase.storage
        .from("logros")
        .upload(fileName, banner[0], { contentType: banner[0].type, upsert: true });
      if (uploadError) {
        alert("No se pudo subir el banner: " + uploadError.message);
        setGuardando(false);
        return;
      }
      bannerUrl = supabase.storage.from("logros").getPublicUrl(fileName).data.publicUrl;
    }

    if (nuevoEstado === "publicado" && !bannerUrl) {
      alert("Sube un banner antes de marcarlo como publicado");
      setGuardando(false);
      return;
    }

    const { error } = await supabase
      .from("logros")
      .update({
        banner_url: bannerUrl,
        estado: nuevoEstado,
        trabajado_por: user?.id,
        trabajado_por_nombre: miNombre,
        updated_at: new Date().toISOString(),
      })
      .eq("id", l.id);

    setGuardando(false);
    if (error) {
      alert("No se pudo guardar: " + error.message);
      return;
    }
    setAbiertoId(null);
    fetchTodo();
  }

  const sinPermiso = !loading && miRol !== "diseno" && miRol !== "superadmin" && miRol !== "gerente";
  const visibles = filtro === "pendientes" ? logros.filter((l) => l.estado !== "publicado") : logros;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Logros</p>
        <p className="rep-sub">Banners de logros de todos los centros</p>
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
                <span className="categoria-nombre">Por trabajar</span>
              </button>
              <button
                type="button"
                className={"categoria-card" + (filtro === "todos" ? " active" : "")}
                onClick={() => setFiltro("todos")}
              >
                <span className="categoria-nombre">Todos ({logros.length})</span>
              </button>
            </div>

            {visibles.length === 0 ? (
              <div className="empty-card">🎉 Sin logros pendientes por trabajar</div>
            ) : (
              visibles.map((l) => (
                <div className="item-card" key={l.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="item-card-info">
                      <p className="item-card-titulo">🏆 {l.titulo}</p>
                      <p className="item-card-sub">
                        {l.empresa || l.cliente_nombre || "Cliente"}
                        {l.centro ? ` · ${l.centro}` : ""}
                      </p>
                      {l.descripcion && <p className="item-card-extra">{l.descripcion}</p>}
                    </div>
                    <span
                      className="estado-badge"
                      style={{ background: ESTADOS.find((e) => e.id === l.estado)?.bg || "#E6F1FB" }}
                    >
                      {ESTADOS.find((e) => e.id === l.estado)?.label || l.estado}
                    </span>
                  </div>

                  {l.banner_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.banner_url}
                      alt={l.titulo}
                      style={{ width: "100%", maxWidth: 320, borderRadius: 10, marginTop: 8 }}
                    />
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      className="tel-borrar-btn"
                      style={{ color: "#0d1b3e", fontWeight: 600 }}
                      onClick={() => abrirTrabajar(l)}
                    >
                      {abiertoId === l.id ? "Cancelar" : l.banner_url ? "✎ Reemplazar banner" : "🎨 Trabajar banner"}
                    </button>
                  </div>

                  {abiertoId === l.id && (
                    <div className="form-card" style={{ marginTop: 4 }}>
                      <p className="sub-label">Banner (imagen)</p>
                      <FileDropzone files={banner} onChange={setBanner} maxFiles={1} accept="image/*" />
                      <select value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)}>
                        {ESTADOS.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className={"btn-enviar" + (guardando ? " sending" : "")}
                        type="button"
                        disabled={guardando}
                        onClick={() => guardarBanner(l)}
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
    </div>
  );
}
