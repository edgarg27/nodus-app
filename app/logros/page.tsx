"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Logro = {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  banner_url: string | null;
  created_at: string;
};

export default function LogrosPage() {
  const supabase = createClient();
  const [nombre, setNombre] = useState("Cliente");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [logros, setLogros] = useState<Logro[]>([]);
  const [loadingLogros, setLoadingLogros] = useState(true);

  useEffect(() => {
    fetchLogros();
  }, []);

  async function fetchLogros() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("nombre").eq("id", user.id).single();
    if (profile?.nombre) setNombre(profile.nombre);

    const { data } = await supabase
      .from("logros")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setLogros(data || []);
    setLoadingLogros(false);
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!titulo.trim()) {
      setError("Ponle un título a tu logro");
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

    const { error: insertError } = await supabase.from("logros").insert({
      user_id: user.id,
      cliente_nombre: profile?.nombre,
      empresa: profile?.empresa,
      centro: profile?.centro,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
    });

    if (insertError) {
      setError("No se pudo enviar tu logro. Intenta de nuevo.");
      setLoading(false);
      return;
    }

    await supabase.from("notificaciones").insert({
      centro: profile?.centro,
      tipo: "nuevo_logro",
      mensaje: `🏆 ${profile?.empresa || profile?.nombre || "Un cliente"} compartió un logro: ${titulo.trim()}`,
    });

    setTitulo("");
    setDescripcion("");
    setLoading(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchLogros();
  }

  const ESTADO_INFO: Record<string, { label: string; bg: string }> = {
    pendiente: { label: "📋 Recibido", bg: "#E6F1FB" },
    en_diseno: { label: "🎨 En diseño", bg: "#FAEEDA" },
    publicado: { label: "🎉 ¡Publicado!", bg: "#E1F5EE" },
  };

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Logros</p>
        <p className="rep-sub">{nombre}</p>
      </div>

      <div className="sub-content">
        <div className="empty-card" style={{ textAlign: "left", color: "#444", lineHeight: 1.5 }}>
          🏆 Porque realmente nos importa que nuestra comunidad crezca y cumpla sus metas, este espacio es para
          que compartas los logros de tu empresa. Nuestro equipo de diseño preparará un banner para celebrarlo,
          y aparecerá en el carrusel de bienvenida de todos los clientes de Nodus Flex Center.
        </div>

        <p className="panel-section-label" style={{ marginTop: 12 }}>
          Comparte un logro
        </p>
        <form className="form-card" onSubmit={handleEnviar}>
          <input
            type="text"
            placeholder="Título (ej. Abrimos nuestra 3ra sucursal)"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <textarea
            placeholder="Cuéntanos un poco más (opcional)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />

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
              <span>¡Listo!</span>
            </span>
            <span className="btn-enviar-text">Compartir logro</span>
          </button>
        </form>

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          Mis logros compartidos
        </p>
        {loadingLogros ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : logros.length === 0 ? (
          <div className="empty-card">Aún no has compartido ningún logro</div>
        ) : (
          logros.map((l) => (
            <div className="item-card" key={l.id} style={{ alignItems: "flex-start" }}>
              <div className="item-card-info">
                <p className="item-card-titulo">🏆 {l.titulo}</p>
                {l.descripcion && <p className="item-card-sub">{l.descripcion}</p>}
                <p className="item-card-extra">{new Date(l.created_at).toLocaleDateString("es-MX")}</p>
                {l.banner_url && l.estado === "publicado" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.banner_url}
                    alt={l.titulo}
                    style={{ width: "100%", maxWidth: 280, borderRadius: 10, marginTop: 8, display: "block" }}
                  />
                )}
              </div>
              <span
                className="estado-badge"
                style={{ background: ESTADO_INFO[l.estado]?.bg || "#E6F1FB" }}
              >
                {ESTADO_INFO[l.estado]?.label || l.estado}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
