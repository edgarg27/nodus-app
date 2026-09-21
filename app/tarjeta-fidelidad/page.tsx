"use client";

import { useMemo, useState } from "react";
import FidelidadCard from "@/app/components/FidelidadCard";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Paso = "intro" | "datos" | "enviado";

export default function TarjetaFidelidadPage() {
  const [paso, setPaso] = useState<Paso>("intro");

  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    centro: CENTROS[0],
  });

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [folio, setFolio] = useState<number | null>(null);

  const confetti = useMemo(() => {
    if (paso !== "enviado") return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  async function pedirTarjeta(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.nombre.trim() || !form.telefono.trim()) {
      setError("Nombre y teléfono son obligatorios");
      return;
    }

    setEnviando(true);
    let data: { folio: number } | null = null;
    try {
      const res = await fetch("/api/tarjeta-fidelidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centro: form.centro,
          nombre: form.nombre.trim(),
          telefono: form.telefono.trim(),
          email: form.email.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.folio) data = { folio: json.folio };
      else if (json.error) {
        setEnviando(false);
        setError(json.error);
        return;
      }
    } catch {
      // cae al mensaje genérico de abajo
    }
    setEnviando(false);

    if (!data) {
      setError("No se pudo crear tu tarjeta. Intenta de nuevo en un momento.");
      return;
    }

    setFolio(data.folio);

    // Best-effort: avisa al centro + intenta correo con el folio.
    try {
      await fetch("/api/notificar-tarjeta-fidelidad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centro: form.centro,
          nombre: form.nombre.trim(),
          folio: data.folio,
          email: form.email.trim() || undefined,
        }),
      });
    } catch {
      // no crítico
    }

    setPaso("enviado");
  }

  function reiniciar() {
    setPaso("intro");
    setForm({ nombre: "", telefono: "", email: "", centro: CENTROS[0] });
    setError("");
    setFolio(null);
  }

  const folioMostrar = folio ? "NODUS-FID-" + String(folio).padStart(6, "0") : "";

  return (
    <div className="panel">
      <div className="rep-header">
        {paso === "intro" ? (
          <a className="rep-back" href="/agendar-invitado">
            ← Regresar
          </a>
        ) : (
          <a
            className="rep-back"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (paso === "datos") setPaso("intro");
              else if (paso === "enviado") reiniciar();
            }}
          >
            ← Atrás
          </a>
        )}
        <p className="rep-title">Nodus Flex Center</p>
        <p className="rep-sub">
          {paso === "intro" && "Tarjeta de fidelidad"}
          {paso === "datos" && "Pide tu tarjeta"}
          {paso === "enviado" && "¡Tarjeta creada!"}
        </p>
      </div>

      <div className="rep-content">
        {paso === "intro" && (
          <>
            <div className="invitado-intro">
              <img src="/images/icons/tarjeta-fidelidad.png" alt="" className="invitado-intro-icon-img" />
              <span>
                ¿Eres cliente frecuente? Junta 8 sellos por tus rentas y la 9ª casilla es un regalo — de lo que más
                hayas rentado.
              </span>
            </div>

            <FidelidadCard />
            <p className="fidelidad-card-nota" style={{ color: "#8b93a7" }}>
              La casilla 9 es gratis: el espacio que más hayas rentado en tus 8 visitas
            </p>

            <button className="reservar-btn" onClick={() => setPaso("datos")}>
              Pedir mi tarjeta
            </button>
          </>
        )}

        {paso === "datos" && (
          <form className="form-card" onSubmit={pedirTarjeta}>
            <p className="sub-label">Centro de tu preferencia</p>
            <select value={form.centro} onChange={(e) => setForm({ ...form, centro: e.target.value })}>
              {CENTROS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <p className="sub-label">Nombre</p>
            <input
              type="text"
              placeholder="Tu nombre completo"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />

            <p className="sub-label">Teléfono</p>
            <input
              type="tel"
              placeholder="Número celular"
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            />

            <p className="sub-label">Correo (opcional)</p>
            <input
              type="email"
              placeholder="tu@correo.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <div className="nota-info">
              🎟️ Al llegar al centro, dale tu folio al staff para que registre tu sello en cada visita.
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" type="submit" disabled={enviando}>
              {enviando ? "Creando..." : "Crear mi tarjeta"}
            </button>
          </form>
        )}

        {paso === "enviado" && (
          <div className="exito-card">
            <div className="confetti">
              {confetti.map((c) => (
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
            <p className="exito-titulo">¡Listo, {form.nombre.split(" ")[0]}!</p>
            <p className="fidelidad-folio-box">
              <span className="fidelidad-folio-label">Tu folio</span>
              <span className="fidelidad-folio-valor">{folioMostrar}</span>
            </p>
            <p className="exito-mensaje">
              Guarda este folio — es lo que usarás para identificarte y sellar tu tarjeta en cada visita. También te
              lo mandamos por correo si nos lo diste.
            </p>
            <a className="exito-btn" href="/tarjeta-fidelidad/consultar" style={{ display: "inline-block", textAlign: "center" }}>
              Consultar mi tarjeta
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
