"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CENTROS, useCentroAdmin } from "@/lib/useCentroAdmin";
import FileDropzone from "@/app/soporte/FileDropzone";
import AvisoExito from "@/app/components/AvisoExito";

const FESTIVIDADES_SUGERIDAS = [
  "Año Nuevo",
  "Día de Reyes",
  "San Valentín",
  "Día de la Mujer",
  "Semana Santa",
  "Día del Niño",
  "Día de la Madre",
  "Día del Padre",
  "Fiestas Patrias",
  "Halloween",
  "Día de Muertos",
  "Buen Fin",
  "Navidad",
];

const BUCKET = "decoraciones";

type Decoracion = {
  id: string;
  centro: string;
  festividad: string;
  fecha_colocacion: string | null;
  fecha_retiro: string | null;
  descripcion: string | null;
  fotos_urls: string[];
  creado_por_nombre: string | null;
  created_at: string;
};

const FORM_VACIO = { festividad: "", fecha_colocacion: "", fecha_retiro: "", descripcion: "" };

// De una URL pública de Storage saca la ruta del archivo dentro del bucket
// (para poder borrarlo cuando se quita una foto).
function rutaDesdeUrl(url: string) {
  const marca = `/${BUCKET}/`;
  const i = url.indexOf(marca);
  return i >= 0 ? decodeURIComponent(url.slice(i + marca.length).split("?")[0]) : null;
}

