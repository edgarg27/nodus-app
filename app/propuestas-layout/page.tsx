"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";
import FileDropzone from "../soporte/FileDropzone";
import ImagenPrivada from "../components/ImagenPrivada";

// Propuesta de layout. La arquitecta (rol operaciones) sube la propuesta de diseño de una
// oficina que van a rentar; la admin del centro la ve y la descarga para enseñársela al
// cliente, y deja un comentario con lo que dijo. Con eso la arquitecta decide si sube ahí
// mismo la cotización del layout. Solo Operaciones crea y edita la propuesta; admin,
// gerente y superadmin la ven, la descargan y comentan.
// Tabla, bucket y permisos: migracion_propuestas_layout.sql y
// migracion_propuestas_layout_comentarios.sql.

type Comentario = {
  id: string;
  propuesta_id: string;
  autor_nombre: string | null;
  autor_rol: string | null;
  mensaje: string;
  created_at: string;
};

type Propuesta = {
  id: string;
  centro: string;
  oficina: string | null;
  cliente: string;
  descripcion: string | null;
  estado: "propuesta" | "aprobada" | "descartada";
  layout_urls: string[];
  cotizacion_url: string | null;
  cotizacion_monto: number | null;
  creado_por_nombre: string | null;
  created_at: string;
  aprobada_at: string | null;
  cotizacion_at: string | null;
};

const BUCKET = "propuestas-layout";
// Estado que se ve: si ya tiene o no la cotización del layout.
const CON_COTIZACION = { label: "Con cotización", color: "#0F6E56", fondo: "#E3F5EC" };
const SIN_COTIZACION = { label: "Sin cotización", color: "#185FA5", fondo: "#E6F1FB" };
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ROLES_VEN_TODO = ["operaciones", "superadmin", "gerente"];

const pesos = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
const esImagen = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);

// Nombre original del archivo: va en la ruta después de "__".
function nombreArchivo(url: string) {
  const archivo = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  return archivo.includes("__") ? archivo.slice(archivo.indexOf("__") + 2) : archivo;
}

