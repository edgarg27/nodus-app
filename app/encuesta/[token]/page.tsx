"use client";

import { useEffect, useMemo, useState } from "react";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

type Pregunta = { id: string; texto: string; tipo: "rating" | "texto" };

type Encuesta = {
  titulo: string;
  descripcion: string | null;
  preguntas: Pregunta[];
  nombreDestinatario: string;
  estado: "pendiente" | "respondida";
  respuestas: { pregunta_id: string; valor: string }[] | null;
};

export default function EncuestaPublicaPage({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [encuesta, setEncuesta] = useState<Encuesta | null>(null);
  const [error, setError] = useState("");
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const confettiEncuesta = useMemo(() => {
    if (!enviado) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enviado]);

  useEffect(() => {
    fetch(`/api/encuestas/${params.token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setEncuesta(data);
          if (data.estado === "respondida") setEnviado(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("No se pudo cargar la encuesta");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviarRespuestas() {
    if (!encuesta) return;
    const faltantes = encuesta.preguntas.filter((p) => !respuestas[p.id]?.trim());
    if (faltantes.length > 0) {
      setError("Responde todas las preguntas antes de enviar");
      return;
    }
    setError("");
    setEnviando(true);
    try {
      const res = await fetch(`/api/encuestas/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respuestas: encuesta.preguntas.map((p) => ({ pregunta_id: p.id, valor: respuestas[p.id] })),
        }),
      });
      if (!res.ok) throw new Error();
      setEnviado(true);
    } catch {
      setError("No se pudo enviar. Intenta de nuevo.");
    }
    setEnviando(false);
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="rep-content">
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !encuesta) {
    return (
      <div className="panel">
        <div className="rep-content">
          <div className="empty-card">{error}</div>
        </div>
      </div>
    );
  }

  if (!encuesta) return null;

  if (enviado) {
    return (
      <div className="panel">
        <div className="rep-content">
          <div className="exito-card">
            <div className="confetti">
              {confettiEncuesta.map((c) => (
                <span
                  key={c.id}
                  className="confetti-pieza"
                  style={{
                    left: `${c.left}%`,
                    background: c.color,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.duracion}s`,
                  }}
                />
              ))}
            </div>

            <div className="exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="exito-titulo">¡Gracias por tu respuesta!</p>
            <p className="exito-mensaje">Ya recibimos tu encuesta "{encuesta.titulo}".</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">{encuesta.titulo}</p>
        {encuesta.descripcion && <p className="rep-sub">{encuesta.descripcion}</p>}
      </div>

      <div className="rep-content">
        <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>Hola {encuesta.nombreDestinatario}, nos gustaría conocer tu opinión.</p>

        <div className="form-card">
          {encuesta.preguntas.map((p) => (
            <div key={p.id} style={{ marginBottom: 16 }}>
              <p className="sub-label">{p.texto}</p>
              {p.tipo === "rating" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="tel-borrar-btn"
                      style={{
                        fontWeight: 700,
                        color: respuestas[p.id] === String(n) ? "#fff" : "#0d1b3e",
                        background: respuestas[p.id] === String(n) ? "#0d1b3e" : "transparent",
                        borderRadius: 8,
                        padding: "6px 14px",
                      }}
                      onClick={() => setRespuestas({ ...respuestas, [p.id]: String(n) })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  value={respuestas[p.id] || ""}
                  onChange={(e) => setRespuestas({ ...respuestas, [p.id]: e.target.value })}
                />
              )}
            </div>
          ))}

          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

          <button className={"btn-enviar" + (enviando ? " sending" : "")} type="button" disabled={enviando} onClick={enviarRespuestas}>
            <span className="btn-enviar-icon-wrapper">
              <svg className="btn-enviar-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill="none" d="M0 0h24v24H0z"></path>
                <path fill="currentColor" d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path>
              </svg>
            </span>
            <span className="btn-enviar-text">Enviar respuestas</span>
          </button>
        </div>
      </div>
    </div>
  );
}
