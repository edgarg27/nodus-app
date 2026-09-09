"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";
import FileDropzone from "../soporte/FileDropzone";

type Ticket = {
  id: string;
  folio: string;
  asunto: string;
  descripcion: string;
  categoria: string;
  estado: string;
  urgencia: string | null;
  cliente_nombre: string | null;
  cliente_email: string | null;
  centro: string | null;
  foto_url: string | null;
  foto_urls: string[] | null;
  nota_staff: string | null;
  created_at: string;
};

type Comentario = {
  id: string;
  ticket_id: string;
  autor_nombre: string | null;
  autor_rol: string | null;
  mensaje: string | null;
  fotos_urls: string[] | null;
  created_at: string;
};

const URGENCIA_INFO: Record<string, { label: string; color: string; bg: string }> = {
  urgente: { label: "🔴 Urgente", color: "#A32D2D", bg: "#FCEBEB" },
  media: { label: "🟡 Media", color: "#8A6D00", bg: "#FEF6D8" },
  baja: { label: "🟢 No urgente", color: "#0F6E56", bg: "#E1F5EE" },
};

const FILTROS = [
  { id: "todos", label: "Todos" },
  { id: "abierto", label: "📋 Abiertos" },
  { id: "en_proceso", label: "⏳ En proceso" },
  { id: "cerrado", label: "✓ Resueltos" },
];

const CATEGORIAS = [
  { id: "todas", label: "Todas" },
  { id: "sistemas", label: "🖥️ Sistemas" },
  { id: "mantenimiento", label: "🔨 Mantenimiento" },
];

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "operaciones"];
const ROLES_EDITAN_ESTATUS = ["sistemas", "operaciones", "superadmin", "gerente"];