export default function PropuestasLayoutPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [miNombre, setMiNombre] = useState("");
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [comentarios, setComentarios] = useState<Record<string, Comentario[]>>({});
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [miId, setMiId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [centroSel, setCentroSel] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");

  // Modal de alta / edición
  const [editando, setEditando] = useState<Propuesta | "nueva" | null>(null);
  const [form, setForm] = useState({ centro: "", oficina: "", cliente: "", descripcion: "" });
  const [archivosLayout, setArchivosLayout] = useState<File[]>([]);
  const [layoutsActuales, setLayoutsActuales] = useState<string[]>([]);
  // Modal "le gustó": cotización del layout
  const [cotizando, setCotizando] = useState<Propuesta | null>(null);
  const [archivoCotizacion, setArchivoCotizacion] = useState<File[]>([]);
  const [montoCotizacion, setMontoCotizacion] = useState("");
  const [borrando, setBorrando] = useState<Propuesta | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState("");
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const puedeEditar = rol === "operaciones";
  const veTodos = ROLES_VEN_TODO.includes(rol);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    setLoading(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: perfil } = await supabase.from("profiles").select("rol, centro, nombre").eq("id", user.id).single();
    setRol(perfil?.rol || "");
    setMiCentro(perfil?.centro || null);
    setMiNombre(perfil?.nombre || "");
    setMiId(user.id);
    const { data, error: e } = await supabase.from("propuestas_layout").select("*").order("created_at", { ascending: false });
    if (e) setError(/propuestas_layout/i.test(e.message) ? "Falta correr la migración migracion_propuestas_layout.sql." : "No se pudieron cargar las propuestas.");
    const lista = (data as Propuesta[]) || [];
    setPropuestas(lista);
    await cargarComentarios(lista.map((p) => p.id));
    setLoading(false);
  }

  async function cargarComentarios(ids: string[]) {
    if (ids.length === 0) return setComentarios({});
    const { data } = await supabase
      .from("propuestas_layout_comentarios")
      .select("*")
      .in("propuesta_id", ids)
      .order("created_at", { ascending: true });
    const agrupados: Record<string, Comentario[]> = {};
    for (const c of (data as Comentario[]) || []) (agrupados[c.propuesta_id] ||= []).push(c);
    setComentarios(agrupados);
  }

  async function comentar(p: Propuesta) {
    const mensaje = (borradores[p.id] || "").trim();
    if (!mensaje) return;
    setEnviando(p.id);
    const { error: e } = await supabase
      .from("propuestas_layout_comentarios")
      .insert({ propuesta_id: p.id, autor_id: miId, autor_nombre: miNombre || null, autor_rol: rol, mensaje });
    setEnviando(null);
    if (e) {
      alert(/propuestas_layout_comentarios/i.test(e.message) ? "Falta correr la migración migracion_propuestas_layout_comentarios.sql." : "No se pudo enviar el comentario.");
      return;
    }
    setBorradores((b) => ({ ...b, [p.id]: "" }));
    // Comenta la admin (o gerencia): le avisa a la arquitecta. Comenta la arquitecta: le avisa a la admin del centro.
    const corto = mensaje.length > 80 ? mensaje.slice(0, 80) + "…" : mensaje;
    await supabase.from("notificaciones").insert({
      centro: p.centro,
      tipo: rol === "operaciones" ? "propuesta_layout" : "propuesta_layout_respuesta",
      mensaje: `💬 ${miNombre || "Comentario"} sobre el layout de ${p.cliente}: ${corto}`,
    });
    cargarComentarios(propuestas.map((x) => x.id));
  }

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return propuestas.filter(
      (p) =>
        (!centroSel || p.centro === centroSel) &&
        (!fEstado || (fEstado === "con" ? !!p.cotizacion_url : !p.cotizacion_url)) &&
        (!q || [p.cliente, p.oficina, p.descripcion].join(" ").toLowerCase().includes(q))
    );
  }, [propuestas, centroSel, fEstado, busqueda]);

  async function abrir(url: string, descargar = false) {
    setAbriendo(url);
    const { url: firmado, error: e } = await pedirLinkFirmado(url, { descargar, nombre: descargar ? nombreArchivo(url) : undefined });
    setAbriendo(null);
    if (!firmado) return alert("No se pudo abrir el archivo: " + (e || "intenta de nuevo"));
    window.open(firmado, "_blank");
  }

  async function subir(archivo: File, prefijo: string) {
    const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "pdf";
    const original = archivo.name
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ._-]+/g, "-")
      .trim()
      .slice(0, 80);
    const ruta = `${prefijo}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${original ? `__${original}` : ""}.${ext}`;
    const { error: e } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: true });
    if (e) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  }

  async function avisar(p: { centro: string; cliente: string; oficina: string | null }, mensaje: string) {
    await supabase.from("notificaciones").insert({ centro: p.centro, tipo: "propuesta_layout", mensaje });
  }

  // ---------- Alta / edición ----------
  function abrirNueva() {
    setForm({ centro: centroSel || miCentro || CENTROS_REPORTE[0], oficina: "", cliente: "", descripcion: "" });
    setArchivosLayout([]);
    setLayoutsActuales([]);
    setErrorModal("");
    setEditando("nueva");
  }

  function abrirEditar(p: Propuesta) {
    setForm({ centro: p.centro, oficina: p.oficina || "", cliente: p.cliente, descripcion: p.descripcion || "" });
    setArchivosLayout([]);
    setLayoutsActuales(p.layout_urls || []);
    setErrorModal("");
    setEditando(p);
  }

  async function guardarPropuesta(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    if (!form.cliente.trim()) return setErrorModal("Escribe el cliente o prospecto.");
    if (layoutsActuales.length + archivosLayout.length === 0) return setErrorModal("Sube al menos un archivo del layout.");
    setGuardando(true);
    setErrorModal("");
    const nuevos: string[] = [];
    for (const a of archivosLayout) {
      const url = await subir(a, "layout");
      if (!url) {
        setErrorModal("No se pudo subir un archivo. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
      nuevos.push(url);
    }
    const datos = {
      centro: form.centro,
      oficina: form.oficina.trim() || null,
      cliente: form.cliente.trim(),
      descripcion: form.descripcion.trim() || null,
      layout_urls: [...layoutsActuales, ...nuevos],
      updated_at: new Date().toISOString(),
    };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: e2 } =
      editando === "nueva"
        ? await supabase.from("propuestas_layout").insert({ ...datos, creado_por: user?.id, creado_por_nombre: miNombre || null })
        : await supabase.from("propuestas_layout").update(datos).eq("id", editando.id);
    if (e2) {
      setErrorModal("No se pudo guardar. Intenta de nuevo.");
      setGuardando(false);
      return;
    }
    const donde = datos.oficina ? ` (${datos.oficina})` : "";
    if (editando === "nueva") await avisar(datos, `📐 Nueva propuesta de layout para ${datos.cliente}${donde} en ${datos.centro}`);
    else if (nuevos.length > 0) await avisar(datos, `📐 Se actualizó la propuesta de layout de ${datos.cliente}${donde}`);
    setGuardando(false);
    setEditando(null);
    cargar();
  }

  // ---------- Le gustó: cotización ----------
  function abrirCotizacion(p: Propuesta) {
    setCotizando(p);
    setArchivoCotizacion([]);
    setMontoCotizacion(p.cotizacion_monto != null ? String(p.cotizacion_monto) : "");
    setErrorModal("");
  }

  async function guardarCotizacion() {
    if (!cotizando) return;
    if (!archivoCotizacion[0] && !cotizando.cotizacion_url) return setErrorModal("Sube la cotización del layout.");
    setGuardando(true);
    setErrorModal("");
    let url = cotizando.cotizacion_url;
    if (archivoCotizacion[0]) {
      url = await subir(archivoCotizacion[0], "cotizacion");
      if (!url) {
        setErrorModal("No se pudo subir la cotización. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
    }
    const ahora = new Date().toISOString();
    const { error: e } = await supabase
      .from("propuestas_layout")
      .update({
        cotizacion_url: url,
        cotizacion_monto: montoCotizacion ? Number(montoCotizacion) : null,
        cotizacion_at: ahora,
        updated_at: ahora,
      })
      .eq("id", cotizando.id);
    if (e) {
      setErrorModal("No se pudo guardar. Intenta de nuevo.");
      setGuardando(false);
      return;
    }
    await avisar(cotizando, `💰 Ya está la cotización del layout de ${cotizando.cliente}${cotizando.oficina ? ` (${cotizando.oficina})` : ""}`);
    setGuardando(false);
    setCotizando(null);
    cargar();
  }

  async function confirmarBorrar() {
    if (!borrando) return;
    const { error: e } = await supabase.from("propuestas_layout").delete().eq("id", borrando.id);
    if (e) alert("No se pudo borrar.");
    setBorrando(null);
    cargar();
  }

  const centrosSelector = Array.from(new Set([...CENTROS_REPORTE, ...propuestas.map((p) => p.centro)]));

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Propuesta de layout</p>
        <p className="rep-sub">{veTodos ? centroSel || "Todos los centros" : miCentro || "Tu centro"}</p>
        {veTodos && !loading && (
          <div className="centro-selector" style={{ marginTop: 10 }}>
            <select value={centroSel} onChange={(e) => setCentroSel(e.target.value)}>
              <option value="">Todos los centros</option>
              {centrosSelector.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content" style={{ maxWidth: 900 }}>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="search"
                className="ticket-admin-select"
                style={{ flex: "1 1 220px" }}
                placeholder="Buscar por cliente, oficina o descripción"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <select className="ticket-admin-select" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="">Todas</option>
                <option value="sin">Sin cotización</option>
                <option value="con">Con cotización</option>
              </select>
            </div>

            {puedeEditar && (
              <button className="btn-enviar" style={{ flex: "none", width: "auto", alignSelf: "flex-start", padding: "10px 18px", margin: 0 }} onClick={abrirNueva}>
                + Nueva propuesta
              </button>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

            {visibles.length === 0 ? (
              <div className="empty-card">
                {propuestas.length > 0
                  ? "Ninguna propuesta con estos filtros"
                  : puedeEditar
                  ? "Todavía no hay propuestas. Usa “+ Nueva propuesta” para subir la primera."
                  : "Todavía no hay propuestas de layout. Cuando la arquitecta suba una, aparecerá aquí."}
              </div>
            ) : (
              visibles.map((p) => {
                const est = p.cotizacion_url ? CON_COTIZACION : SIN_COTIZACION;
                const lista = comentarios[p.id] || [];
                return (
                  <div key={p.id} className="pl-card">
                    {/* Encabezado: cliente, datos y estado; las acciones de la arqui a la derecha, discretas. */}
                    <div className="pl-encabezado">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <p className="pl-cliente">{p.cliente}</p>
                          <span className="pp-estado" style={{ background: est.fondo, color: est.color }}>
                            {est.label}
                          </span>
                        </div>
                        <p className="pl-meta">{[p.oficina, p.centro, fecha(p.created_at)].filter(Boolean).join(" · ")}</p>
                      </div>
                      {puedeEditar && (
                        <div className="pl-acciones">
                          <button type="button" onClick={() => abrirEditar(p)}>
                            Editar
                          </button>
                          <button type="button" className="pl-accion-borrar" onClick={() => setBorrando(p)}>
                            Borrar
                          </button>
                        </div>
                      )}
                    </div>
                    {p.descripcion && <p className="pl-descripcion">{p.descripcion}</p>}

                    {/* Layout a la izquierda y cotización a la derecha (una debajo de otra en celular). */}
                    <div className="pl-cuerpo">
                      <div className="pl-bloque">
                        <p className="pl-bloque-titulo">Layout</p>
                        {p.layout_urls.map((u) => (
                          <div key={u} className="pl-archivo">
                            {esImagen(u) ? (
                              <ImagenPrivada src={u} bucket={BUCKET} alt="Layout" className="pl-mini" onClick={() => abrir(u)} />
                            ) : (
                              <span className="pl-mini pl-mini-doc" onClick={() => abrir(u)}>
                                {(u.split("?")[0].split(".").pop() || "").toUpperCase()}
                              </span>
                            )}
                            <span className="pl-nombre" title={nombreArchivo(u)}>
                              {nombreArchivo(u)}
                            </span>
                            <button type="button" className="pp-link" onClick={() => abrir(u)} disabled={abriendo === u}>
                              {abriendo === u ? "Abriendo…" : "Ver"}
                            </button>
                            <button type="button" className="pp-link" onClick={() => abrir(u, true)} disabled={abriendo === u}>
                              Descargar
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className={"pl-bloque" + (p.cotizacion_url ? " pl-bloque-cotizacion" : " pl-bloque-vacio")}>
                        <p className="pl-bloque-titulo">Cotización del layout</p>
                        {p.cotizacion_url ? (
                          <>
                            <p className="pl-monto">{p.cotizacion_monto != null ? pesos(Number(p.cotizacion_monto)) : "Sin monto"}</p>
                            <p className="pl-meta" style={{ margin: 0 }}>
                              {p.cotizacion_at ? `Subida el ${fecha(p.cotizacion_at)}` : ""}
                            </p>
                            <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
                              <button type="button" className="pp-link" onClick={() => abrir(p.cotizacion_url!)} disabled={abriendo === p.cotizacion_url}>
                                {abriendo === p.cotizacion_url ? "Abriendo…" : "Ver"}
                              </button>
                              <button type="button" className="pp-link" onClick={() => abrir(p.cotizacion_url!, true)} disabled={abriendo === p.cotizacion_url}>
                                Descargar
                              </button>
                              {puedeEditar && (
                                <button type="button" className="pp-link" style={{ color: "#5b6478" }} onClick={() => abrirCotizacion(p)}>
                                  Cambiar
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="pl-meta" style={{ margin: 0 }}>
                              {puedeEditar ? "Cuando el cliente la apruebe, súbela aquí." : "La arquitecta la subirá aquí."}
                            </p>
                            {puedeEditar && (
                              <button type="button" className="pl-btn-cotizacion" onClick={() => abrirCotizacion(p)}>
                                + Subir cotización
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Comentarios */}
                    <div className="pl-seccion-comentarios">
                      <p className="pl-bloque-titulo">Comentarios{lista.length > 0 ? ` · ${lista.length}` : ""}</p>
                      {lista.length > 0 && (
                        <div className="pl-comentarios">
                          {lista.map((c) => (
                            <div key={c.id} className={"pl-comentario" + (c.autor_rol === "operaciones" ? " pl-comentario-arqui" : "")}>
                              <p className="pl-comentario-autor">
                                {c.autor_nombre || "—"} · {fechaHora(c.created_at)}
                              </p>
                              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{c.mensaje}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="pl-comentar">
                        <input
                          placeholder={puedeEditar ? "Escribe un comentario para la admin" : "¿Qué dijo el cliente? Escribe un comentario"}
                          value={borradores[p.id] || ""}
                          onChange={(e) => setBorradores((b) => ({ ...b, [p.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              comentar(p);
                            }
                          }}
                        />
                        <button type="button" onClick={() => comentar(p)} disabled={enviando === p.id || !(borradores[p.id] || "").trim()}>
                          {enviando === p.id ? "Enviando…" : "Enviar"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {editando && (
        <div className="modal-overlay" onClick={() => !guardando && setEditando(null)}>
          <form className="modal-card pp-modal" onClick={(e) => e.stopPropagation()} onSubmit={guardarPropuesta}>
            <p className="modal-nombre">{editando === "nueva" ? "Nueva propuesta de layout" : "Editar propuesta"}</p>
            <p className="modal-email">La admin del centro la verá para enseñársela al cliente.</p>
            <div className="pp-grid">
              <label>
                Centro
                <select value={form.centro} onChange={(e) => setForm({ ...form, centro: e.target.value })}>
                  {centrosSelector.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Oficina
                <input value={form.oficina} onChange={(e) => setForm({ ...form, oficina: e.target.value })} placeholder="Ej. OF 18" />
              </label>
              <label className="pp-ancho">
                Cliente o prospecto
                <input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} placeholder="Nombre o empresa" required />
              </label>
              <label className="pp-ancho">
                Descripción
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué incluye el diseño (opcional)" />
              </label>
            </div>
            {layoutsActuales.length > 0 && (
              <>
                <p className="sub-label" style={{ margin: "4px 0 0" }}>
                  Archivos actuales
                </p>
                {layoutsActuales.map((u) => (
                  <div key={u} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreArchivo(u)}</span>
                    <button type="button" className="pp-link" style={{ color: "#A32D2D" }} onClick={() => setLayoutsActuales((l) => l.filter((x) => x !== u))}>
                      Quitar
                    </button>
                  </div>
                ))}
              </>
            )}
            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              {layoutsActuales.length > 0 ? "Agregar archivos" : "Archivos del layout (imágenes o PDF)"}
            </p>
            <FileDropzone files={archivosLayout} onChange={setArchivosLayout} maxFiles={10} accept="image/*,.pdf" maxSizeMB={25} compacto />
            {errorModal && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="submit" className="btn-aceptar" disabled={guardando}>
                {guardando ? "Guardando..." : editando === "nueva" ? "Subir propuesta" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {cotizando && (
        <div className="modal-overlay" onClick={() => !guardando && setCotizando(null)}>
          <div className="modal-card pp-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Cotización del layout</p>
            <p className="modal-email">
              {cotizando.cliente}
              {cotizando.oficina ? ` · ${cotizando.oficina}` : ""} · La admin podrá verla y descargarla.
            </p>
            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              Monto (opcional)
            </p>
            <input type="number" step="0.01" min="0" value={montoCotizacion} onChange={(e) => setMontoCotizacion(e.target.value)} placeholder="0.00" />
            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              Archivo de la cotización{cotizando.cotizacion_url ? " (sube otro solo para reemplazarla)" : ""}
            </p>
            <FileDropzone files={archivoCotizacion} onChange={setArchivoCotizacion} maxFiles={1} accept="image/*,.pdf,.xlsx,.xls,.docx" maxSizeMB={25} compacto />
            {errorModal && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setCotizando(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="button" className="btn-aceptar" onClick={guardarCotizacion} disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar cotización"}
              </button>
            </div>
          </div>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay" onClick={() => setBorrando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">¿Borrar esta propuesta?</p>
            <p className="modal-email">
              {borrando.cliente} · {borrando.centro}. La admin ya no la verá.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tel-borrar-btn" onClick={() => setBorrando(null)}>
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarBorrar}>
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
