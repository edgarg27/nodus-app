"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "./FileDropzone";

type Ticket = {
  id: string;
  folio: string;
  asunto: string;
  descripcion: string;
  categoria: string;
  estado: string;
  urgencia: string | null;
  nota_staff: string | null;
  created_at: string;
};

type Comentario = {
  id: string;
  ticket_id: string;
  autor_rol: string | null;
  mensaje: string | null;
  fotos_urls: string[] | null;
  created_at: string;
};

const categorias = [
  { id: "sistemas", nombre: "Sistemas", icono: "/icons/sistemas.png", desc: "Internet, telefonía, computadoras" },
  { id: "mantenimiento", nombre: "Mantenimiento", icono: "/icons/mantenimiento.png", desc: "Muebles, puertas, mobiliario" },
];

const URGENCIAS = [
  { id: "urgente", label: "🔴 Urgente", desc: "Necesita atención inmediata", color: "#A32D2D", bg: "#FCEBEB" },
  { id: "media", label: "🟡 Media", desc: "Puede esperar un poco", color: "#8A6D00", bg: "#FEF6D8" },
  { id: "baja", label: "🟢 No urgente", desc: "Sin prisa", color: "#0F6E56", bg: "#E1F5EE" },
];

export default function SoportePage() {
  const supabase = createClient();
  const [nombre, setNombre] = useState("Cliente");
  const [asunto, setAsunto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [comentarios, setComentarios] = useState<Record<string, Comentario[]>>({});
  const [lightboxFotos, setLightboxFotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  async function fetchTickets() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre")
      .eq("id", user.id)
      .single();
    if (profile?.nombre) setNombre(profile.nombre);

    const { data } = await supabase
      .from("tickets")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setTickets(data || []);

    // Respuestas del staff (con fotos) — si la tabla todavía no existe
    // simplemente se deja vacío, no rompe la lista de reportes.
    if (data && data.length > 0) {
      const { data: comentariosData, error: comentariosError } = await supabase
        .from("ticket_comentarios")
        .select("id, ticket_id, autor_rol, mensaje, fotos_urls, created_at")
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
    }

    setLoadingTickets(false);
  }

  async function generarFolio() {
    const { count } = await supabase.from("tickets").select("*", { count: "exact", head: true });
    const numero = ((count || 0) + 1).toString().padStart(4, "0");
    return `REP-${numero}`;
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!categoria || !asunto || !descripcion) {
      setError("Por favor completa todos los campos y selecciona una categoría");
      return;
    }
    if (!urgencia) {
      setError("Selecciona qué tan urgente es tu reporte");
      return;
    }
    if (categoria === "mantenimiento" && fotos.length === 0) {
      setError("Para reportes de mantenimiento es obligatorio adjuntar al menos una foto del problema");
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sesión expirada, vuelve a iniciar sesión");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre, email, centro")
      .eq("id", user.id)
      .single();

    const folio = await generarFolio();

    // Sube cada archivo al bucket "tickets" y junta las URLs públicas.
    // Si alguno falla, simplemente se omite (best-effort) en vez de
    // tumbar todo el envío del reporte.
    const fotosUrls: string[] = [];
    for (const archivo of fotos) {
      const fileName = `${folio}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
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
    const fotoUrl = fotosUrls[0] || null;

    let { error: insertError } = await supabase.from("tickets").insert({
      user_id: user.id,
      folio,
      asunto,
      descripcion,
      categoria,
      estado: "abierto",
      urgencia,
      cliente_nombre: profile?.nombre,
      cliente_email: profile?.email,
      centro: profile?.centro,
      foto_url: fotoUrl,
      foto_urls: fotosUrls.length > 0 ? fotosUrls : null,
    });

    // Si todavía no corriste la migración que agrega la columna
    // "foto_urls" (ver nota en TASKS), reintenta sin ese campo para que
    // el envío del reporte no se rompa mientras tanto.
    if (insertError && /foto_urls/i.test(insertError.message || "")) {
      ({ error: insertError } = await supabase.from("tickets").insert({
        user_id: user.id,
        folio,
        asunto,
        descripcion,
        categoria,
        estado: "abierto",
        urgencia,
        cliente_nombre: profile?.nombre,
        cliente_email: profile?.email,
        centro: profile?.centro,
        foto_url: fotoUrl,
      }));
    }

    if (insertError) {
      setError("No se pudo enviar el reporte. Intenta de nuevo.");
      setLoading(false);
      return;
    }

    // Notificación dentro de la app (campanita) para el staff correspondiente
    await supabase.from("notificaciones").insert({
      centro: profile?.centro,
      tipo: "nuevo_ticket",
      categoria,
      mensaje: `${categoria === "sistemas" ? "🖥️" : "🔨"} ${urgencia === "urgente" ? "🔴 URGENTE — " : ""}Nuevo reporte de ${
        profile?.nombre || "un cliente"
      }: ${asunto}`,
    });

    // Notificación por correo (best-effort, no bloquea si falla)
    try {
      await supabase.functions.invoke("send-email", {
        body: {
          tipo: "nuevo_ticket",
          categoria,
          urgencia,
          folio,
          asunto,
          descripcion,
          clienteNombre: profile?.nombre,
          clienteEmail: profile?.email,
          centro: profile?.centro,
          fotoUrl,
          fotoUrls: fotosUrls,
        },
      });
    } catch {
      // no crítico
    }

    setAsunto("");
    setDescripcion("");
    setCategoria("");
    setUrgencia("");
    setFotos([]);
    setLoading(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTickets();
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Soporte y Mantenimiento</p>
        <p className="rep-sub">{nombre}</p>
      </div>

      <div className="sub-content">
        <p className="panel-section-label">Nuevo reporte</p>
        <p className="sub-label">Selecciona el área</p>
        <div className="categorias-row">
          {categorias.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"categoria-card" + (categoria === c.id ? " active" : "")}
              onClick={() => setCategoria(c.id)}
            >
              <img src={c.icono} alt="" className="categoria-icono" />
              <span className="categoria-nombre">{c.nombre}</span>
              <span className="categoria-desc">{c.desc}</span>
            </button>
          ))}
        </div>

        <form className="form-card" onSubmit={handleEnviar}>
          <input
            type="text"
            placeholder="Asunto del problema"
            value={asunto}
            onChange={(e) => setAsunto(e.target.value)}
          />
          <textarea
            placeholder="Describe el problema con detalle..."
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />

          <p className="sub-label">¿Qué tan urgente es?</p>
          <div className="categorias-row">
            {URGENCIAS.map((u) => (
              <button
                key={u.id}
                type="button"
                className="categoria-card"
                style={
                  urgencia === u.id
                    ? { borderColor: u.color, background: u.bg, borderWidth: 1.5 }
                    : undefined
                }
                onClick={() => setUrgencia(u.id)}
              >
                <span
                  className="categoria-nombre"
                  style={urgencia === u.id ? { color: u.color } : undefined}
                >
                  {u.label}
                </span>
                <span
                  className="categoria-desc"
                  style={urgencia === u.id ? { color: u.color, opacity: 0.8 } : undefined}
                >
                  {u.desc}
                </span>
              </button>
            ))}
          </div>

          <p className="sub-label">
            {categoria === "mantenimiento" ? "Agregar fotos (obligatorio)*" : "Agregar fotos (opcional)"}
          </p>
          <FileDropzone files={fotos} onChange={setFotos} maxFiles={5} accept="image/*" />

          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

          <button
            className={"btn-enviar" + (loading ? " sending" : "") + (enviado ? " sent" : "")}
            type="submit"
            disabled={loading}
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

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          Mis reportes
        </p>
        {loadingTickets ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-card">🎉 Sin reportes activos</div>
        ) : (
          tickets.map((t) => (
            <div
              className="ticket-card"
              key={t.id}
              style={
                t.urgencia === "urgente"
                  ? { borderLeft: "4px solid #A32D2D" }
                  : undefined
              }
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
                  <p className="ticket-folio">{t.folio}</p>
                  <p className="ticket-asunto">{t.asunto}</p>
                  <p className="ticket-categoria">
                    {t.categoria === "sistemas" ? "Sistemas" : "Mantenimiento"}
                    {t.urgencia && (
                      <>
                        {" · "}
                        {URGENCIAS.find((u) => u.id === t.urgencia)?.label || t.urgencia}
                      </>
                    )}
                  </p>
                </div>
                <span
                  className="estado-badge"
                  style={{
                    background:
                      t.estado === "cerrado"
                        ? "#E1F5EE"
                        : t.estado === "en_proceso"
                        ? "#FAEEDA"
                        : "#E6F1FB",
                  }}
                >
                  {t.estado === "cerrado"
                    ? "✓ Resuelto"
                    : t.estado === "en_proceso"
                    ? "⏳ En proceso"
                    : "📋 Abierto"}
                </span>
              </div>
              {(() => {
                const hilo = comentarios[t.id] || [];
                if (hilo.length === 0 && t.nota_staff) {
                  return (
                    <p
                      style={{
                        fontSize: 12,
                        color: "#185FA5",
                        background: "#E6F1FB",
                        borderRadius: 8,
                        padding: "6px 10px",
                        margin: "8px 0 0",
                      }}
                    >
                      💬 {t.nota_staff}
                    </p>
                  );
                }
                if (hilo.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {hilo.map((c) => (
                      <div className="ticket-comentario" key={c.id}>
                        <p className="ticket-comentario-meta">
                          {c.autor_rol === "sistemas" ? "🖥️ Sistemas" : "🔧 Mantenimiento"} ·{" "}
                          {new Date(c.created_at).toLocaleString("es-MX")}
                        </p>
                        {c.mensaje && <p className="ticket-comentario-msg">{c.mensaje}</p>}
                        {c.fotos_urls && c.fotos_urls.length > 0 && (
                          <div className="ticket-admin-foto-grid">
                            {c.fotos_urls.map((url, i) => (
                              <img
                                key={url}
                                src={url}
                                alt={`Foto de la respuesta ${i + 1}`}
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
            </div>
          ))
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
    </div>
  );
}