export default function TicketsPage() {
  const supabase = createClient();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("todos");
  const [categoria, setCategoria] = useState("todas");
  const [lightboxFotos, setLightboxFotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [esGlobal, setEsGlobal] = useState(false);
  const [miRol, setMiRol] = useState("");

  const puedeEditarEstatus = ROLES_EDITAN_ESTATUS.includes(miRol);

  const [mostrarFormReporte, setMostrarFormReporte] = useState(false);
  const [formReporte, setFormReporte] = useState({ asunto: "", descripcion: "", categoria: "sistemas" });
  const [guardandoReporte, setGuardandoReporte] = useState(false);
  const [reporteEnviado, setReporteEnviado] = useState(false);
  const [miNombre, setMiNombre] = useState("");
  const [miId, setMiId] = useState("");

  // Historial de comentarios por ticket (id de ticket -> lista, más viejo
  // primero) y el modal para responder/resolver con foto.
  const [comentarios, setComentarios] = useState<Record<string, Comentario[]>>({});
  const [modalTicket, setModalTicket] = useState<Ticket | null>(null);
  const [modalNuevoEstado, setModalNuevoEstado] = useState<string | null>(null);
  const [modalMensaje, setModalMensaje] = useState("");
  const [modalFotos, setModalFotos] = useState<File[]>([]);
  const [modalGuardando, setModalGuardando] = useState(false);
  const [comentarioEnviado, setComentarioEnviado] = useState(false);
  const [modalError, setModalError] = useState("");

  useEffect(() => {
    fetchTickets();
    // Si el navegador restaura esta página desde su caché (bfcache) al dar
    // "atrás", vuelve a pedir los datos frescos en vez de mostrar la foto
    // vieja que quedó pintada.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) fetchTickets();
    };
    window.addEventListener("pageshow", onPageShow);
    // Truco estándar de los navegadores: tener un listener de "unload" saca
    // a la página de la elegibilidad para bfcache, así que nunca vuelve a
    // reaparecer instantáneamente con datos de otra sesión/usuario — siempre
    // se vuelve a pedir todo de cero.
    const onUnload = () => {};
    window.addEventListener("unload", onUnload);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("unload", onUnload);
    };
  }, []);

  async function fetchTickets() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    let centroActual: string | null = null;
    let globalActual = false;
    let rolActual = "";
    if (user) {
      const { data: miProfile } = await supabase
        .from("profiles")
        .select("rol, centro, nombre")
        .eq("id", user.id)
        .single();
      centroActual = miProfile?.centro || null;
      globalActual = ROLES_GLOBALES.includes(miProfile?.rol || "");
      rolActual = miProfile?.rol || "";
      setMiCentro(centroActual);
      setEsGlobal(globalActual);
      setMiRol(rolActual);
      setMiId(user.id);
      setMiNombre(miProfile?.nombre || "");
    }

    let query = supabase
      .from("tickets")
      .select("*")
      .neq("asunto", "📶 Solicitud de nuevo WiFi")
      .order("created_at", { ascending: false });
    if (!globalActual && centroActual) {
      query = query.eq("centro", centroActual);
    }
    // Sistemas solo ve reportes de su categoría; operaciones solo mantenimiento
    if (rolActual === "sistemas") {
      query = query.eq("categoria", "sistemas");
    } else if (rolActual === "operaciones") {
      query = query.eq("categoria", "mantenimiento");
    }

    const { data } = await query;
    setTickets(data || []);

    // Trae el historial de comentarios de los tickets visibles. Si la
    // tabla todavía no existe (falta correr la migración), simplemente se
    // deja vacío en vez de tumbar la carga de tickets.
    if (data && data.length > 0) {
      const { data: comentariosData, error: comentariosError } = await supabase
        .from("ticket_comentarios")
        .select("*")
        .in(
          "ticket_id",
          data.map((t) => t.id)
        )
        .order("created_at", { ascending: true });
      if (!comentariosError) {
        const agrupados: Record<string, Comentario[]> = {};
        (comentariosData || []).forEach((c) => {
          if (!agrupados[c.ticket_id]) agrupados[c.ticket_id] = [];
          agrupados[c.ticket_id].push(c);
        });
        setComentarios(agrupados);
      }
    } else {
      setComentarios({});
    }

    setLoading(false);
  }

  const filtrados = useMemo(() => {
    let lista = tickets;
    if (categoria !== "todas") lista = lista.filter((t) => t.categoria === categoria);
    if (filtro !== "todos") lista = lista.filter((t) => t.estado === filtro);
    return lista;
  }, [filtro, categoria, tickets]);

  // Cuando el rol ve todos los centros (sistemas/superadmin), agrupamos
  // los tickets por centro para no mezclarlos en una sola lista
  const porCentro = useMemo(() => {
    if (!esGlobal) return null;
    const grupos: Record<string, Ticket[]> = {};
    filtrados.forEach((t) => {
      const key = t.centro || "Sin centro asignado";
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(t);
    });
    return Object.keys(grupos)
      .sort()
      .map((centro) => ({ centro, tickets: grupos[centro] }));
  }, [filtrados, esGlobal]);

  async function actualizarEstadoDirecto(id: string, estado: string) {
    // Solo se usa para volver a "abierto" — no necesita comentario.
    const { error: updateError } = await supabase.from("tickets").update({ estado }).eq("id", id);
    if (updateError) {
      alert(`No se pudo actualizar el reporte: ${updateError.message}`);
      return;
    }
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, estado } : t)));
  }

  function cambiarEstado(id: string, estado: string) {
    if (!puedeEditarEstatus) return;
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;
    if (estado === "en_proceso" || estado === "cerrado") {
      abrirModal(ticket, estado);
    } else {
      actualizarEstadoDirecto(id, estado);
    }
  }

  function abrirModal(ticket: Ticket, nuevoEstado?: string) {
    setModalTicket(ticket);
    setModalNuevoEstado(nuevoEstado || null);
    setModalMensaje("");
    setModalFotos([]);
    setModalError("");
  }

  function cerrarModal() {
    if (modalGuardando) return;
    setModalTicket(null);
    setModalNuevoEstado(null);
    setModalMensaje("");
    setModalFotos([]);
    setModalError("");
  }

  async function guardarComentario() {
    if (!modalTicket) return;
    if (!modalMensaje.trim() && modalFotos.length === 0) {
      setModalError("Escribe un comentario o adjunta al menos una foto");
      return;
    }
    setModalGuardando(true);
    setModalError("");

    // Sube las fotos del comentario al mismo bucket que usan los clientes
    // al levantar el reporte.
    const fotosUrls: string[] = [];
    for (const archivo of modalFotos) {
      const fileName = `comentario-${modalTicket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
        archivo.name.split(".").pop() || "jpg"
      }`;
      const { error: uploadError } = await supabase.storage
        .from("tickets")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("tickets").getPublicUrl(fileName);
        fotosUrls.push(urlData.publicUrl);
      }
    }

    const mensaje = modalMensaje.trim();

    const { data: comentarioInsertado, error: comentarioError } = await supabase
      .from("ticket_comentarios")
      .insert({
        ticket_id: modalTicket.id,
        autor_id: miId,
        autor_nombre: miNombre,
        autor_rol: miRol,
        mensaje: mensaje || null,
        fotos_urls: fotosUrls.length > 0 ? fotosUrls : null,
      })
      .select()
      .single();

    if (comentarioError) {
      setModalError(
        /ticket_comentarios/i.test(comentarioError.message || "")
          ? "Falta crear la tabla de comentarios en la base de datos (avísale a quien administra el sistema)."
          : "No se pudo guardar el comentario. Intenta de nuevo."
      );
      setModalGuardando(false);
      return;
    }

    setComentarios((prev) => ({
      ...prev,
      [modalTicket.id]: [...(prev[modalTicket.id] || []), comentarioInsertado as Comentario],
    }));

    if (modalNuevoEstado) {
      const updateData: { estado: string; notificado_resuelto?: boolean; nota_staff?: string } = {
        estado: modalNuevoEstado,
      };
      if (modalNuevoEstado === "cerrado") updateData.notificado_resuelto = false;
      if (mensaje) updateData.nota_staff = mensaje;

      const { error: updateError } = await supabase.from("tickets").update(updateData).eq("id", modalTicket.id);
      if (updateError) {
        setModalError(`El comentario se guardó, pero no se pudo actualizar el estatus: ${updateError.message}`);
        setModalGuardando(false);
        return;
      }
      setTickets((prev) => prev.map((t) => (t.id === modalTicket.id ? { ...t, ...updateData } : t)));

      if (modalTicket.centro) {
        await supabase.from("notificaciones").insert({
          centro: modalTicket.centro,
          tipo: modalNuevoEstado === "en_proceso" ? "ticket_en_proceso" : "ticket_resuelto",
          categoria: modalTicket.categoria,
          mensaje:
            modalNuevoEstado === "en_proceso"
              ? `Se está trabajando en el reporte ${modalTicket.folio}: ${modalTicket.asunto}${
                  mensaje ? ` — "${mensaje}"` : ""
                }`
              : `El reporte ${modalTicket.folio} (${modalTicket.asunto}) ya fue resuelto.${
                  mensaje ? ` — "${mensaje}"` : ""
                }`,
        });
      }

      if (modalNuevoEstado === "cerrado" && modalTicket.cliente_email) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              tipo: "ticket_resuelto",
              folio: modalTicket.folio,
              asunto: modalTicket.asunto,
              clienteEmail: modalTicket.cliente_email,
              clienteNombre: modalTicket.cliente_nombre,
              nota: mensaje || undefined,
              fotoUrls: fotosUrls,
            },
          });
        } catch {
          // no crítico
        }
      }
    } else if (modalTicket.centro) {
      // Comentario de seguimiento sin cambiar el estatus.
      await supabase.from("notificaciones").insert({
        centro: modalTicket.centro,
        tipo: "ticket_comentario",
        categoria: modalTicket.categoria,
        mensaje: `💬 Nueva respuesta en el reporte ${modalTicket.folio}: ${modalTicket.asunto}`,
      });
    }

    setModalGuardando(false);
    setComentarioEnviado(true);
    setTimeout(() => setComentarioEnviado(false), 1800);
    cerrarModal();
  }

  async function crearReporteStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!formReporte.asunto.trim() || !formReporte.descripcion.trim() || !miCentro) return;
    setGuardandoReporte(true);

    const { count } = await supabase.from("tickets").select("*", { count: "exact", head: true });
    const folio = `REP-${((count || 0) + 1).toString().padStart(4, "0")}`;

    await supabase.from("tickets").insert({
      user_id: miId,
      folio,
      asunto: formReporte.asunto,
      descripcion: formReporte.descripcion,
      categoria: formReporte.categoria,
      estado: "abierto",
      cliente_nombre: miNombre,
      centro: miCentro,
    });

    await supabase.from("notificaciones").insert({
      centro: miCentro,
      tipo: "nuevo_ticket",
      categoria: formReporte.categoria,
      mensaje: `${formReporte.categoria === "sistemas" ? "🖥️" : "🔨"} Nuevo reporte de ${miNombre}: ${formReporte.asunto}`,
    });

    // Igual que cuando lo levanta un cliente, se avisa por correo al área correspondiente
    try {
      await supabase.functions.invoke("send-email", {
        body: {
          tipo: "nuevo_ticket",
          categoria: formReporte.categoria,
          folio,
          asunto: formReporte.asunto,
          descripcion: formReporte.descripcion,
          clienteNombre: miNombre,
          centro: miCentro,
        },
      });
    } catch {
      // no crítico
    }

    setFormReporte({ asunto: "", descripcion: "", categoria: "sistemas" });
    setGuardandoReporte(false);
    setReporteEnviado(true);
    setTimeout(() => {
      setReporteEnviado(false);
      setMostrarFormReporte(false);
    }, 1400);
    fetchTickets();
  }

  const conteos = {
    todos: filtrados.length,
    abierto: tickets.filter((t) => t.estado === "abierto" && (categoria === "todas" || t.categoria === categoria)).length,
    en_proceso: tickets.filter((t) => t.estado === "en_proceso" && (categoria === "todas" || t.categoria === categoria)).length,
    cerrado: tickets.filter((t) => t.estado === "cerrado" && (categoria === "todas" || t.categoria === categoria)).length,
  };

  const badgeInfo = (estado: string) =>
    estado === "cerrado"
      ? { bg: "#E1F5EE", color: "#0F6E56", texto: "✓ Resuelto" }
      : estado === "en_proceso"
      ? { bg: "#FEF6D8", color: "#8A6D00", texto: "⏳ En proceso" }
      : { bg: "#E6F1FB", color: "#185FA5", texto: "📋 Abierto" };

  function renderTicket(t: Ticket) {
    const esUrgenteAbierto = t.urgencia === "urgente" && t.estado !== "cerrado";
    const esNuevo = t.estado === "abierto" && Date.now() - new Date(t.created_at).getTime() < 24 * 60 * 60 * 1000;
    return (
      <div
        className={"ticket-admin-card" + (esNuevo ? " ticket-nuevo" : "")}
        key={t.id}
        style={esUrgenteAbierto ? { borderLeft: "4px solid #A32D2D" } : undefined}
      >
        <div className="ticket-top">
          <div className="ticket-icono">
            <img
              src={t.categoria === "sistemas" ? "/icons/sistemas.png" : "/icons/mantenimiento.png"}
              alt=""
              className="icon-img-20"
            />
          </div>
          <div className="ticket-info">
            <p className="ticket-folio">
              {t.folio}
              {esNuevo && <span className="ticket-nuevo-badge">🆕 NUEVO</span>}
            </p>
            <p className="ticket-asunto">{t.asunto}</p>
            <p className="ticket-categoria">
              {t.cliente_nombre || t.cliente_email || "Cliente"} · {t.centro || "—"} ·{" "}
              {new Date(t.created_at).toLocaleDateString("es-MX")}
            </p>
            {t.urgencia && URGENCIA_INFO[t.urgencia] && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: URGENCIA_INFO[t.urgencia].bg,
                  color: URGENCIA_INFO[t.urgencia].color,
                }}
              >
                {URGENCIA_INFO[t.urgencia].label}
              </span>
            )}
          </div>
          {puedeEditarEstatus ? (
            <select
              className="ticket-admin-select"
              value={t.estado}
              onChange={(e) => cambiarEstado(t.id, e.target.value)}
            >
              <option value="abierto">📋 Abierto</option>
              <option value="en_proceso">⏳ En proceso</option>
              <option value="cerrado">✓ Resuelto</option>
            </select>
          ) : (
            <span
              className="estado-badge"
              style={{ background: badgeInfo(t.estado).bg, color: badgeInfo(t.estado).color, flexShrink: 0 }}
            >
              {badgeInfo(t.estado).texto}
            </span>
          )}
        </div>

        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>{t.descripcion}</p>

        {(() => {
          const fotos = t.foto_urls && t.foto_urls.length > 0 ? t.foto_urls : t.foto_url ? [t.foto_url] : [];
          if (fotos.length === 0) return null;
          if (fotos.length === 1) {
            return (
              <img
                src={fotos[0]}
                alt="Foto del reporte"
                className="ticket-admin-foto"
                onClick={() => {
                  setLightboxFotos(fotos);
                  setLightboxIndex(0);
                }}
              />
            );
          }
          return (
            <div className="ticket-admin-foto-grid">
              {fotos.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`Foto del reporte ${i + 1}`}
                  className="ticket-admin-foto-mini"
                  onClick={() => {
                    setLightboxFotos(fotos);
                    setLightboxIndex(i);
                  }}
                />
              ))}
            </div>
          );
        })()}

        {(() => {
          const hilo = comentarios[t.id] || [];
          // Nota vieja de antes de tener el historial de comentarios —
          // solo se muestra si el ticket todavía no tiene comentarios
          // nuevos, para no duplicar información.
          if (hilo.length === 0 && t.nota_staff) {
            return (
              <p
                style={{
                  fontSize: 12,
                  color: "#185FA5",
                  background: "#E6F1FB",
                  borderRadius: 8,
                  padding: "6px 10px",
                  margin: 0,
                }}
              >
                💬 Nota para el cliente: {t.nota_staff}
              </p>
            );
          }
          if (hilo.length === 0) return null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {hilo.map((c) => (
                <div className="ticket-comentario" key={c.id}>
                  <p className="ticket-comentario-meta">
                    {c.autor_rol === "sistemas" ? "🖥️" : c.autor_rol === "operaciones" ? "🔧" : "👤"}{" "}
                    {c.autor_nombre || "Staff"} · {new Date(c.created_at).toLocaleString("es-MX")}
                  </p>
                  {c.mensaje && <p className="ticket-comentario-msg">{c.mensaje}</p>}
                  {c.fotos_urls && c.fotos_urls.length > 0 && (
                    <div className="ticket-admin-foto-grid">
                      {c.fotos_urls.map((url, i) => (
                        <img
                          key={url}
                          src={url}
                          alt={`Foto del comentario ${i + 1}`}
                          className="ticket-admin-foto-mini"
                          onClick={() => {
                            setLightboxFotos(c.fotos_urls as string[]);
                            setLightboxIndex(i);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        {puedeEditarEstatus && (
          <button type="button" className="ticket-comentar-btn" onClick={() => abrirModal(t)}>
            💬 Agregar comentario
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Tickets</p>
        <p className="rep-sub">
          {loading
            ? ""
            : miRol === "operaciones"
            ? "Reportes de mantenimiento de todos los centros"
            : esGlobal
            ? "Reportes de sistemas y mantenimiento de todos los centros"
            : `Reportes de ${miCentro || "tu centro"}`}
        </p>
      </div>

      <div className="rep-content">
        {!loading && miRol !== "sistemas" && miRol !== "operaciones" && (
          <div className="tickets-filtros">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                className={"filtro-chip" + (categoria === c.id ? " active" : "")}
                onClick={() => setCategoria(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="tickets-filtros">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              className={"filtro-chip" + (filtro === f.id ? " active" : "")}
              onClick={() => setFiltro(f.id)}
            >
              {f.label} ({conteos[f.id as keyof typeof conteos]})
            </button>
          ))}
        </div>

        {!loading && !puedeEditarEstatus && (
          <p style={{ fontSize: 11, color: "#aaa", fontStyle: "italic" }}>
            Solo puedes ver el estatus de los reportes — solo sistemas y operaciones pueden cambiarlo.
          </p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn-exportar"
            onClick={() => {
              if (esGlobal) {
                const porCentroExport: Record<string, Record<string, any>[]> = {};
                filtrados.forEach((t) => {
                  const key = t.centro || "Sin centro";
                  if (!porCentroExport[key]) porCentroExport[key] = [];
                  porCentroExport[key].push({
                    Folio: t.folio,
                    Asunto: t.asunto,
                    Categoria: t.categoria,
                    Cliente: t.cliente_nombre || t.cliente_email || "",
                    Estado: t.estado,
                    Fecha: new Date(t.created_at).toLocaleDateString("es-MX"),
                  });
                });
                exportarExcelPorCentro("tickets", porCentroExport);
              } else {
                exportarExcel(
                  "tickets",
                  filtrados.map((t) => ({
                    Folio: t.folio,
                    Asunto: t.asunto,
                    Categoria: t.categoria,
                    Cliente: t.cliente_nombre || t.cliente_email || "",
                    Centro: t.centro || "",
                    Estado: t.estado,
                    Fecha: new Date(t.created_at).toLocaleDateString("es-MX"),
                  }))
                );
              }
            }}
          >
            📥 Exportar Excel
          </button>
          {!loading && miRol !== "sistemas" && miRol !== "operaciones" && (
            <button
              className="tel-borrar-btn"
              style={{ color: "#0d1b3e", fontWeight: 600 }}
              onClick={() => setMostrarFormReporte((v) => !v)}
            >
              {mostrarFormReporte ? "Cancelar" : "⚠️ Levantar reporte"}
            </button>
          )}
        </div>

        {mostrarFormReporte && !loading && miRol !== "sistemas" && miRol !== "operaciones" && (
          <form className="form-card" onSubmit={crearReporteStaff}>
            <p className="sub-label">Reportar algo que viste inusual en el centro</p>
            <select
              value={formReporte.categoria}
              onChange={(e) => setFormReporte({ ...formReporte, categoria: e.target.value })}
            >
              <option value="sistemas">🖥️ Sistemas</option>
              <option value="mantenimiento">🔨 Mantenimiento</option>
            </select>
            <input
              type="text"
              placeholder="Asunto"
              value={formReporte.asunto}
              onChange={(e) => setFormReporte({ ...formReporte, asunto: e.target.value })}
            />
            <textarea
              placeholder="Describe lo que viste..."
              value={formReporte.descripcion}
              onChange={(e) => setFormReporte({ ...formReporte, descripcion: e.target.value })}
            />
            <button
              className={
                "btn-enviar" + (guardandoReporte ? " sending" : "") + (reporteEnviado ? " sent" : "")
              }
              type="submit"
              disabled={guardandoReporte}
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
                <span>Enviado</span>
              </span>
              <span className="btn-enviar-text">Enviar reporte</span>
            </button>
          </form>
        )}

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
        ) : filtrados.length === 0 ? (
          <div className="empty-card">Sin reportes en esta categoría</div>
        ) : (
          <>
            {(() => {
              const recientes = [...filtrados]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 5);
              return (
                <div style={{ marginBottom: 20 }}>
                  <p className="panel-section-label">🆕 Recientes</p>
                  {recientes.map((t) => renderTicket(t))}
                </div>
              );
            })()}

            {porCentro ? (
              porCentro.map(({ centro, tickets: ticketsDelCentro }) => (
                <div key={centro} style={{ marginBottom: 16 }}>
                  <p className="panel-section-label" style={{ marginTop: 12 }}>
                    🏢 {centro} ({ticketsDelCentro.length})
                  </p>
                  {ticketsDelCentro.map((t) => renderTicket(t))}
                </div>
              ))
            ) : (
              filtrados.map((t) => renderTicket(t))
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

      {modalTicket && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div style={{ flex: 1 }}>
                <p className="modal-nombre">
                  {modalNuevoEstado === "cerrado"
                    ? "Marcar como resuelto"
                    : modalNuevoEstado === "en_proceso"
                    ? "Marcar en proceso"
                    : "Agregar comentario"}
                </p>
                <p className="modal-email">
                  {modalTicket.folio} · {modalTicket.asunto}
                </p>
              </div>
              <button className="modal-cerrar" onClick={cerrarModal} disabled={modalGuardando}>
                ✕
              </button>
            </div>

            <textarea
              className="modal-textarea"
              placeholder={
                modalNuevoEstado
                  ? "Cuéntale al cliente qué pasó (se le va a mostrar)..."
                  : "Escribe un comentario de seguimiento..."
              }
              value={modalMensaje}
              onChange={(e) => setModalMensaje(e.target.value)}
            />

            <p className="sub-label">Fotos (opcional, máx. 5)</p>
            <FileDropzone files={modalFotos} onChange={setModalFotos} maxFiles={5} accept="image/*" />

            {modalError && <p style={{ color: "#A32D2D", fontSize: 13 }}>{modalError}</p>}

            <button
              className={"btn-enviar" + (modalGuardando ? " sending" : "") + (comentarioEnviado ? " sent" : "")}
              onClick={guardarComentario}
              disabled={modalGuardando}
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
              <span className="btn-enviar-text">
                {modalNuevoEstado ? "Guardar y actualizar estatus" : "Guardar comentario"}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
