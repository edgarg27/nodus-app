"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

type Cotizacion = {
  id: string;
  nombre: string;
  notas: string | null;
  archivo_url: string | null;
  created_at: string;
};

export default function CotizacionesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [centro, setCentro] = useState<string | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState("");
  const [notas, setNotas] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
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
    const c = profile?.centro || null;
    setCentro(c);
    if (c) await fetchCotizaciones(c, profile?.rol || "");
    setLoading(false);
  }

  async function fetchCotizaciones(c: string, rol: string) {
    let query = supabase.from("cotizaciones").select("*").order("created_at", { ascending: false });
    if (!ROLES_GLOBALES.includes(rol)) query = query.eq("centro", c);
    const { data } = await query;
    setCotizaciones(data || []);
  }

  async function guardarCotizacion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!centro || !nombre.trim()) {
      setError("Ponle un nombre a la cotización");
      return;
    }
    setGuardando(true);

    let archivoUrl: string | null = null;
    if (archivo) {
      const fileName = `${centro}-${Date.now()}.${archivo.name.split(".").pop() || "pdf"}`;
      const { error: upErr } = await supabase.storage
        .from("cotizaciones")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (upErr) {
        setError("No se pudo subir el archivo: " + upErr.message);
        setGuardando(false);
        return;
      }
      archivoUrl = supabase.storage.from("cotizaciones").getPublicUrl(fileName).data.publicUrl;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("cotizaciones").insert({
      centro,
      nombre,
      notas: notas || null,
      archivo_url: archivoUrl,
      registrado_por: user?.id,
    });

    setNombre("");
    setNotas("");
    setArchivo(null);
    setMostrarForm(false);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchCotizaciones(centro, "");
  }

  async function borrarCotizacion(id: string) {
    if (!confirm("¿Borrar esta cotización?")) return;
    await supabase.from("cotizaciones").delete().eq("id", id);
    if (centro) fetchCotizaciones(centro, "");
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Cotizaciones</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Cotizaciones ({cotizaciones.length})
              </p>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => setMostrarForm((v) => !v)}
              >
                {mostrarForm ? "Cancelar" : "+ Subir cotización"}
              </button>
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={guardarCotizacion}>
                <input
                  type="text"
                  placeholder="Nombre de la cotización (ej. Cableado piso 8)"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Notas (opcional)"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                />
                <p className="sub-label">Archivo (PDF, imagen, Excel, etc.)</p>
                <input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
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
                  <span className="btn-enviar-text">Guardar cotización</span>
                </button>
              </form>
            )}

            {cotizaciones.length === 0 ? (
              <div className="empty-card">Sin cotizaciones registradas</div>
            ) : (
              cotizaciones.map((c) => (
                <div className="cotizacion-card" key={c.id}>
                  <div>
                    <p className="item-card-titulo">{c.nombre}</p>
                    <p className="item-card-sub">
                      {new Date(c.created_at).toLocaleDateString("es-MX")}
                      {c.notas ? ` · ${c.notas}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {c.archivo_url && (
                      <a className="ver-pdf-btn" href={c.archivo_url} target="_blank" download>
                        📥 Descargar
                      </a>
                    )}
                    <button className="tel-borrar-btn" onClick={() => borrarCotizacion(c.id)}>
                      🗑
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
