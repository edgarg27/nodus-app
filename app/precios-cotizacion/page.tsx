"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";
import { URGENCIAS, urgenciaInfo, type Urgencia } from "@/lib/gastos";
import FileDropzone from "../soporte/FileDropzone";
import ImagenPrivada from "../components/ImagenPrivada";

// Precios de cotización. Cuando algo falla en un centro (ej. un baño que tira agua), la
// arquitecta (rol operaciones) pide precio a 3 proveedores y los sube aquí lado a lado. La
// Gerente (Maribel) los compara y elige con quién se hace; a la arquitecta le llega el aviso.
// Tablas, bucket y permisos: migracion_precios_cotizacion.sql.

type Opcion = {
  id: string;
  comparativo_id: string;
  orden: number;
  proveedor_id: string | null;
  proveedor_nombre: string;
  monto: number;
  tiempo_entrega: string | null;
  notas: string | null;
  archivo_url: string | null;
};

type Comparativo = {
  id: string;
  centro: string;
  oficina: string | null;
  titulo: string;
  descripcion: string | null;
  urgencia: Urgencia;
  fotos_urls: string[];
  estado: "pendiente" | "elegido";
  opcion_elegida_id: string | null;
  comentario_decision: string | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
  creado_por_nombre: string | null;
  created_at: string;
};

type Proveedor = { id: string; nombre: string; centro: string };

type FormOpcion = { proveedorId: string; proveedorNombre: string; monto: string; tiempo: string; notas: string; archivo: File[]; archivoActual: string | null };

const BUCKET = "cotizaciones-proveedores";
const MIN_OPCIONES = 2;
const OPCION_VACIA: FormOpcion = { proveedorId: "", proveedorNombre: "", monto: "", tiempo: "", notas: "", archivo: [], archivoActual: null };
const ROLES_DECIDEN = ["gerente", "superadmin"];

const pesos = (n: number) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
const esImagen = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);

function nombreArchivo(url: string) {
  const archivo = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  return archivo.includes("__") ? archivo.slice(archivo.indexOf("__") + 2) : archivo;
}

