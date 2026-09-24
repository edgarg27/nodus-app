"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../../soporte/FileDropzone";

type Banner = {
  id: string;
  src: string;
  storage_path: string | null;
  alt: string;
  orden: number;
  activo: boolean;
};

// Banners promocionales del carrusel de arriba del dashboard del cliente
// (los mismos que también se ven en la vista previa del Panel de Diseño).
// Administrados aquí por Diseño (o superadmin/gerente) — ver
// migracion_banners_promocionales.sql para la tabla y sus políticas.
// Máximo de banners en total (activos e inactivos) para que el carrusel
// no se haga eterno.
const MAX_BANNERS = 6;

export default function BannersPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState<string | null>(null);

  // Formulario para agregar uno nuevo.
  const [nuevaImagen, setNuevaImagen] = useState<File[]>([]);
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState("");

  // Reemplazar la imagen de un banner existente.
  const [reemplazandoId, setReemplazandoId] = useState<string | null>(null);
  const [imagenReemplazo, setImagenReemplazo] = useState<File[]>([]);

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

    const { data } = await supabase.from("banners_promocionales").select("*").order("orden", { ascending: true });
    setBanners(data || []);
    setLoading(false);
  }

  async function subirImagen(file: File) {
    const fileName = `banner-${Date.now()}-${Math.round(Math.random() * 1e6)}.${file.name.split(".").pop() || "jpg"}`;
    const { error: uploadError } = await supabase.storage
      .from("banners-promocionales")
      .upload(fileName, file, { contentType: file.type });
    if (uploadError) throw uploadError;
    return {
      src: supabase.storage.from("banners-promocionales").getPublicUrl(fileName).data.publicUrl,
      path: fileName,
    };
  }

  async function agregarBanner() {
    setError("");
    if (!nuevaImagen[0]) {
      setError("Sube una imagen para el banner nuevo");
      return;
    }
    if (banners.length >= MAX_BANNERS) {
      setError(`Ya tienes ${MAX_BANNERS} banners, el máximo. Borra uno para agregar otro.`);
      return;
    }
    setAgregando(true);
    try {
      const { src, path } = await subirImagen(nuevaImagen[0]);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const siguienteOrden = banners.length > 0 ? Math.max(...banners.map((b) => b.orden)) + 1 : 0;
      const { error: insertError } = await supabase.from("banners_promocionales").insert({
        src,
        storage_path: path,
        alt: "Banner promocional",
        orden: siguienteOrden,
        activo: true,
        actualizado_por: user?.id,
        actualizado_por_nombre: miNombre,
      });
      if (insertError) throw insertError;
      setNuevaImagen([]);
      await fetchTodo();
    } catch (e: any) {
      setError("No se pudo agregar: " + (e?.message || "intenta de nuevo"));
    }
    setAgregando(false);
  }

  async function guardarCambios(b: Banner, cambios: Partial<Banner>) {
    setGuardandoId(b.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("banners_promocionales")
      .update({ ...cambios, actualizado_por: user?.id, actualizado_por_nombre: miNombre, updated_at: new Date().toISOString() })
      .eq("id", b.id);
    setGuardandoId(null);
    if (updateError) {
      alert("No se pudo guardar: " + updateError.message);
      return;
    }
    await fetchTodo();
  }

  async function reemplazarImagen(b: Banner) {
    if (!imagenReemplazo[0]) return;
    setGuardandoId(b.id);
    try {
      const { src, path } = await subirImagen(imagenReemplazo[0]);
      await guardarCambios(b, { src, storage_path: path });
      // Borra la imagen anterior del bucket, solo si era nuestra (no una
      // de las 3 semilla que viven en /public/images).
      if (b.storage_path) await supabase.storage.from("banners-promocionales").remove([b.storage_path]);
      setReemplazandoId(null);
      setImagenReemplazo([]);
    } catch (e: any) {
      alert("No se pudo reemplazar la imagen: " + (e?.message || "intenta de nuevo"));
    }
    setGuardandoId(null);
  }

  async function moverBanner(b: Banner, direccion: -1 | 1) {
    const ordenados = [...banners].sort((a, c) => a.orden - c.orden);
    const idx = ordenados.findIndex((x) => x.id === b.id);
    const vecino = ordenados[idx + direccion];
    if (!vecino) return;
    setGuardandoId(b.id);
    await Promise.all([
      supabase.from("banners_promocionales").update({ orden: vecino.orden }).eq("id", b.id),
      supabase.from("banners_promocionales").update({ orden: b.orden }).eq("id", vecino.id),
    ]);
    setGuardandoId(null);
    await fetchTodo();
  }

  async function borrarBanner(b: Banner) {
    setConfirmandoBorrarId(null);
    setGuardandoId(b.id);
    const { error: deleteError } = await supabase.from("banners_promocionales").delete().eq("id", b.id);
    if (!deleteError && b.storage_path) {
      await supabase.storage.from("banners-promocionales").remove([b.storage_path]);
    }
    setGuardandoId(null);
    if (deleteError) {
      alert("No se pudo borrar: " + deleteError.message);
      return;
    }
    await fetchTodo();
  }

  const sinPermiso = !loading && miRol !== "diseno" && miRol !== "superadmin" && miRol !== "gerente";

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Banners</p>
        <p className="rep-sub">Carrusel de arriba del dashboard del cliente</p>
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
            {banners.length === 0 ? (
              <div className="empty-card">Todavía no hay banners. Agrega el primero abajo.</div>
            ) : (
              banners.map((b, i) => (
                <div className="item-card" key={b.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.src}
                    alt={b.alt}
                    style={{ width: "100%", maxWidth: 400, borderRadius: 10, aspectRatio: "2.65 / 1", objectFit: "cover" }}
                  />

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" }}>
                      <input
                        type="checkbox"
                        checked={b.activo}
                        onChange={(e) => guardarCambios(b, { activo: e.target.checked })}
                      />
                      Activo (se muestra en el carrusel)
                    </label>

                    <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                      <button
                        type="button"
                        className="tel-borrar-btn"
                        disabled={i === 0 || guardandoId === b.id}
                        onClick={() => moverBanner(b, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="tel-borrar-btn"
                        disabled={i === banners.length - 1 || guardandoId === b.id}
                        onClick={() => moverBanner(b, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        onClick={() => {
                          setReemplazandoId(reemplazandoId === b.id ? null : b.id);
                          setImagenReemplazo([]);
                        }}
                      >
                        {reemplazandoId === b.id ? "Cancelar" : "✎ Reemplazar imagen"}
                      </button>
                      <button type="button" className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={() => setConfirmandoBorrarId(b.id)}>
                        🗑 Borrar
                      </button>
                    </div>
                  </div>

                  {reemplazandoId === b.id && (
                    <div className="form-card" style={{ marginTop: 8 }}>
                      <p className="sub-label">Nueva imagen</p>
                      <FileDropzone files={imagenReemplazo} onChange={setImagenReemplazo} maxFiles={1} accept="image/*" />
                      <button
                        className={"btn-enviar" + (guardandoId === b.id ? " sending" : "")}
                        type="button"
                        disabled={guardandoId === b.id || !imagenReemplazo[0]}
                        onClick={() => reemplazarImagen(b)}
                        style={{ marginTop: 8 }}
                      >
                        <span className="btn-enviar-text">Guardar imagen</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}

            <p className="panel-section-label" style={{ marginTop: 12 }}>
              Agregar banner ({banners.length} de {MAX_BANNERS})
            </p>
            {banners.length >= MAX_BANNERS ? (
              <div className="empty-card">
                Ya tienes {MAX_BANNERS} banners, el máximo. Para agregar otro, borra uno o reemplaza su imagen.
              </div>
            ) : (
            <div className="form-card">
              <p className="sub-label">Imagen</p>
              <FileDropzone files={nuevaImagen} onChange={setNuevaImagen} maxFiles={1} accept="image/*" />
              {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
              <button
                className={"btn-enviar" + (agregando ? " sending" : "")}
                type="button"
                disabled={agregando}
                onClick={agregarBanner}
                style={{ marginTop: 10 }}
              >
                <span className="btn-enviar-text">{agregando ? "Agregando..." : "Agregar banner"}</span>
              </button>
            </div>
            )}
          </>
        )}
      </div>

      {confirmandoBorrarId && (
        <div className="modal-overlay" onClick={() => setConfirmandoBorrarId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Borrar banner</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Borrar este banner? Ya no se verá en ningún dashboard.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoBorrarId(null)}>
                Cancelar
              </button>
              <button
                className="btn-aceptar"
                onClick={() => {
                  const b = banners.find((x) => x.id === confirmandoBorrarId);
                  if (b) borrarBanner(b);
                }}
              >
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
