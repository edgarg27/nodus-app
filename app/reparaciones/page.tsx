"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import { CENTROS_POR_ROL } from "@/lib/roles";
import { URGENCIAS, urgenciaInfo, type Urgencia } from "@/lib/gastos";
import FileDropzone from "../soporte/FileDropzone";
import ImagenPrivada from "../components/ImagenPrivada";

// Reparaciones. La arquitecta (rol operaciones) le asigna una reparación a Mantenimiento
// (rol mantenimiento, p. ej. Edgar en León). Él sube los avances con fotos en el hilo de
// seguimiento (en vez de WhatsApp) y la marca como terminada con foto del resultado; la
// arquitecta la revisa y la cierra o se la regresa. El cliente no ve nada de esto.
// Tablas, bucket y permisos: migracion_reparaciones.sql.

type Estado = "asignada" | "en_proceso" | "terminada" | "cerrada";

type Reparacion = {
  id: string;
  centro: string;
  oficina: string | null;
  titulo: string;
  descripcion: string | null;
  urgencia: Urgencia;
  fecha_compromiso: string | null;
  estado: Estado;
  asignado_a: string;
  asignado_nombre: string | null;
  ticket_id: string | null;
  fotos_urls: string[];
  creado_por_nombre: string | null;
  ultimo_avance_at: string | null;
  terminada_at: string | null;
  cerrada_at: string | null;
  created_at: string;
};

type Mensaje = {
  id: string;
  reparacion_id: string;
  autor_id: string | null;
  autor_nombre: string | null;
  autor_rol: string | null;
  tipo: "mensaje" | "avance" | "terminada" | "regresada" | "cerrada";
  mensaje: string | null;
  fotos_urls: string[];
  created_at: string;
};

type Persona = { id: string; nombre: string | null };

const BUCKET = "reparaciones";
const CENTROS_MTTO = CENTROS_POR_ROL.mantenimiento || [];
// Sin avance en este tiempo, la tarjeta se marca en amarillo para la arquitecta.
const DIAS_SIN_AVANCE = 2;

const ESTADOS: Record<Estado, { label: string; color: string; fondo: string }> = {
  asignada: { label: "Asignada", color: "#3B5BDB", fondo: "#E7ECFF" },
  en_proceso: { label: "En proceso", color: "#8A5A00", fondo: "#FFF4D6" },
  terminada: { label: "Por revisar", color: "#7A3DB8", fondo: "#F1E8FB" },
  cerrada: { label: "Cerrada", color: "#0F6E56", fondo: "#E3F5EC" },
};

const FILTROS: { id: string; label: string; estados: Estado[] }[] = [
  { id: "activas", label: "Activas", estados: ["asignada", "en_proceso"] },
  { id: "revisar", label: "Por revisar", estados: ["terminada"] },
  { id: "cerradas", label: "Cerradas", estados: ["cerrada"] },
  { id: "todas", label: "Todas", estados: ["asignada", "en_proceso", "terminada", "cerrada"] },
];

const FORM_VACIO = { centro: CENTROS_MTTO[0] || "", oficina: "", titulo: "", descripcion: "", urgencia: "verde" as Urgencia, fechaCompromiso: "", asignadoA: "" };

const fecha = (iso: string) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