function fechaCorta(f: string | null) {
  if (!f) return "—";
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y}`;
}

export default function DecoracionesPage() {
  const supabase = createClient();
  const { cargando, nombre, userId, centro, setCentro, esGlobal, permitido } = useCentroAdmin();
  const [decoraciones, setDecoraciones] = useState<Decoracion[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [fotosNuevas, setFotosNuevas] = useState<File[]>([]);
  const [fotosExistentes, setFotosExistentes] = useState<string[]>([]);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ titulo: string; mensaje: string } | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  useEffect(() => {
    if (centro && permitido) fetchDecoraciones(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, permitido]);

  async function fetchDecoraciones(c: string) {
    setCargandoLista(true);
    const { data } = await supabase
      .from("decoraciones")
      .select("*")
      .eq("centro", c)
      .order("fecha_colocacion", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setDecoraciones((data as Decoracion[]) || []);
    setCargandoLista(false);
  }

  function limpiarForm() {
    setForm(FORM_VACIO);
    setFotosNuevas([]);
    setFotosExistentes([]);
    setEditandoId(null);
    setError("");
  }

  function empezarEdicion(d: Decoracion) {
    setEditandoId(d.id);
    setForm({
      festividad: d.festividad,
      fecha_colocacion: d.fecha_colocacion || "",
      fecha_retiro: d.fecha_retiro || "",
      descripcion: d.descripcion || "",
    });
    setFotosExistentes(d.fotos_urls || []);
    setFotosNuevas([]);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function subirFotos(): Promise<string[] | null> {
    const urls: string[] = [];
    for (const archivo of fotosNuevas) {
      const ext = archivo.name.split(".").pop() || "jpg";
      const ruta = `${centro}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type });
      if (upErr) {
        setError("No se pudo subir una foto: " + upErr.message);
        return null;
      }
      urls.push(supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl);
    }
    return urls;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!centro) return;
    if (!form.festividad.trim()) {
      setError("Escribe o elige la festividad");
      return;
    }
    if (form.fecha_colocacion && form.fecha_retiro && form.fecha_retiro < form.fecha_colocacion) {
      setError("La fecha de retiro no puede ser antes que la de colocación");
      return;
    }
    setGuardando(true);

    const subidas = await subirFotos();
    if (subidas === null) {
      setGuardando(false);
      return;
    }
    const fotos = [...fotosExistentes, ...subidas];

    const datos = {
      festividad: form.festividad.trim(),
      fecha_colocacion: form.fecha_colocacion || null,
      fecha_retiro: form.fecha_retiro || null,
      descripcion: form.descripcion.trim() || null,
      fotos_urls: fotos,
    };

    if (editandoId) {
      const original = decoraciones.find((d) => d.id === editandoId);
      const { error: updErr } = await supabase
        .from("decoraciones")
        .update({ ...datos, updated_at: new Date().toISOString() })
        .eq("id", editandoId);
      if (updErr) {
        setError("No se pudo guardar: " + updErr.message);
        setGuardando(false);
        return;
      }
      // Fotos que se quitaron al editar — se borran también de Storage.
      const quitadas = (original?.fotos_urls || []).filter((u) => !fotosExistentes.includes(u));
      const rutas = quitadas.map(rutaDesdeUrl).filter((r): r is string => !!r);
      if (rutas.length > 0) await supabase.storage.from(BUCKET).remove(rutas);
      setAviso({ titulo: "¡Se guardó con éxito!", mensaje: `La decoración "${datos.festividad}" se actualizó.` });
    } else {
      const { error: insErr } = await supabase
        .from("decoraciones")
        .insert({ ...datos, centro, creado_por: userId, creado_por_nombre: nombre });
      if (insErr) {
        setError("No se pudo guardar: " + insErr.message);
        setGuardando(false);
        return;
      }
      setAviso({ titulo: "¡Se agregó con éxito!", mensaje: `La decoración "${datos.festividad}" se registró en ${centro}.` });
    }

    setGuardando(false);
    limpiarForm();
    fetchDecoraciones(centro);
  }

  async function borrar(d: Decoracion) {
    if (!window.confirm(`¿Eliminar la decoración "${d.festividad}"? Esta acción no se puede deshacer.`)) return;
    setBorrandoId(d.id);
    const { error: delErr } = await supabase.from("decoraciones").delete().eq("id", d.id);
    if (delErr) {
      setError("No se pudo eliminar: " + delErr.message);
      setBorrandoId(null);
      return;
    }
    const rutas = (d.fotos_urls || []).map(rutaDesdeUrl).filter((r): r is string => !!r);
    if (rutas.length > 0) await supabase.storage.from(BUCKET).remove(rutas);
    if (editandoId === d.id) limpiarForm();
    setBorrandoId(null);
    if (centro) fetchDecoraciones(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Decoraciones y festividades</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {CENTROS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content">
        {cargando ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : !permitido ? (
          <div className="empty-card">No tienes permiso para ver este módulo</div>
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : (
          <>
            <p className="panel-section-label">{editandoId ? "Editar decoración" : "Registrar decoración"}</p>
            <form className="form-card" onSubmit={guardar}>
              <p className="sub-label">Festividad</p>
              <input
                type="text"
                list="festividades-sugeridas"
                placeholder="Ej. Día de Muertos"
                value={form.festividad}
                onChange={(e) => setForm({ ...form, festividad: e.target.value })}
              />
              <datalist id="festividades-sugeridas">
                {FESTIVIDADES_SUGERIDAS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>

              <div className="tel-form-grid">
                <div>
                  <p className="sub-label">Fecha de colocación</p>
                  <input
                    type="date"
                    value={form.fecha_colocacion}
                    onChange={(e) => setForm({ ...form, fecha_colocacion: e.target.value })}
                  />
                </div>
                <div>
                  <p className="sub-label">Fecha de retiro</p>
                  <input
                    type="date"
                    value={form.fecha_retiro}
                    onChange={(e) => setForm({ ...form, fecha_retiro: e.target.value })}
                  />
                </div>
              </div>

              <p className="sub-label">Descripción</p>
              <textarea
                placeholder="Qué se va a colocar, dónde, materiales, notas…"
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              />

              <p className="sub-label">Fotos de referencia</p>
              {fotosExistentes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {fotosExistentes.map((u) => (
                    <div key={u} style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u}
                        alt=""
                        style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, display: "block" }}
                      />
                      <button
                        type="button"
                        aria-label="Quitar foto"
                        onClick={() => setFotosExistentes((prev) => prev.filter((x) => x !== u))}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          border: "none",
                          background: "#A32D2D",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: 12,
                          lineHeight: "22px",
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <FileDropzone files={fotosNuevas} onChange={setFotosNuevas} maxFiles={6} accept="image/*" />

              {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-enviar" type="submit" disabled={guardando} style={{ flex: 1 }}>
                  {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Registrar decoración"}
                </button>
                {editandoId && (
                  <button type="button" className="btn-rechazar" onClick={limpiarForm} disabled={guardando}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>

            <p className="panel-section-label" style={{ marginTop: 16 }}>
              🎄 Decoraciones de {centro} ({decoraciones.length})
            </p>
            {cargandoLista ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando…</p>
            ) : decoraciones.length === 0 ? (
              <div className="empty-card">Aún no hay decoraciones registradas en {centro}</div>
            ) : (
              decoraciones.map((d) => (
                <div className="item-card" key={d.id} style={{ marginBottom: 8, flexDirection: "column", alignItems: "stretch" }}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">{d.festividad}</p>
                    <p className="item-card-sub">
                      Colocación: {fechaCorta(d.fecha_colocacion)} · Retiro: {fechaCorta(d.fecha_retiro)}
                    </p>
                    {d.descripcion && (
                      <p className="item-card-extra" style={{ whiteSpace: "pre-line" }}>
                        {d.descripcion}
                      </p>
                    )}
                    {d.creado_por_nombre && <p className="item-card-extra" style={{ color: "#aaa" }}>Registró: {d.creado_por_nombre}</p>}
                  </div>
                  {d.fotos_urls?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      {d.fotos_urls.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={u}
                            alt=""
                            style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, display: "block" }}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => empezarEdicion(d)}>
                      ✏️ Editar
                    </button>
                    <button className="tel-borrar-btn" onClick={() => borrar(d)} disabled={borrandoId === d.id}>
                      {borrandoId === d.id ? "Eliminando…" : "🗑 Eliminar"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {aviso && <AvisoExito titulo={aviso.titulo} mensaje={aviso.mensaje} onCerrar={() => setAviso(null)} />}
    </div>
  );
}
