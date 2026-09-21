"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CENTROS, useCentroAdmin } from "@/lib/useCentroAdmin";
import FileDropzone from "@/app/soporte/FileDropzone";
import AvisoExito from "@/app/components/AvisoExito";

const BUCKET = "documentacion-centro";

type Carpeta = {
  id: string;
  centro: string;
  nombre: string;
  carpeta_padre_id: string | null;
  created_at: string;
};

type Archivo = {
  id: string;
  centro: string;
  carpeta_id: string | null;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  tamano_bytes: number | null;
  subido_por_nombre: string | null;
  created_at: string;
};

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function iconoArchivo(a: Archivo) {
  const mime = a.tipo_mime || "";
  const nombre = a.nombre.toLowerCase();
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf" || nombre.endsWith(".pdf")) return "📕";
  if (/\.(xls|xlsx|csv)$/.test(nombre)) return "📊";
  if (/\.(ppt|pptx)$/.test(nombre)) return "📽️";
  if (/\.(doc|docx|txt)$/.test(nombre)) return "📄";
  return "📎";
}

export default function DocumentacionCentroPage() {
  const supabase = createClient();
  const { cargando, nombre, userId, centro, setCentro, esGlobal, permitido } = useCentroAdmin();

  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [cargandoDatos, setCargandoDatos] = useState(false);
  const [carpetaActualId, setCarpetaActualId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ titulo: string; mensaje: string } | null>(null);

  // Nueva carpeta
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  const [nombreCarpeta, setNombreCarpeta] = useState("");

  // Renombrar (carpeta o archivo)
  const [renombrando, setRenombrando] = useState<{ tipo: "carpeta" | "archivo"; id: string; valor: string } | null>(null);

  // Mover archivo
  const [moviendoId, setMoviendoId] = useState<string | null>(null);

  // Subida
  const [mostrarSubida, setMostrarSubida] = useState(false);
  const [archivosNuevos, setArchivosNuevos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState<{ actual: number; total: number } | null>(null);
  const [abriendoId, setAbriendoId] = useState<string | null>(null);

  useEffect(() => {
    if (centro && permitido) {
      setCarpetaActualId(null);
      setBusqueda("");
      fetchDatos(centro);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, permitido]);

  async function fetchDatos(c: string) {
    setCargandoDatos(true);
    const [{ data: cars }, { data: arcs }] = await Promise.all([
      supabase.from("documentacion_centro_carpetas").select("*").eq("centro", c).order("nombre"),
      supabase.from("documentacion_centro_archivos").select("*").eq("centro", c).order("created_at", { ascending: false }),
    ]);
    setCarpetas((cars as Carpeta[]) || []);
    setArchivos((arcs as Archivo[]) || []);
    setCargandoDatos(false);
  }

  // ---------- Estructura de carpetas ----------
  const carpetaPorId = useMemo(() => {
    const m: Record<string, Carpeta> = {};
    carpetas.forEach((c) => (m[c.id] = c));
    return m;
  }, [carpetas]);

  // Camino desde la raíz hasta una carpeta: [Agua, 2026, Bosques…]
  function caminoDe(id: string | null): Carpeta[] {
    const camino: Carpeta[] = [];
    let actual = id ? carpetaPorId[id] : undefined;
    while (actual) {
      camino.unshift(actual);
      actual = actual.carpeta_padre_id ? carpetaPorId[actual.carpeta_padre_id] : undefined;
    }
    return camino;
  }

  function etiquetaRuta(id: string | null) {
    const c = caminoDe(id);
    return c.length === 0 ? "Inicio" : c.map((x) => x.nombre).join(" / ");
  }

  // Todo lo que cuelga de una carpeta (subcarpetas y archivos, recursivo).
  function contenidoDe(id: string) {
    const ids = new Set<string>([id]);
    let creció = true;
    while (creció) {
      creció = false;
      carpetas.forEach((c) => {
        if (c.carpeta_padre_id && ids.has(c.carpeta_padre_id) && !ids.has(c.id)) {
          ids.add(c.id);
          creció = true;
        }
      });
    }
    return {
      carpetaIds: Array.from(ids),
      archivos: archivos.filter((a) => a.carpeta_id && ids.has(a.carpeta_id)),
      subcarpetas: ids.size - 1,
    };
  }

  const camino = caminoDe(carpetaActualId);
  const hayBusqueda = busqueda.trim().length > 0;
  const q = busqueda.trim().toLowerCase();
  const carpetasVisibles = hayBusqueda
    ? carpetas.filter((c) => c.nombre.toLowerCase().includes(q))
    : carpetas.filter((c) => c.carpeta_padre_id === carpetaActualId);
  const archivosVisibles = hayBusqueda
    ? archivos.filter((a) => a.nombre.toLowerCase().includes(q))
    : archivos.filter((a) => a.carpeta_id === carpetaActualId);

  const opcionesMover = useMemo(
    () =>
      [{ id: "", etiqueta: "Inicio" }].concat(
        carpetas.map((c) => ({ id: c.id, etiqueta: etiquetaRuta(c.id) })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carpetas]
  );

  // ---------- Carpetas ----------
  async function crearCarpeta(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!centro) return;
    const nom = nombreCarpeta.trim();
    if (!nom) {
      setError("Ponle un nombre a la carpeta");
      return;
    }
    if (carpetas.some((c) => c.carpeta_padre_id === carpetaActualId && c.nombre.toLowerCase() === nom.toLowerCase())) {
      setError("Ya existe una carpeta con ese nombre aquí");
      return;
    }
    const { error: insErr } = await supabase.from("documentacion_centro_carpetas").insert({
      centro,
      nombre: nom,
      carpeta_padre_id: carpetaActualId,
      creado_por: userId,
      creado_por_nombre: nombre,
    });
    if (insErr) {
      setError("No se pudo crear la carpeta: " + insErr.message);
      return;
    }
    setNombreCarpeta("");
    setCreandoCarpeta(false);
    fetchDatos(centro);
  }

  async function borrarCarpeta(c: Carpeta) {
    const dentro = contenidoDe(c.id);
    const detalle =
      dentro.archivos.length > 0 || dentro.subcarpetas > 0
        ? ` Se borrará también todo lo que tiene dentro (${dentro.archivos.length} archivo(s) y ${dentro.subcarpetas} subcarpeta(s)).`
        : "";
    if (!window.confirm(`¿Eliminar la carpeta "${c.nombre}"?${detalle} Esta acción no se puede deshacer.`)) return;
    setError("");
    // Primero los archivos de Storage (el borrado en cascada de la base solo
    // quita los registros, no los archivos).
    const rutas = dentro.archivos.map((a) => a.archivo_path);
    if (rutas.length > 0) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(rutas);
      if (rmErr) {
        setError("No se pudieron borrar los archivos de la carpeta: " + rmErr.message);
        return;
      }
    }
    const { error: delErr } = await supabase.from("documentacion_centro_carpetas").delete().eq("id", c.id);
    if (delErr) {
      setError("No se pudo eliminar la carpeta: " + delErr.message);
      return;
    }
    if (centro) fetchDatos(centro);
  }

  // ---------- Renombrar ----------
  async function confirmarRenombre() {
    if (!renombrando || !centro) return;
    const valor = renombrando.valor.trim();
    if (!valor) {
      setError("El nombre no puede quedar vacío");
      return;
    }
    setError("");
    if (renombrando.tipo === "carpeta") {
      const c = carpetaPorId[renombrando.id];
      if (
        carpetas.some(
          (x) => x.id !== c.id && x.carpeta_padre_id === c.carpeta_padre_id && x.nombre.toLowerCase() === valor.toLowerCase()
        )
      ) {
        setError("Ya existe una carpeta con ese nombre aquí");
        return;
      }
    }
    const tabla = renombrando.tipo === "carpeta" ? "documentacion_centro_carpetas" : "documentacion_centro_archivos";
    const { error: updErr } = await supabase.from(tabla).update({ nombre: valor }).eq("id", renombrando.id);
    if (updErr) {
      setError("No se pudo renombrar: " + updErr.message);
      return;
    }
    setRenombrando(null);
    fetchDatos(centro);
  }

  // ---------- Archivos ----------
  async function subirArchivos() {
    setError("");
    if (!centro || archivosNuevos.length === 0) return;
    const total = archivosNuevos.length;
    let subidos = 0;
    const fallidos: string[] = [];

    for (let i = 0; i < total; i++) {
      const archivo = archivosNuevos[i];
      setSubiendo({ actual: i + 1, total });
      const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "bin";
      const ruta = `${centro}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type });
      if (upErr) {
        fallidos.push(archivo.name);
        continue;
      }
      const { error: insErr } = await supabase.from("documentacion_centro_archivos").insert({
        centro,
        carpeta_id: carpetaActualId,
        nombre: archivo.name,
        archivo_path: ruta,
        tipo_mime: archivo.type || null,
        tamano_bytes: archivo.size,
        subido_por: userId,
        subido_por_nombre: nombre,
      });
      if (insErr) {
        // Que no se quede un archivo huérfano en Storage si falló el registro.
        await supabase.storage.from(BUCKET).remove([ruta]);
        fallidos.push(archivo.name);
        continue;
      }
      subidos++;
    }

    setSubiendo(null);
    setArchivosNuevos([]);
    setMostrarSubida(false);
    if (fallidos.length > 0) setError(`No se pudieron subir: ${fallidos.join(", ")}`);
    if (subidos > 0) {
      setAviso({
        titulo: "¡Se agregó con éxito!",
        mensaje: `${subidos} archivo${subidos === 1 ? "" : "s"} subido${subidos === 1 ? "" : "s"} a ${etiquetaRuta(carpetaActualId)}.`,
      });
    }
    fetchDatos(centro);
  }

  // El bucket es privado — se abre con un link firmado que caduca.
  async function abrirArchivo(a: Archivo) {
    setAbriendoId(a.id);
    setError("");
    const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(a.archivo_path, 300);
    setAbriendoId(null);
    if (signErr || !data?.signedUrl) {
      setError("No se pudo abrir el archivo: " + (signErr?.message || "intenta de nuevo"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function moverArchivo(a: Archivo, destino: string) {
    setError("");
    const nuevaCarpeta = destino || null;
    if (nuevaCarpeta === a.carpeta_id) {
      setMoviendoId(null);
      return;
    }
    const { error: updErr } = await supabase.from("documentacion_centro_archivos").update({ carpeta_id: nuevaCarpeta }).eq("id", a.id);
    if (updErr) {
      setError("No se pudo mover: " + updErr.message);
      return;
    }
    setMoviendoId(null);
    if (centro) fetchDatos(centro);
  }

  async function borrarArchivo(a: Archivo) {
    if (!window.confirm(`¿Eliminar el archivo "${a.nombre}"? Esta acción no se puede deshacer.`)) return;
    setError("");
    const { error: delErr } = await supabase.from("documentacion_centro_archivos").delete().eq("id", a.id);
    if (delErr) {
      setError("No se pudo eliminar: " + delErr.message);
      return;
    }
    await supabase.storage.from(BUCKET).remove([a.archivo_path]);
    if (centro) fetchDatos(centro);
  }

  const vacio = carpetasVisibles.length === 0 && archivosVisibles.length === 0;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Documentación del centro</p>
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
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 10px" }}>
              Sube aquí los documentos de {centro}: comprobante de domicilio, agua, luz, contratos y cualquier archivo de la
              documentación de Nodus. Organízalos en carpetas.
            </p>

            {/* Buscador */}
            <input
              type="text"
              placeholder="🔍 Buscar carpetas o archivos"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                width: "100%",
                boxSizing: "border-box",
                background: "#fff",
                marginBottom: 10,
              }}
            />

            {/* Ruta (breadcrumb) */}
            {!hayBusqueda && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 10, fontSize: 13 }}>
                <button
                  type="button"
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: carpetaActualId ? 600 : 800, padding: 0 }}
                  onClick={() => setCarpetaActualId(null)}
                >
                  🗂️ Inicio
                </button>
                {camino.map((c, i) => (
                  <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "#aaa" }}>›</span>
                    <button
                      type="button"
                      className="tel-borrar-btn"
                      style={{ color: "#0d1b3e", fontWeight: i === camino.length - 1 ? 800 : 600, padding: 0 }}
                      onClick={() => setCarpetaActualId(c.id)}
                    >
                      {c.nombre}
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Acciones */}
            {!hayBusqueda && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-aceptar"
                  onClick={() => {
                    setMostrarSubida((v) => !v);
                    setCreandoCarpeta(false);
                    setError("");
                  }}
                >
                  ⬆️ {mostrarSubida ? "Cerrar" : "Subir archivos"}
                </button>
                <button
                  type="button"
                  className="btn-rechazar"
                  onClick={() => {
                    setCreandoCarpeta((v) => !v);
                    setMostrarSubida(false);
                    setError("");
                  }}
                  style={{ background: "#fff", color: "#0d1b3e", border: "1px solid #ddd" }}
                >
                  📁 {creandoCarpeta ? "Cancelar" : "Nueva carpeta"}
                </button>
              </div>
            )}

            {creandoCarpeta && (
              <form className="form-card" onSubmit={crearCarpeta} style={{ marginBottom: 10 }}>
                <p className="sub-label">Nombre de la carpeta (dentro de {etiquetaRuta(carpetaActualId)})</p>
                <input
                  type="text"
                  autoFocus
                  placeholder="Ej. Agua, Luz, Comprobante de domicilio"
                  value={nombreCarpeta}
                  onChange={(e) => setNombreCarpeta(e.target.value)}
                />
                <button className="btn-enviar" type="submit">
                  Crear carpeta
                </button>
              </form>
            )}

            {mostrarSubida && (
              <div className="form-card" style={{ marginBottom: 10 }}>
                <p className="sub-label">Subir a: {etiquetaRuta(carpetaActualId)}</p>
                <FileDropzone
                  files={archivosNuevos}
                  onChange={setArchivosNuevos}
                  maxFiles={15}
                  maxSizeMB={25}
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt"
                  etiquetaTipos="Fotos, PDF, Word, Excel…"
                />
                <button
                  type="button"
                  className="btn-enviar"
                  disabled={archivosNuevos.length === 0 || !!subiendo}
                  onClick={subirArchivos}
                >
                  {subiendo
                    ? `Subiendo ${subiendo.actual} de ${subiendo.total}…`
                    : `Subir ${archivosNuevos.length || ""} archivo${archivosNuevos.length === 1 ? "" : "s"}`}
                </button>
              </div>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}

            {/* Contenido */}
            {cargandoDatos ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando…</p>
            ) : vacio ? (
              <div className="empty-card">
                {hayBusqueda ? "No se encontró nada con esa búsqueda" : "Esta carpeta está vacía. Sube archivos o crea una carpeta."}
              </div>
            ) : (
              <>
                {carpetasVisibles.map((c) => {
                  const dentro = contenidoDe(c.id);
                  const enRenombre = renombrando?.tipo === "carpeta" && renombrando.id === c.id;
                  return (
                    <div className="item-card" key={c.id} style={{ marginBottom: 8, flexDirection: "column", alignItems: "stretch" }}>
                      {enRenombre ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            autoFocus
                            value={renombrando.valor}
                            onChange={(e) => setRenombrando({ ...renombrando, valor: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && confirmarRenombre()}
                            style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
                          />
                          <button className="btn-aceptar" onClick={confirmarRenombre}>
                            Guardar
                          </button>
                          <button className="btn-rechazar" onClick={() => setRenombrando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setBusqueda("");
                              setCarpetaActualId(c.id);
                            }}
                            style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0, flex: 1 }}
                          >
                            <p className="item-card-titulo" style={{ margin: 0 }}>
                              📁 {c.nombre}
                            </p>
                            <p className="item-card-extra" style={{ margin: 0, color: "#aaa" }}>
                              {dentro.archivos.length} archivo(s){dentro.subcarpetas > 0 ? ` · ${dentro.subcarpetas} subcarpeta(s)` : ""}
                              {hayBusqueda ? ` · en ${etiquetaRuta(c.carpeta_padre_id)}` : ""}
                            </p>
                          </button>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="tel-borrar-btn"
                              style={{ color: "#0d1b3e", fontWeight: 600 }}
                              onClick={() => setRenombrando({ tipo: "carpeta", id: c.id, valor: c.nombre })}
                            >
                              ✏️
                            </button>
                            <button className="tel-borrar-btn" onClick={() => borrarCarpeta(c)}>
                              🗑
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {archivosVisibles.map((a) => {
                  const enRenombre = renombrando?.tipo === "archivo" && renombrando.id === a.id;
                  return (
                    <div className="item-card" key={a.id} style={{ marginBottom: 8, flexDirection: "column", alignItems: "stretch" }}>
                      {enRenombre ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            autoFocus
                            value={renombrando.valor}
                            onChange={(e) => setRenombrando({ ...renombrando, valor: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && confirmarRenombre()}
                            style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
                          />
                          <button className="btn-aceptar" onClick={confirmarRenombre}>
                            Guardar
                          </button>
                          <button className="btn-rechazar" onClick={() => setRenombrando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="item-card-info">
                            <p className="item-card-titulo">
                              {iconoArchivo(a)} {a.nombre}
                            </p>
                            <p className="item-card-extra" style={{ color: "#aaa" }}>
                              {new Date(a.created_at).toLocaleDateString("es-MX")}
                              {a.tamano_bytes ? ` · ${formatBytes(a.tamano_bytes)}` : ""}
                              {a.subido_por_nombre ? ` · ${a.subido_por_nombre}` : ""}
                              {hayBusqueda ? ` · en ${etiquetaRuta(a.carpeta_id)}` : ""}
                            </p>
                          </div>
                          {moviendoId === a.id ? (
                            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                              <select
                                defaultValue={a.carpeta_id || ""}
                                onChange={(e) => moverArchivo(a, e.target.value)}
                                style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
                              >
                                {opcionesMover.map((o) => (
                                  <option key={o.id || "raiz"} value={o.id}>
                                    {o.etiqueta}
                                  </option>
                                ))}
                              </select>
                              <button className="btn-rechazar" onClick={() => setMoviendoId(null)}>
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                              <button
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                onClick={() => abrirArchivo(a)}
                                disabled={abriendoId === a.id}
                              >
                                {abriendoId === a.id ? "Abriendo…" : "👁️ Abrir"}
                              </button>
                              <button
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                onClick={() => setRenombrando({ tipo: "archivo", id: a.id, valor: a.nombre })}
                              >
                                ✏️ Renombrar
                              </button>
                              <button
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                onClick={() => setMoviendoId(a.id)}
                              >
                                📂 Mover
                              </button>
                              <button className="tel-borrar-btn" onClick={() => borrarArchivo(a)}>
                                🗑 Eliminar
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {aviso && <AvisoExito titulo={aviso.titulo} mensaje={aviso.mensaje} onCerrar={() => setAviso(null)} />}
    </div>
  );
}