// "Hoy", "Ayer" o la fecha, para separar los días en el chat.
function diaDe(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function haceCuanto(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Semáforo para que la arquitecta no tenga que estar preguntando "¿cómo vas?".
function alertaDe(r: Reparacion): { label: string; color: string; fondo: string } | null {
  if (r.estado === "terminada" || r.estado === "cerrada") return null;
  if (r.fecha_compromiso && hoyISO() > r.fecha_compromiso) return { label: "Ya pasó la fecha compromiso", color: "#D64545", fondo: "#FBE4E4" };
  const ref = new Date(r.ultimo_avance_at || r.created_at).getTime();
  const dias = Math.floor((Date.now() - ref) / 86400000);
  if (dias >= DIAS_SIN_AVANCE) return { label: `Sin avance hace ${dias} días`, color: "#C98A00", fondo: "#FFF4D6" };
  return null;
}

function nombreArchivo(url: string) {
  const archivo = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  return archivo.includes("__") ? archivo.slice(archivo.indexOf("__") + 2) : archivo;
}

export default function ReparacionesPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [miId, setMiId] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [reparaciones, setReparaciones] = useState<Reparacion[]>([]);
  const [personal, setPersonal] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filtro, setFiltro] = useState("activas");
  const [busqueda, setBusqueda] = useState("");

  // Alta / edición (solo la arquitecta)
  const [editando, setEditando] = useState<Reparacion | "nuevo" | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [ticketOrigen, setTicketOrigen] = useState<string | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [fotosActuales, setFotosActuales] = useState<string[]>([]);
  const [borrando, setBorrando] = useState<Reparacion | null>(null);

  // Detalle con el hilo de seguimiento
  const [abierta, setAbierta] = useState<Reparacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoHilo, setCargandoHilo] = useState(false);
  const [texto, setTexto] = useState("");
  const [fotosMsg, setFotosMsg] = useState<File[]>([]);
  const [verProblema, setVerProblema] = useState(false);
  const inputFotosRef = useRef<HTMLInputElement>(null);
  // Miniaturas de las fotos que se van a mandar (se liberan al cambiar).
  const previews = useMemo(() => fotosMsg.map((f) => URL.createObjectURL(f)), [fotosMsg]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState("");

  // El hilo baja solo al mensaje más reciente, como en un chat.
  const hiloRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hiloRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes, cargandoHilo]);

  const esArqui = rol === "operaciones";
  const esMtto = rol === "mantenimiento";

  useEffect(() => {
    cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar(inicial = false) {
    if (inicial) setLoading(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setMiId(user.id);
    // Todo en una sola tanda (antes eran 3 vueltas seguidas a la base).
    const [{ data: perfil }, { data, error: e }, { data: gente }] = await Promise.all([
      supabase.from("profiles").select("rol, nombre").eq("id", user.id).single(),
      supabase.from("reparaciones").select("*").order("created_at", { ascending: false }),
      // Solo la arquitecta alcanza a ver estas cuentas (para asignarles); a los demás les llega vacío.
      supabase.from("profiles").select("id, nombre").eq("rol", "mantenimiento").order("nombre"),
    ]);
    const r = perfil?.rol || "";
    setRol(r);
    setMiNombre(perfil?.nombre || "");
    if (e) setError(/reparaciones/i.test(e.message) ? "Falta correr la migración migracion_reparaciones.sql." : "No se pudieron cargar las reparaciones.");
    const lista = (data as Reparacion[]) || [];
    setReparaciones(lista);
    if (r === "operaciones") setPersonal((gente as Persona[]) || []);
    if (inicial) {
      setLoading(false);
      const params = new URLSearchParams(window.location.search);
      // Desde Tickets: "Asignar a mantenimiento" llega con ?ticket=<id>.
      const ticketId = params.get("ticket");
      if (ticketId && r === "operaciones") await nuevaDesdeTicket(ticketId);
      // Si ya estás mirando una, se refresca con lo nuevo.
    } else if (abierta) {
      const fresca = lista.find((x) => x.id === abierta.id);
      if (fresca) setAbierta(fresca);
    }
    // Para Mantenimiento, lo primero es lo que tiene pendiente; para la arquitecta, lo que hay que revisar.
    if (inicial && r === "operaciones" && lista.some((x) => x.estado === "terminada")) setFiltro("revisar");
  }

  const conteos = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTROS) c[f.id] = reparaciones.filter((r) => f.estados.includes(r.estado)).length;
    return c;
  }, [reparaciones]);

  const visibles = useMemo(() => {
    const estados = FILTROS.find((f) => f.id === filtro)?.estados || [];
    const q = busqueda.toLowerCase().trim();
    return reparaciones.filter(
      (r) =>
        estados.includes(r.estado) &&
        (!q || [r.titulo, r.oficina, r.centro, r.descripcion, r.asignado_nombre].join(" ").toLowerCase().includes(q))
    );
  }, [reparaciones, filtro, busqueda]);

  async function abrirArchivo(url: string) {
    const { url: firmado, error: e } = await pedirLinkFirmado(url, {});
    if (!firmado) return alert("No se pudo abrir el archivo: " + (e || "intenta de nuevo"));
    window.open(firmado, "_blank");
  }

  async function subir(archivo: File, prefijo: string) {
    const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "jpg";
    const original = archivo.name
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^A-Za-z0-9 ._-]+/g, "-")
      .trim()
      .slice(0, 80);
    // Supabase Storage no acepta acentos en la ruta ("Puerta Bajío Piso 2"): se limpia.
    const carpeta = prefijo
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^A-Za-z0-9/_-]+/g, "-");
    const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${original ? `__${original}` : ""}.${ext}`;
    const { error: e } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: true });
    if (e) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  }

  async function subirVarias(archivos: File[], prefijo: string) {
    const urls: string[] = [];
    for (const a of archivos) {
      const u = await subir(a, prefijo);
      if (!u) return null;
      urls.push(u);
    }
    return urls;
  }

  async function avisar(r: { centro: string; titulo: string }, para: "mantenimiento" | "operaciones", mensaje: string) {
    await supabase.from("notificaciones").insert({
      centro: r.centro,
      tipo: para === "mantenimiento" ? "reparacion_para_mantenimiento" : "reparacion_para_operaciones",
      mensaje,
    });
  }

  // ---------- Alta / edición ----------
  function abrirNuevo() {
    setForm({ ...FORM_VACIO, asignadoA: personal[0]?.id || "" });
    setTicketOrigen(null);
    setFotos([]);
    setFotosActuales([]);
    setErrorModal("");
    setEditando("nuevo");
  }

  async function nuevaDesdeTicket(ticketId: string) {
    const { data: t } = await supabase
      .from("tickets")
      .select("folio, asunto, descripcion, centro, urgencia, foto_url, foto_urls")
      .eq("id", ticketId)
      .maybeSingle();
    if (!t) return;
    const { data: gente } = await supabase.from("profiles").select("id, nombre").eq("rol", "mantenimiento").order("nombre");
    setForm({
      ...FORM_VACIO,
      centro: CENTROS_MTTO.includes(t.centro) ? t.centro : FORM_VACIO.centro,
      titulo: t.asunto || "",
      descripcion: [t.descripcion, t.folio ? `(Ticket ${t.folio})` : ""].filter(Boolean).join("\n"),
      urgencia: t.urgencia === "urgente" ? "rojo" : "verde",
      asignadoA: (gente as Persona[] | null)?.[0]?.id || "",
    });
    setTicketOrigen(ticketId);
    setFotos([]);
    setFotosActuales(((t.foto_urls as string[] | null) || (t.foto_url ? [t.foto_url] : [])).filter(Boolean));
    setErrorModal("");
    setEditando("nuevo");
  }

  function abrirEditar(r: Reparacion) {
    setForm({
      centro: r.centro,
      oficina: r.oficina || "",
      titulo: r.titulo,
      descripcion: r.descripcion || "",
      urgencia: r.urgencia,
      fechaCompromiso: r.fecha_compromiso || "",
      asignadoA: r.asignado_a,
    });
    setTicketOrigen(r.ticket_id);
    setFotos([]);
    setFotosActuales(r.fotos_urls || []);
    setErrorModal("");
    setEditando(r);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    if (!form.titulo.trim()) return setErrorModal("Escribe qué hay que reparar.");
    if (!form.asignadoA) return setErrorModal("Elige a quién se le asigna.");
    setGuardando(true);
    setErrorModal("");
    const nuevas = await subirVarias(fotos, `${form.centro}/inicio`);
    if (!nuevas) {
      setGuardando(false);
      return setErrorModal("No se pudieron subir las fotos. Intenta de nuevo.");
    }
    const asignado = personal.find((p) => p.id === form.asignadoA);
    const datos = {
      centro: form.centro,
      oficina: form.oficina.trim() || null,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      urgencia: form.urgencia,
      fecha_compromiso: form.fechaCompromiso || null,
      asignado_a: form.asignadoA,
      asignado_nombre: asignado?.nombre || null,
      ticket_id: ticketOrigen,
      fotos_urls: [...fotosActuales, ...nuevas],
      updated_at: new Date().toISOString(),
    };
    if (editando === "nuevo") {
      const { error: e1 } = await supabase.from("reparaciones").insert({ ...datos, creado_por: miId, creado_por_nombre: miNombre || null });
      if (e1) {
        setGuardando(false);
        return setErrorModal("No se pudo guardar la reparación.");
      }
      const u = urgenciaInfo(form.urgencia);
      await avisar(datos, "mantenimiento", `🔧 Nueva reparación (${u.label.toLowerCase()}): ${datos.titulo} · ${[datos.oficina, datos.centro].filter(Boolean).join(" · ")}`);
    } else {
      const { error: e2 } = await supabase.from("reparaciones").update(datos).eq("id", editando.id);
      if (e2) {
        setGuardando(false);
        return setErrorModal("No se pudieron guardar los cambios.");
      }
    }
    setGuardando(false);
    setEditando(null);
    if (ticketOrigen) window.history.replaceState(null, "", "/reparaciones");
    cargar();
  }

  async function confirmarBorrar() {
    if (!borrando) return;
    const { error: e } = await supabase.from("reparaciones").delete().eq("id", borrando.id);
    if (e) alert("No se pudo borrar.");
    setBorrando(null);
    setAbierta(null);
    cargar();
  }

  // ---------- Hilo de seguimiento ----------
  async function abrirDetalle(r: Reparacion) {
    setAbierta(r);
    setVerProblema(false);
    setTexto("");
    setFotosMsg([]);
    setErrorModal("");
    setCargandoHilo(true);
    const { data } = await supabase.from("reparacion_mensajes").select("*").eq("reparacion_id", r.id).order("created_at");
    setMensajes((data as Mensaje[]) || []);
    setCargandoHilo(false);
  }

  // accion: "mensaje" (cualquiera), "avance" (mantenimiento), "terminada" (mantenimiento),
  // "regresada" y "cerrada" (la arquitecta, cuando ya está por revisar).
  async function enviar(accion: Mensaje["tipo"]) {
    if (!abierta) return;
    const t = texto.trim();
    if (accion === "terminada" && fotosMsg.length === 0) return setErrorModal("Para marcarla como terminada sube al menos una foto de cómo quedó.");
    if (accion === "regresada" && !t) return setErrorModal("Escribe qué falta o qué hay que corregir.");
    if ((accion === "mensaje" || accion === "avance") && !t && fotosMsg.length === 0) return setErrorModal("Escribe un mensaje o sube una foto.");
    setGuardando(true);
    setErrorModal("");
    const urls = await subirVarias(fotosMsg, `${abierta.centro}/${abierta.id}`);
    if (!urls) {
      setGuardando(false);
      return setErrorModal("No se pudieron subir las fotos. Intenta de nuevo.");
    }
    const { error: e1 } = await supabase.from("reparacion_mensajes").insert({
      reparacion_id: abierta.id,
      autor_id: miId,
      autor_nombre: miNombre || null,
      autor_rol: rol,
      tipo: accion,
      mensaje: t || null,
      fotos_urls: urls,
    });
    if (e1) {
      setGuardando(false);
      return setErrorModal("No se pudo enviar.");
    }

    const ahora = new Date().toISOString();
    const cambios: Partial<Reparacion> & { updated_at: string } = { updated_at: ahora };
    if (esMtto) {
      cambios.ultimo_avance_at = ahora;
      if (abierta.estado === "asignada") cambios.estado = "en_proceso";
    }
    if (accion === "terminada") {
      cambios.estado = "terminada";
      cambios.terminada_at = ahora;
    }
    if (accion === "regresada") cambios.estado = "en_proceso";
    if (accion === "cerrada") {
      cambios.estado = "cerrada";
      cambios.cerrada_at = ahora;
    }
    await supabase.from("reparaciones").update(cambios).eq("id", abierta.id);

    const donde = [abierta.oficina, abierta.centro].filter(Boolean).join(" · ");
    const fotosTxt = urls.length ? ` (${urls.length} foto${urls.length === 1 ? "" : "s"})` : "";
    const resumen = t ? `: "${t.slice(0, 80)}"` : "";
    if (accion === "terminada") await avisar(abierta, "operaciones", `✅ ${miNombre || "Mantenimiento"} terminó: ${abierta.titulo} · ${donde}. Revísala para cerrarla.`);
    else if (accion === "regresada") await avisar(abierta, "mantenimiento", `↩️ La arquitecta regresó: ${abierta.titulo} · ${donde}${resumen}`);
    else if (accion === "cerrada") await avisar(abierta, "mantenimiento", `🏁 Reparación cerrada: ${abierta.titulo} · ${donde}`);
    else if (esMtto) await avisar(abierta, "operaciones", `🔧 Avance de ${miNombre || "Mantenimiento"} en ${abierta.titulo}${fotosTxt}${resumen}`);
    else await avisar(abierta, "mantenimiento", `💬 La arquitecta escribió en ${abierta.titulo}${fotosTxt}${resumen}`);

    setTexto("");
    setFotosMsg([]);
    setGuardando(false);
    const { data } = await supabase.from("reparacion_mensajes").select("*").eq("reparacion_id", abierta.id).order("created_at");
    setMensajes((data as Mensaje[]) || []);
    cargar();
  }

  const ETIQUETA_EVENTO: Partial<Record<Mensaje["tipo"], string>> = {
    terminada: "✅ La marcó como terminada",
    regresada: "↩️ La regresó para corregir",
    cerrada: "🏁 Cerró la reparación",
  };

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Reparaciones</p>
        <p className="rep-sub">{esMtto ? "Las reparaciones que tienes asignadas" : "Seguimiento de las reparaciones de mantenimiento"}</p>
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
            <div className="tickets-filtros" style={{ margin: 0 }}>
              {FILTROS.map((f) => (
                <button key={f.id} className={"filtro-chip" + (filtro === f.id ? " active" : "")} onClick={() => setFiltro(f.id)}>
                  {f.label} ({conteos[f.id] || 0})
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="search"
                className="ticket-admin-select"
                style={{ flex: "1 1 220px" }}
                placeholder="Buscar por reparación, oficina o centro"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              {esArqui && (
                <button className="btn-enviar" style={{ flex: "none", width: "auto", padding: "10px 18px", margin: 0 }} onClick={abrirNuevo}>
                  + Nueva reparación
                </button>
              )}
            </div>

            {error && <div className="empty-card">{error}</div>}
            {!error && visibles.length === 0 && (
              <div className="empty-card">
                {reparaciones.length > 0
                  ? "No hay reparaciones en esta vista."
                  : esArqui
                  ? "Todavía no hay reparaciones. Usa “+ Nueva reparación” o “Asignar a mantenimiento” desde un ticket."
                  : esMtto
                  ? "No tienes reparaciones asignadas."
                  : "Todavía no hay reparaciones."}
              </div>
            )}

            <div className="rp-lista">
              {visibles.map((r) => {
                const est = ESTADOS[r.estado];
                const alerta = alertaDe(r);
                const u = urgenciaInfo(r.urgencia);
                return (
                  <button key={r.id} type="button" className="rp-card" onClick={() => abrirDetalle(r)}>
                    <span className="rp-urgencia" style={{ background: u.color }} title={u.label} />
                    <div className="rp-card-cuerpo">
                      <div className="rp-card-top">
                        <p className="rp-titulo">{r.titulo}</p>
                        <span className="rp-badge" style={{ color: est.color, background: est.fondo }}>
                          {est.label}
                        </span>
                        {alerta && (
                          <span className="rp-badge" style={{ color: alerta.color, background: alerta.fondo }}>
                            {alerta.label}
                          </span>
                        )}
                      </div>
                      <p className="rp-meta">
                        {[r.oficina, r.centro, !esMtto && r.asignado_nombre ? `Asignada a ${r.asignado_nombre}` : "", r.fecha_compromiso ? `Para el ${fecha(r.fecha_compromiso)}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="rp-ultimo">
                        {r.estado === "cerrada" && r.cerrada_at
                          ? `Cerrada ${haceCuanto(r.cerrada_at)}`
                          : r.ultimo_avance_at
                          ? `Último avance ${haceCuanto(r.ultimo_avance_at)}`
                          : `Asignada ${haceCuanto(r.created_at)} · sin avances todavía`}
                      </p>
                    </div>
                    <span className="rp-ver">Ver seguimiento →</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ---------- Detalle: chat de seguimiento ---------- */}
      {abierta && (
        <div className="modal-overlay" onClick={() => !guardando && setAbierta(null)}>
          <div className="rp-chat" onClick={(e) => e.stopPropagation()}>
            {/* Encabezado */}
            <div className="rp-chat-header">
              <button type="button" className="rp-chat-cerrar" onClick={() => setAbierta(null)} disabled={guardando} aria-label="Cerrar">
                ←
              </button>
              <div className="rp-chat-avatar" style={{ background: urgenciaInfo(abierta.urgencia).color }}>
                🛠️
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="rp-chat-titulo">{abierta.titulo}</p>
                <p className="rp-chat-sub">
                  {[abierta.oficina, abierta.centro, esMtto ? "" : abierta.asignado_nombre, abierta.fecha_compromiso ? `para el ${fecha(abierta.fecha_compromiso)}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="rp-badge" style={{ color: ESTADOS[abierta.estado].color, background: ESTADOS[abierta.estado].fondo }}>
                {ESTADOS[abierta.estado].label}
              </span>
            </div>

            {/* El problema (se abre y cierra) */}
            <div className="rp-chat-problema">
              <button type="button" className="rp-chat-problema-btn" onClick={() => setVerProblema((v) => !v)}>
                <span>📋 El problema{abierta.fotos_urls.length ? ` · ${abierta.fotos_urls.length} foto${abierta.fotos_urls.length === 1 ? "" : "s"}` : ""}</span>
                <span>{verProblema ? "Ocultar ▲" : "Ver ▼"}</span>
              </button>
              {verProblema && (
                <div className="rp-chat-problema-cuerpo">
                  <p className="rp-descripcion">{abierta.descripcion || "Sin detalles."}</p>
                  {abierta.fotos_urls.length > 0 && (
                    <div className="rp-fotos">
                      {abierta.fotos_urls.map((f) => (
                        <ImagenPrivada key={f} src={f} alt="Foto del problema" className="rp-foto rp-foto-chica" onClick={() => abrirArchivo(f)} />
                      ))}
                    </div>
                  )}
                  {(esArqui || abierta.ticket_id) && (
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
                      {abierta.ticket_id && !esMtto && (
                        <Link href="/tickets" className="pp-link">
                          Viene de un ticket · ver Tickets
                        </Link>
                      )}
                      {esArqui && abierta.estado !== "cerrada" && (
                        <button type="button" className="pp-link" onClick={() => abrirEditar(abierta)}>
                          Editar
                        </button>
                      )}
                      {esArqui && (
                        <button type="button" className="pp-link" style={{ color: "#A32D2D" }} onClick={() => setBorrando(abierta)}>
                          Borrar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Conversación */}
            <div className="rp-chat-mensajes" ref={hiloRef}>
              <p className="rp-chat-sistema">
                {abierta.creado_por_nombre || "La arquitecta"} asignó esta reparación{abierta.asignado_nombre ? ` a ${abierta.asignado_nombre}` : ""} · {fechaHora(abierta.created_at)}
              </p>
              {cargandoHilo ? (
                <p className="rp-chat-sistema">Cargando…</p>
              ) : mensajes.length === 0 ? (
                <p className="rp-chat-sistema">{esMtto ? "Manda aquí tus avances con fotos 📷" : "Todavía no hay avances."}</p>
              ) : (
                mensajes.map((m, i) => {
                  const mio = m.autor_id === miId;
                  const evento = ETIQUETA_EVENTO[m.tipo];
                  const autor = m.autor_nombre || (m.autor_rol === "operaciones" ? "Arquitecta" : "Mantenimiento");
                  const dia = diaDe(m.created_at);
                  const nuevoDia = i === 0 || diaDe(mensajes[i - 1].created_at) !== dia;
                  const seguida = !nuevoDia && i > 0 && mensajes[i - 1].autor_id === m.autor_id && !ETIQUETA_EVENTO[mensajes[i - 1].tipo];
                  return (
                    <div key={m.id} style={{ display: "contents" }}>
                      {nuevoDia && <p className="rp-chat-dia">{dia}</p>}
                      {evento && (
                        <p className={"rp-chat-evento rp-chat-evento-" + m.tipo}>
                          {evento}
                          {mio ? "" : ` · ${autor}`}
                        </p>
                      )}
                      {(m.mensaje || m.fotos_urls.length > 0) && (
                        <div className={"rp-burbuja" + (mio ? " rp-burbuja-mia" : "") + (seguida ? " rp-burbuja-seguida" : "")}>
                          {!mio && !seguida && <p className="rp-burbuja-autor">{autor}</p>}
                          {m.fotos_urls.length > 0 && (
                            <div className={"rp-burbuja-fotos" + (m.fotos_urls.length === 1 ? " una" : "")}>
                              {m.fotos_urls.map((f) => (
                                <ImagenPrivada key={f} src={f} alt="Foto del avance" className="rp-burbuja-foto" onClick={() => abrirArchivo(f)} />
                              ))}
                            </div>
                          )}
                          {m.mensaje && <p className="rp-burbuja-texto">{m.mensaje}</p>}
                          <span className="rp-burbuja-hora">{hora(m.created_at)}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Acciones según el momento */}
            {esMtto && abierta.estado !== "terminada" && abierta.estado !== "cerrada" && (
              <div className="rp-chat-acciones">
                <span>¿Ya quedó? Adjunta foto de cómo quedó y márcala.</span>
                <button type="button" className="rp-chat-accion rp-chat-accion-verde" onClick={() => enviar("terminada")} disabled={guardando}>
                  ✅ Marcar como terminada
                </button>
              </div>
            )}
            {esMtto && abierta.estado === "terminada" && (
              <div className="rp-chat-acciones">
                <span>La marcaste como terminada; la arquitecta la está revisando.</span>
              </div>
            )}
            {esArqui && abierta.estado === "terminada" && (
              <div className="rp-chat-acciones rp-chat-acciones-revisar">
                <span>{abierta.asignado_nombre || "Mantenimiento"} la marcó como terminada. ¿Quedó bien?</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="rp-chat-accion rp-chat-accion-rojo" onClick={() => enviar("regresada")} disabled={guardando}>
                    ↩️ Regresar
                  </button>
                  <button type="button" className="rp-chat-accion rp-chat-accion-verde" onClick={() => enviar("cerrada")} disabled={guardando}>
                    🏁 Cerrar
                  </button>
                </div>
              </div>
            )}

            {/* Barra para escribir */}
            {abierta.estado !== "cerrada" && (esArqui || esMtto) ? (
              <div className="rp-chat-escribir">
                {previews.length > 0 && (
                  <div className="rp-chat-adjuntos">
                    {previews.map((src, i) => (
                      <div key={src} className="rp-chat-adjunto">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" />
                        <button type="button" onClick={() => setFotosMsg((l) => l.filter((_, j) => j !== i))} aria-label="Quitar foto">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {errorModal && <p className="rp-chat-error">{errorModal}</p>}
                <div className="rp-chat-barra">
                  <input
                    ref={inputFotosRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      const nuevas = Array.from(e.target.files || []);
                      setFotosMsg((l) => [...l, ...nuevas].slice(0, 6));
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="rp-chat-clip" onClick={() => inputFotosRef.current?.click()} disabled={guardando} aria-label="Adjuntar fotos" title="Adjuntar fotos">
                    📷
                  </button>
                  <textarea
                    className="rp-chat-input"
                    rows={1}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!guardando) enviar(esMtto ? "avance" : "mensaje");
                      }
                    }}
                    placeholder={esMtto ? "Escribe cómo va…" : abierta.estado === "terminada" ? "Comentario (obligatorio si la regresas)…" : "Escríbele a mantenimiento…"}
                  />
                  <button
                    type="button"
                    className="rp-chat-enviar"
                    onClick={() => enviar(esMtto ? "avance" : "mensaje")}
                    disabled={guardando || (!texto.trim() && fotosMsg.length === 0)}
                    aria-label="Enviar"
                    title="Enviar"
                  >
                    {guardando ? "…" : "➤"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rp-chat-acciones">
                <span>{abierta.estado === "cerrada" ? `Reparación cerrada${abierta.cerrada_at ? ` el ${fecha(abierta.cerrada_at)}` : ""}.` : "Solo consulta."}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Alta / edición ---------- */}
      {editando && (
        <div className="modal-overlay" onClick={() => !guardando && setEditando(null)}>
          <form className="modal-card pp-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
            <p className="modal-nombre">{editando === "nuevo" ? "Nueva reparación" : "Editar reparación"}</p>
            <p className="modal-email">
              {ticketOrigen && editando === "nuevo" ? "Viene de un ticket; revisa los datos y asígnala." : "A quien se la asignes le llega el aviso y sube sus avances aquí."}
            </p>
            <div className="pp-grid">
              <label>
                Centro
                <select value={form.centro} onChange={(e) => setForm({ ...form, centro: e.target.value })}>
                  {CENTROS_MTTO.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Oficina / área
                <input value={form.oficina} onChange={(e) => setForm({ ...form, oficina: e.target.value })} placeholder="Ej. Oficina 4, Baños P2" />
              </label>
              <label className="pp-ancho">
                ¿Qué hay que reparar?
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Fuga en lavabo del baño de hombres" required />
              </label>
              <label className="pp-ancho">
                Detalles
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué pasa, qué material hay, a quién buscar (opcional)" />
              </label>
              <label>
                Asignar a
                <select value={form.asignadoA} onChange={(e) => setForm({ ...form, asignadoA: e.target.value })}>
                  {personal.length === 0 && <option value="">No hay cuentas de Mantenimiento</option>}
                  {personal.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre || "Sin nombre"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fecha compromiso · opcional
                <input type="date" value={form.fechaCompromiso} onChange={(e) => setForm({ ...form, fechaCompromiso: e.target.value })} />
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
                    {nombreArchivo(u) || "foto"}{" "}
                    <button type="button" className="pp-link" style={{ color: "#A32D2D" }} onClick={() => setFotosActuales((l) => l.filter((x) => x !== u))}>
                      Quitar
                    </button>
                  </span>
                ))}
              </div>
            )}
            <FileDropzone files={fotos} onChange={setFotos} maxFiles={5} accept="image/*" etiquetaTipos="Fotos" compacto />

            {errorModal && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setEditando(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="submit" className="btn-aceptar" disabled={guardando}>
                {guardando ? "Guardando..." : editando === "nuevo" ? "Asignar reparación" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay" onClick={() => setBorrando(null)}>
          <div className="modal-card pp-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">¿Borrar esta reparación?</p>
            <p className="modal-email">
              {borrando.titulo} · {borrando.centro}. Se borra también todo su seguimiento.
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
