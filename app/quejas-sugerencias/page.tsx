"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";

type Item = {
  id: string;
  tipo: string;
  mensaje: string;
  fotos_urls: string[] | null;
  estado: string;
  respuesta: string | null;
  created_at: string;
};

const TIPOS = [
  {
    id: "queja",
    nombre: "Queja",
    icono: "/icons/queja.png",
    // Ícono de líneas negras: sin esto se pierde sobre el fondo navy
    // cuando la tarjeta está seleccionada.
    mono: true,
    desc: "Algo no salió como esperabas",
  },
  { id: "sugerencia", nombre: "Sugerencia", icono: "/icons/sugerencia.png", desc: "Una idea para mejorar" },
];

export default function QuejasSugerenciasPage() {
  const supabase = createClient();
  const [nombre, setNombre] = useState("Cliente");
  const [tipo, setTipo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [lightboxFotos, setLightboxFotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("nombre").eq("id", user.id).single();
    if (profile?.nombre) setNombre(profile.nombre);

    const { data } = await supabase
      .from("quejas_sugerencias")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setItems(data || []);
    setLoadingItems(false);
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!tipo || !mensaje.trim()) {
      setError("Selecciona si es queja o sugerencia y escribe tu mensaje");
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
      .select("nombre, empresa, centro")
      .eq("id", user.id)
      .single();

    const fotosUrls: string[] = [];
    for (const archivo of fotos) {
      const fileName = `queja-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
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

    const { error: insertError } = await supabase.from("quejas_sugerencias").insert({
      user_id: user.id,
      cliente_nombre: profile?.nombre,
      empresa: profile?.empresa,
      centro: profile?.centro,
      tipo,
      mensaje: mensaje.trim(),
      fotos_urls: fotosUrls.length > 0 ? fotosUrls : null,
    });

    if (insertError) {
      setError("No se pudo enviar tu mensaje. Intenta de nuevo.");
      setLoading(false);
      return;
    }

    await supabase.from("notificaciones").insert({
      centro: profile?.centro,
      tipo: "nueva_queja",
      mensaje: `${tipo === "queja" ? "📢 Nueva queja" : "💡 Nueva sugerencia"} de ${profile?.nombre || "un cliente"}${
        profile?.empresa ? ` (${profile.empresa})` : ""
      }`,
    });

    setTipo("");
    setMensaje("");
    setFotos([]);
    setLoading(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchItems();
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Quejas y Sugerencias</p>
        <p className="rep-sub">{nombre}</p>
      </div>

      <div className="sub-content">
        <p className="panel-section-label">Nuevo mensaje</p>
        <p className="sub-label">¿Qué nos quieres compartir?</p>
        <div className="categorias-row">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"categoria-card" + (tipo === t.id ? " active" : "")}
              onClick={() => setTipo(t.id)}
            >
              <img
                src={t.icono}
                alt=""
                className={"categoria-icono" + (t.mono ? " categoria-icono-mono" : "")}
              />
              <span className="categoria-nombre">{t.nombre}</span>
              <span className="categoria-desc">{t.desc}</span>
            </button>
          ))}
        </div>

        <form className="form-card" onSubmit={handleEnviar}>
          <textarea
            placeholder="Cuéntanos con detalle..."
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
          />

          <p className="sub-label">Agregar fotos (opcional)</p>
          <FileDropzone files={fotos} onChange={setFotos} maxFiles={5} />

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
                xmlns="http://www.w3.org/2000/svg"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Enviado</span>
            </span>
            <span className="btn-enviar-text">Enviar</span>
          </button>
        </form>

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          Mis mensajes
        </p>
        {loadingItems ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-card">Aún no has enviado nada</div>
        ) : (
          items.map((it) => (
            <div className="ticket-card" key={it.id}>
              <div className="ticket-top">
                <div className="ticket-icono">
                  <img
                    src={it.tipo === "queja" ? "/icons/queja.png" : "/icons/sugerencia.png"}
                    alt=""
                    className="icon-img-20"
                  />
                </div>
                <div className="ticket-info">
                  <p className="ticket-asunto">{it.tipo === "queja" ? "Queja" : "Sugerencia"}</p>
                  <p className="ticket-categoria">{new Date(it.created_at).toLocaleDateString("es-MX")}</p>
                </div>
                <span
                  className="estado-badge"
                  style={{
                    background:
                      it.estado === "resuelta" ? "#E1F5EE" : it.estado === "en_revision" ? "#FAEEDA" : "#E6F1FB",
                  }}
                >
                  {it.estado === "resuelta" ? "✓ Resuelta" : it.estado === "en_revision" ? "⏳ En revisión" : "📋 Enviada"}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "#444", margin: "8px 0 0" }}>{it.mensaje}</p>
              {it.fotos_urls && it.fotos_urls.length > 0 && (
                <div className="ticket-admin-foto-grid" style={{ marginTop: 8 }}>
                  {it.fotos_urls.map((url, i) => (
                    <img
                      key={url}
                      src={url}
                      alt={`Foto ${i + 1}`}
                      className="ticket-admin-foto-mini"
                      onClick={() => {
                        setLightboxFotos(it.fotos_urls as string[]);
                        setLightboxIndex(i);
                      }}
                    />
                  ))}
                </div>
              )}
              {it.respuesta && (
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
                  💬 {it.respuesta}
                </p>
              )}
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
