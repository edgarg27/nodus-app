"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MapaConPines from "./MapaConPines";

// Operaciones necesita moverse entre todos los centros para poder subir el
// layout de cada uno (es quien registra los planos), igual que ya puede
// hacerlo en Panel de Centro con gastos/proveedores.
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "operaciones"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Mapa = {
  imagen_url: string | null;
  dwg_url: string | null;
};

export default function MapaOficinasPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [mapa, setMapa] = useState<Mapa | null>(null);

  // Solo operaciones puede subir/reemplazar layouts — el resto (admins de
  // centro, sistemas, cobranza, etc.) únicamente los puede ver y descargar.
  const puedeSubir = rol === "operaciones";

  const [mostrarForm, setMostrarForm] = useState(false);
  const [archivoImagen, setArchivoImagen] = useState<File | null>(null);
  const [archivoDwg, setArchivoDwg] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

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
    setRol(profile?.rol || "");
    if (ROLES_GLOBALES.includes(profile?.rol || "")) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      const c = profile?.centro || CENTROS_SUGERIDOS[0];
      setCentro(c);
      await fetchMapa(c);
    } else {
      const c = profile?.centro || null;
      setCentro(c);
      if (c) await fetchMapa(c);
    }
    setLoading(false);
  }

  async function fetchMapa(c: string) {
    const { data } = await supabase.from("mapa_oficinas").select("imagen_url, dwg_url").eq("centro", c).maybeSingle();
    setMapa(data || null);
  }

  async function cambiarCentro(c: string) {
    setCentro(c);
    setLoading(true);
    await fetchMapa(c);
    setLoading(false);
  }

  async function guardarMapa(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!puedeSubir) return;
    if (!centro) return;
    if (!archivoImagen && !archivoDwg) {
      setError("Sube al menos una imagen o un archivo DWG");
      return;
    }
    setGuardando(true);

    let imagenUrl = mapa?.imagen_url || null;
    let dwgUrl = mapa?.dwg_url || null;

    if (archivoImagen) {
      const nombre = `${centro}-${Date.now()}.${archivoImagen.name.split(".").pop() || "png"}`;
      const { error: upErr } = await supabase.storage
        .from("mapa-oficinas")
        .upload(nombre, archivoImagen, { contentType: archivoImagen.type, upsert: true });
      if (upErr) {
        setError("No se pudo subir la imagen: " + upErr.message);
        setGuardando(false);
        return;
      }
      imagenUrl = supabase.storage.from("mapa-oficinas").getPublicUrl(nombre).data.publicUrl;
    }

    if (archivoDwg) {
      const nombre = `${centro}-${Date.now()}.dwg`;
      const { error: upErr } = await supabase.storage
        .from("mapa-oficinas")
        .upload(nombre, archivoDwg, { contentType: "application/octet-stream", upsert: true });
      if (upErr) {
        setError("No se pudo subir el DWG: " + upErr.message);
        setGuardando(false);
        return;
      }
      dwgUrl = supabase.storage.from("mapa-oficinas").getPublicUrl(nombre).data.publicUrl;
    }

    await supabase
      .from("mapa_oficinas")
      .upsert({ centro, imagen_url: imagenUrl, dwg_url: dwgUrl, updated_at: new Date().toISOString() }, { onConflict: "centro" });

    setArchivoImagen(null);
    setArchivoDwg(null);
    setMostrarForm(false);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchMapa(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Mapa de Oficinas</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => cambiarCentro(e.target.value)}>
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
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
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : (
          <>
            {mapa?.imagen_url || mapa?.dwg_url ? (
              <div className="mapa-imagen-wrap">
                {mapa.imagen_url && centro && (
                  <MapaConPines centro={centro} imagenUrl={mapa.imagen_url} puedeEditar={puedeSubir} />
                )}
                <div className="mapa-descargas">
                  {mapa.imagen_url && (
                    <a className="ver-pdf-btn" href={mapa.imagen_url} target="_blank" download>
                      📥 Descargar imagen
                    </a>
                  )}
                  {mapa.dwg_url && (
                    <a className="ver-pdf-btn" href={mapa.dwg_url} download>
                      📐 Descargar DWG (AutoCAD)
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-card">Sin layout registrado para {centro}</div>
            )}

            {puedeSubir && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarForm((v) => !v)}
                >
                  {mostrarForm ? "Cancelar" : mapa?.imagen_url ? "✎ Reemplazar" : "+ Subir layout"}
                </button>
              </div>
            )}

            {puedeSubir && mostrarForm && (
              <form className="form-card" onSubmit={guardarMapa}>
                <p className="sub-label">Imagen del layout (PNG/JPG)</p>
                <input type="file" accept="image/*" onChange={(e) => setArchivoImagen(e.target.files?.[0] || null)} />
                <p className="sub-label">Archivo DWG (AutoCAD)</p>
                <input type="file" accept=".dwg" onChange={(e) => setArchivoDwg(e.target.files?.[0] || null)} />
                {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
                <button
                  className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
                  type="submit"
                  disabled={guardando}
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
                  <span className="btn-enviar-check-wrapper">
                    <svg
                      className="btn-enviar-check"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>¡Listo!</span>
                  </span>
                  <span className="btn-enviar-text">Guardar layout</span>
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