export default function PreciosCotizacionPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [comparativos, setComparativos] = useState<Comparativo[]>([]);
  const [opciones, setOpciones] = useState<Record<string, Opcion[]>>({});
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [centroSel, setCentroSel] = useState("");
  const [fEstado, setFEstado] = useState("pendiente");
  const [busqueda, setBusqueda] = useState("");

  const [editando, setEditando] = useState<Comparativo | "nuevo" | null>(null);
  const [form, setForm] = useState({ centro: "", oficina: "", titulo: "", descripcion: "", urgencia: "verde" as Urgencia });
  const [formOpciones, setFormOpciones] = useState<FormOpcion[]>([OPCION_VACIA, OPCION_VACIA, OPCION_VACIA]);
  const [fotos, setFotos] = useState<File[]>([]);
  const [fotosActuales, setFotosActuales] = useState<string[]>([]);
  const [eligiendo, setEligiendo] = useState<{ comparativo: Comparativo; opcion: Opcion } | null>(null);
  const [comentarioDecision, setComentarioDecision] = useState("");
  const [borrando, setBorrando] = useState<Comparativo | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState("");
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const puedeEditar = rol === "operaciones";
  const puedeDecidir = ROLES_DECIDEN.includes(rol);

  useEffect(() => {
    // Desde el aviso "eligió a…" se llega con ?ver=elegido para ver la decisión.
    const ver = new URLSearchParams(window.location.search).get("ver");
    if (ver === "elegido") setFEstado("elegido");
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
    const { data: perfil } = await supabase.from("profiles").select("rol, nombre").eq("id", user.id).single();
    setRol(perfil?.rol || "");
    setMiNombre(perfil?.nombre || "");
    const [{ data: cs, error: e1 }, { data: os }, { data: ps }] = await Promise.all([
      supabase.from("comparativos_proveedores").select("*").order("created_at", { ascending: false }),
      supabase.from("comparativo_opciones").select("*").order("orden"),
      supabase.from("proveedores").select("id, nombre, centro").eq("tipo", "operaciones").order("nombre"),
    ]);
    if (e1) setError(/comparativos_proveedores/i.test(e1.message) ? "Falta correr la migración migracion_precios_cotizacion.sql." : "No se pudieron cargar las cotizaciones.");
    setComparativos((cs as Comparativo[]) || []);
    const agrupadas: Record<string, Opcion[]> = {};
    for (const o of (os as Opcion[]) || []) (agrupadas[o.comparativo_id] ||= []).push(o);
    setOpciones(agrupadas);
    setProveedores((ps as Proveedor[]) || []);
    setLoading(false);
  }

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return comparativos.filter(
      (c) =>
        (!centroSel || c.centro === centroSel) &&
        (!fEstado || c.estado === fEstado) &&
        (!q ||
          [c.titulo, c.oficina, c.descripcion, ...(opciones[c.id] || []).map((o) => o.proveedor_nombre)]
            .join(" ")
            .toLowerCase()
            .includes(q))
    );
  }, [comparativos, opciones, centroSel, fEstado, busqueda]);

  const porDecidir = comparativos.filter((c) => c.estado === "pendiente" && (!centroSel || c.centro === centroSel)).length;

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

  // ---------- Alta / edición ----------
  function abrirNuevo() {
    setForm({ centro: centroSel || "Bosques", oficina: "", titulo: "", descripcion: "", urgencia: "verde" });
    setFormOpciones([OPCION_VACIA, OPCION_VACIA, OPCION_VACIA]);
    setFotos([]);
    setFotosActuales([]);
    setErrorModal("");
    setEditando("nuevo");
  }

  function abrirEditar(c: Comparativo) {
    setForm({ centro: c.centro, oficina: c.oficina || "", titulo: c.titulo, descripcion: c.descripcion || "", urgencia: c.urgencia });
    const actuales = (opciones[c.id] || []).map((o) => ({
      proveedorId: o.proveedor_id || (o.proveedor_nombre ? "__otro" : ""),
      proveedorNombre: o.proveedor_id ? "" : o.proveedor_nombre,
      monto: String(o.monto),
      tiempo: o.tiempo_entrega || "",
      notas: o.notas || "",
      archivo: [],
      archivoActual: o.archivo_url,
    }));
    while (actuales.length < 3) actuales.push(OPCION_VACIA);
    setFormOpciones(actuales);
    setFotos([]);
    setFotosActuales(c.fotos_urls || []);
    setErrorModal("");
    setEditando(c);
  }

  function cambiarOpcion(i: number, cambios: Partial<FormOpcion>) {
    setFormOpciones((lista) => lista.map((o, j) => (j === i ? { ...o, ...cambios } : o)));
  }

  const nombreDeOpcion = (o: FormOpcion) =>
    o.proveedorId === "__otro" ? o.proveedorNombre.trim() : proveedores.find((p) => p.id === o.proveedorId)?.nombre || "";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    if (!form.titulo.trim()) return setErrorModal("Escribe qué se necesita.");
    const llenas = formOpciones.filter((o) => nombreDeOpcion(o) || o.monto);
    if (llenas.some((o) => !nombreDeOpcion(o) || !o.monto || Number(o.monto) <= 0)) return setErrorModal("Cada cotización necesita proveedor y monto.");
    if (llenas.length < MIN_OPCIONES) return setErrorModal(`Agrega al menos ${MIN_OPCIONES} cotizaciones para poder compararlas.`);
    setGuardando(true);
    setErrorModal("");

    const nuevasFotos: string[] = [];
    for (const f of fotos) {
      const url = await subir(f, "fotos");
      if (!url) {
        setErrorModal("No se pudo subir una foto. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
      nuevasFotos.push(url);
    }
    const filas = [];
    for (const [i, o] of llenas.entries()) {
      let archivoUrl = o.archivoActual;
      if (o.archivo[0]) {
        archivoUrl = await subir(o.archivo[0], "cotizacion");
        if (!archivoUrl) {
          setErrorModal("No se pudo subir un archivo de cotización. Intenta de nuevo.");
          setGuardando(false);
          return;
        }
      }
      filas.push({
        orden: i + 1,
        proveedor_id: o.proveedorId && o.proveedorId !== "__otro" ? o.proveedorId : null,
        proveedor_nombre: nombreDeOpcion(o),
        monto: Number(o.monto),
        tiempo_entrega: o.tiempo.trim() || null,
        notas: o.notas.trim() || null,
        archivo_url: archivoUrl,
      });
    }

    const datos = {
      centro: form.centro,
      oficina: form.oficina.trim() || null,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      urgencia: form.urgencia,
      fotos_urls: [...fotosActuales, ...nuevasFotos],
      updated_at: new Date().toISOString(),
    };
    let id: string;
    if (editando === "nuevo") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error: e1 } = await supabase
        .from("comparativos_proveedores")
        .insert({ ...datos, creado_por: user?.id, creado_por_nombre: miNombre || null })
        .select("id")
        .single();
      if (e1 || !data) {
        setErrorModal("No se pudo guardar. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
      id = data.id;
    } else {
      id = editando.id;
      const { error: e1 } = await supabase.from("comparativos_proveedores").update(datos).eq("id", id);
      if (!e1) await supabase.from("comparativo_opciones").delete().eq("comparativo_id", id);
      if (e1) {
        setErrorModal("No se pudo guardar. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
    }
    const { error: e2 } = await supabase.from("comparativo_opciones").insert(filas.map((f) => ({ ...f, comparativo_id: id })));
    if (e2) {
      setErrorModal("Se guardó, pero no las cotizaciones. Ábrelo con Editar y vuelve a intentar.");
      setGuardando(false);
      cargar();
      return;
    }
    if (editando === "nuevo") {
      const u = urgenciaInfo(form.urgencia);
      await supabase.from("notificaciones").insert({
        centro: form.centro,
        tipo: "comparativo_nuevo",
        mensaje: `🧾 ${miNombre || "Operaciones"} subió ${filas.length} cotizaciones para elegir (${u.label.toLowerCase()}): ${datos.titulo} · ${form.centro}`,
      });
    }
    setGuardando(false);
    setEditando(null);
    cargar();
  }

  // ---------- Decisión de la gerente ----------
  async function confirmarEleccion() {
    if (!eligiendo) return;
    setGuardando(true);
    const { comparativo: c, opcion: o } = eligiendo;
    const { error: e } = await supabase
      .from("comparativos_proveedores")
      .update({
        estado: "elegido",
        opcion_elegida_id: o.id,
        comentario_decision: comentarioDecision.trim() || null,
        decidido_por_nombre: miNombre || null,
        decidido_at: new Date().toISOString(),
      })
      .eq("id", c.id);
    setGuardando(false);
    if (e) return alert("No se pudo guardar la decisión.");
    await supabase.from("notificaciones").insert({
      centro: c.centro,
      tipo: "comparativo_elegido",
      mensaje: `✅ ${miNombre || "Gerencia"} eligió a ${o.proveedor_nombre} (${pesos(o.monto)}) para: ${c.titulo}${
        comentarioDecision.trim() ? ` — "${comentarioDecision.trim().slice(0, 80)}"` : ""
      }`,
    });
    setEligiendo(null);
    cargar();
  }

  async function reabrir(c: Comparativo) {
    const { error: e } = await supabase
      .from("comparativos_proveedores")
      .update({ estado: "pendiente", opcion_elegida_id: null, comentario_decision: null, decidido_por_nombre: null, decidido_at: null })
      .eq("id", c.id);
    if (e) alert("No se pudo cambiar.");
    cargar();
  }

  async function confirmarBorrar() {
    if (!borrando) return;
    const { error: e } = await supabase.from("comparativos_proveedores").delete().eq("id", borrando.id);
    if (e) alert("No se pudo borrar.");
    setBorrando(null);
    cargar();
  }

  const centrosSelector = Array.from(new Set([...CENTROS_REPORTE, ...comparativos.map((c) => c.centro)]));
  const provsDelCentro = proveedores.filter((p) => p.centro === form.centro);

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Precios de cotización</p>
        <p className="rep-sub">{centroSel || "Todos los centros"}</p>
        {!loading && (
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

      <div className="rep-content" style={{ maxWidth: 1000 }}>
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
                placeholder="Buscar por lo que se necesita, oficina o proveedor"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <select className="ticket-admin-select" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="pendiente">Por decidir ({porDecidir})</option>
                <option value="elegido">Ya decididas</option>
                <option value="">Todas</option>
              </select>
            </div>

            {puedeEditar && (
              <button className="btn-enviar" style={{ flex: "none", width: "auto", alignSelf: "flex-start", padding: "10px 18px", margin: 0 }} onClick={abrirNuevo}>
                + Nueva cotización
              </button>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

            {visibles.length === 0 ? (
              <div className="empty-card">
                {comparativos.length > 0
                  ? fEstado === "pendiente"
                    ? "No hay cotizaciones por decidir."
                    : "Ninguna con estos filtros"
                  : puedeEditar
                  ? "Todavía no hay cotizaciones. Usa “+ Nueva cotización” cuando necesites comparar proveedores."
                  : "Todavía no hay cotizaciones. Cuando la arquitecta suba una, aparecerá aquí para que elijas."}
              </div>
            ) : (
              visibles.map((c) => {
                const ops = opciones[c.id] || [];
                const minimo = ops.length > 0 ? Math.min(...ops.map((o) => Number(o.monto))) : 0;
                const urg = urgenciaInfo(c.urgencia);
                const elegida = ops.find((o) => o.id === c.opcion_elegida_id);
                return (
                  <div key={c.id} className="pl-card">
                    <div className="pl-encabezado">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <p className="pl-cliente">{c.titulo}</p>
                          {c.estado === "elegido" ? (
                            <span className="pp-estado" style={{ background: "#E3F5EC", color: "#0F6E56" }}>
                              Decidida
                            </span>
                          ) : (
                            <span className="pp-estado" style={{ background: urg.fondo, color: urg.color }}>
                              ● {urg.label} · por decidir
                            </span>
                          )}
                        </div>
                        <p className="pl-meta">
                          {[c.oficina, c.centro, fecha(c.created_at)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {puedeEditar && (
                        <div className="pl-acciones">
                          {c.estado === "pendiente" && (
                            <button type="button" onClick={() => abrirEditar(c)}>
                              Editar
                            </button>
                          )}
                          <button type="button" className="pl-accion-borrar" onClick={() => setBorrando(c)}>
                            Borrar
                          </button>
                        </div>
                      )}
                    </div>
                    {c.descripcion && <p className="pl-descripcion">{c.descripcion}</p>}
                    {c.fotos_urls.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {c.fotos_urls.map((u) =>
                          esImagen(u) ? (
                            <ImagenPrivada key={u} src={u} bucket={BUCKET} alt="Foto" className="pc-foto" onClick={() => abrir(u)} />
                          ) : (
                            <button key={u} type="button" className="pp-link" onClick={() => abrir(u)}>
                              {nombreArchivo(u)}
                            </button>
                          )
                        )}
                      </div>
                    )}

                    {elegida && (
                      <div className="pc-decision">
                        <p style={{ margin: 0, fontWeight: 700 }}>
                          Se eligió a {elegida.proveedor_nombre} · {pesos(elegida.monto)}
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#3b6b58" }}>
                          {c.decidido_por_nombre || "Gerencia"}
                          {c.decidido_at ? ` · ${fecha(c.decidido_at)}` : ""}
                          {c.comentario_decision ? ` — “${c.comentario_decision}”` : ""}
                        </p>
                        {puedeDecidir && (
                          <button type="button" className="pp-link" style={{ marginTop: 4, color: "#5b6478" }} onClick={() => reabrir(c)}>
                            Cambiar decisión
                          </button>
                        )}
                      </div>
                    )}

                    <div className="pc-opciones" style={{ gridTemplateColumns: `repeat(${Math.max(ops.length, 1)}, minmax(0, 1fr))` }}>
                      {ops.map((o) => {
                        const esElegida = o.id === c.opcion_elegida_id;
                        const esMasBarata = ops.length > 1 && Number(o.monto) === minimo;
                        return (
                          <div key={o.id} className={"pc-opcion" + (esElegida ? " pc-elegida" : "") + (c.estado === "elegido" && !esElegida ? " pc-descartada" : "")}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "flex-start" }}>
                              <p className="pc-proveedor">{o.proveedor_nombre}</p>
                              {esElegida ? <span className="pc-tag pc-tag-elegida">Elegida</span> : esMasBarata ? <span className="pc-tag">Más barata</span> : null}
                            </div>
                            <p className="pc-monto">{pesos(o.monto)}</p>
                            {o.tiempo_entrega && <p className="pl-meta" style={{ margin: 0 }}>Tiempo: {o.tiempo_entrega}</p>}
                            {o.notas && <p style={{ margin: 0, fontSize: 12.5, color: "#3b4660", whiteSpace: "pre-wrap" }}>{o.notas}</p>}
                            <div style={{ flex: 1 }} />
                            {o.archivo_url ? (
                              <div style={{ display: "flex", gap: 12 }}>
                                <button type="button" className="pp-link" onClick={() => abrir(o.archivo_url!)} disabled={abriendo === o.archivo_url}>
                                  {abriendo === o.archivo_url ? "Abriendo…" : "Ver cotización"}
                                </button>
                                <button type="button" className="pp-link" onClick={() => abrir(o.archivo_url!, true)} disabled={abriendo === o.archivo_url}>
                                  Descargar
                                </button>
                              </div>
                            ) : (
                              <p className="pl-meta" style={{ margin: 0 }}>
                                Sin archivo
                              </p>
                            )}
                            {puedeDecidir && c.estado === "pendiente" && (
                              <button
                                type="button"
                                className="pl-btn-cotizacion"
                                style={{ alignSelf: "stretch" }}
                                onClick={() => {
                                  setComentarioDecision("");
                                  setEligiendo({ comparativo: c, opcion: o });
                                }}
                              >
                                Elegir este
                              </button>
                            )}
                          </div>
                        );
                      })}
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
          <form className="modal-card pp-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
            <p className="modal-nombre">{editando === "nuevo" ? "Nueva cotización" : "Editar cotización"}</p>
            <p className="modal-email">Sube las cotizaciones de los proveedores para que gerencia elija con quién se hace.</p>
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
                Oficina / área
                <input value={form.oficina} onChange={(e) => setForm({ ...form, oficina: e.target.value })} placeholder="Ej. Baños P2" />
              </label>
              <label className="pp-ancho">
                ¿Qué se necesita?
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Reparar fuga en baño de hombres" required />
              </label>
              <label className="pp-ancho">
                Descripción
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué pasa y qué incluye el trabajo (opcional)" />
              </label>
            </div>

            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              ¿Qué tan urgente es?
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {URGENCIAS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setForm({ ...form, urgencia: u.id })}
                  className="pp-urgencia"
                  style={{ border: `2px solid ${form.urgencia === u.id ? u.color : "#e3e6ee"}`, background: form.urgencia === u.id ? u.fondo : "#fff" }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: u.color, display: "inline-block" }} />
                  {u.label}
                </button>
              ))}
            </div>

            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              Fotos del problema · opcional
            </p>
            {fotosActuales.length > 0 && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                {fotosActuales.map((u) => (
                  <span key={u}>
                    {nombreArchivo(u)}{" "}
                    <button type="button" className="pp-link" style={{ color: "#A32D2D" }} onClick={() => setFotosActuales((l) => l.filter((x) => x !== u))}>
                      Quitar
                    </button>
                  </span>
                ))}
              </div>
            )}
            <FileDropzone files={fotos} onChange={setFotos} maxFiles={5} accept="image/*" compacto />

            <p className="sub-label" style={{ margin: "6px 0 0" }}>
              Cotizaciones de proveedores (mínimo {MIN_OPCIONES}, idealmente 3)
            </p>
            <div className="pc-form-opciones">
              {formOpciones.map((o, i) => (
                <div key={i} className="pc-form-opcion">
                  <p className="pl-bloque-titulo">Opción {i + 1}</p>
                  <select value={o.proveedorId} onChange={(e) => cambiarOpcion(i, { proveedorId: e.target.value })}>
                    <option value="">Proveedor…</option>
                    {provsDelCentro.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                    <option value="__otro">Otro (escribir nombre)</option>
                  </select>
                  {o.proveedorId === "__otro" && (
                    <input value={o.proveedorNombre} onChange={(e) => cambiarOpcion(i, { proveedorNombre: e.target.value })} placeholder="Nombre del proveedor" />
                  )}
                  <input type="number" step="0.01" min="0" value={o.monto} onChange={(e) => cambiarOpcion(i, { monto: e.target.value })} placeholder="Monto total" />
                  <input value={o.tiempo} onChange={(e) => cambiarOpcion(i, { tiempo: e.target.value })} placeholder="Tiempo (ej. 2 días)" />
                  <input value={o.notas} onChange={(e) => cambiarOpcion(i, { notas: e.target.value })} placeholder="Notas (garantía, qué incluye…)" />
                  {o.archivoActual && o.archivo.length === 0 && <p className="pl-meta" style={{ margin: 0 }}>Archivo: {nombreArchivo(o.archivoActual)}</p>}
                  <FileDropzone files={o.archivo} onChange={(f) => cambiarOpcion(i, { archivo: f })} maxFiles={1} accept="image/*,.pdf" maxSizeMB={25} compacto />
                </div>
              ))}
            </div>

            {errorModal && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="submit" className="btn-aceptar" disabled={guardando}>
                {guardando ? "Guardando..." : editando === "nuevo" ? "Enviar a gerencia" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {eligiendo && (
        <div className="modal-overlay" onClick={() => !guardando && setEligiendo(null)}>
          <div className="modal-card pp-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">¿Elegir a {eligiendo.opcion.proveedor_nombre}?</p>
            <p className="modal-email">
              {eligiendo.comparativo.titulo} · {pesos(eligiendo.opcion.monto)}. A la arquitecta le llegará el aviso.
            </p>
            <textarea value={comentarioDecision} onChange={(e) => setComentarioDecision(e.target.value)} placeholder="Comentario para la arquitecta (opcional)" />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setEligiendo(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="button" className="btn-aceptar" onClick={confirmarEleccion} disabled={guardando}>
                {guardando ? "Guardando..." : "Elegir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay" onClick={() => setBorrando(null)}>
          <div className="modal-card pp-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">¿Borrar esta cotización?</p>
            <p className="modal-email">
              {borrando.titulo} · {borrando.centro}. Se borran también sus opciones.
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
