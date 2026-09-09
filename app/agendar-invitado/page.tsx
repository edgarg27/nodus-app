"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const HORAS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8am a 8pm

function formatHora(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function hoyISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type TipoSolicitud = "sala_juntas" | "coworking" | "oficina_privada" | "day_pass_coworking" | "day_pass_oficina_privada";

const TIPOS: { id: TipoSolicitud; icono: string; label: string; desc: string; esDayPass: boolean }[] = [
  {
    id: "sala_juntas",
    icono: "🤝",
    label: "Agendar sala de juntas",
    desc: "Reserva un horario para tu junta o reunión",
    esDayPass: false,
  },
  {
    id: "coworking",
    icono: "💻",
    label: "Agendar coworking",
    desc: "Aparta tu espacio en el área de coworking",
    esDayPass: false,
  },
  {
    id: "oficina_privada",
    icono: "🏢",
    label: "Agendar oficina privada",
    desc: "Solicita una oficina privada para tu equipo",
    esDayPass: false,
  },
  {
    id: "day_pass_coworking",
    icono: "🎫",
    label: "Day Pass — Coworking",
    desc: "Acceso de un día al área de coworking",
    esDayPass: true,
  },
  {
    id: "day_pass_oficina_privada",
    icono: "🎟️",
    label: "Day Pass — Oficina privada",
    desc: "Acceso de un día a una oficina privada",
    esDayPass: true,
  },
];

type Paso = "menu" | "datos" | "horario" | "enviado";

export default function AgendarInvitadoPage() {
  const supabase = createClient();
  const [paso, setPaso] = useState<Paso>("menu");
  const [tipo, setTipo] = useState<TipoSolicitud | null>(null);

  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    empresa: "",
    centro: CENTROS[0],
  });

  const [fechaDeseada, setFechaDeseada] = useState(hoyISO());
  const [horaInicio, setHoraInicio] = useState<number>(9);
  const [horaFin, setHoraFin] = useState<number>(10);
  const [notas, setNotas] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const tipoInfo = TIPOS.find((t) => t.id === tipo) || null;

  // Se recalcula cada vez que se entra al paso "enviado" para que cada
  // solicitud (incluida "Hacer otra solicitud") tenga su propia ráfaga.
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

  function elegirTipo(t: TipoSolicitud) {
    setTipo(t);
    setError("");
    setPaso("datos");
  }

  function continuarDespuesDeDatos(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.nombre.trim() || !form.telefono.trim() || !form.email.trim()) {
      setError("Nombre, teléfono y correo son obligatorios");
      return;
    }
    setPaso("horario");
  }

  async function enviarSolicitud() {
    if (!tipo) return;
    setError("");

    if (!tipoInfo?.esDayPass && horaFin <= horaInicio) {
      setError("La hora de fin debe ser después de la hora de inicio");
      return;
    }

    setEnviando(true);
    const { error: insertError } = await supabase.from("solicitudes_invitados").insert({
      tipo,
      centro: form.centro,
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim(),
      email: form.email.trim(),
      empresa: form.empresa.trim() || null,
      fecha_deseada: fechaDeseada || null,
      hora_inicio_deseada: tipoInfo?.esDayPass ? null : `${String(horaInicio).padStart(2, "0")}:00`,
      hora_fin_deseada: tipoInfo?.esDayPass ? null : `${String(horaFin).padStart(2, "0")}:00`,
      notas: notas.trim() || null,
      estado: "pendiente",
    });
    setEnviando(false);

    if (insertError) {
      setError("No se pudo enviar tu solicitud. Intenta de nuevo en un momento.");
      return;
    }

    // Best-effort: avisa al centro (campanita del panel + intento de correo
    // a los admins). Si esto falla, la solicitud ya quedó guardada de
    // todas formas — no bloqueamos la confirmación al invitado por esto.
    try {
      await fetch("/api/notificar-solicitud-invitado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, centro: form.centro, nombre: form.nombre.trim() }),
      });
    } catch {
      // no crítico
    }

    setPaso("enviado");
  }

  function reiniciar() {
    setPaso("menu");
    setTipo(null);
    setForm({ nombre: "", telefono: "", email: "", empresa: "", centro: CENTROS[0] });
    setFechaDeseada(hoyISO());
    setHoraInicio(9);
    setHoraFin(10);
    setNotas("");
    setError("");
  }

  return (
    <div className="panel">
      <div className="rep-header">
        {paso === "menu" ? (
          <a className="rep-back" href="/login">
            ← Regresar al login
          </a>
        ) : (
          <a
            className="rep-back"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (paso === "horario") setPaso("datos");
              else if (paso === "datos") setPaso("menu");
              else if (paso === "enviado") reiniciar();
            }}
          >
            ← Atrás
          </a>
        )}
        <p className="rep-title">Nodus Flex Center</p>
        <p className="rep-sub">
          {paso === "menu" && "¿Qué te gustaría hacer?"}
          {paso === "datos" && tipoInfo && `${tipoInfo.icono} ${tipoInfo.label}`}
          {paso === "horario" && tipoInfo && `${tipoInfo.icono} ${tipoInfo.label}`}
          {paso === "enviado" && "Solicitud enviada"}
        </p>
      </div>

      <div className="rep-content">
        {paso === "menu" && (
          <>
            <div className="invitado-intro">
              <span className="invitado-intro-icon">👋</span>
              <span>
                No necesitas cuenta para pedir esto — solo cuéntanos qué buscas y un centro se pondrá en contacto
                contigo.
              </span>
            </div>

            <p className="invitado-menu-group-label">Agendar una visita</p>
            <div className="invitado-menu-list">
              {TIPOS.filter((t) => !t.esDayPass).map((t) => (
                <button key={t.id} className="invitado-menu-item" onClick={() => elegirTipo(t.id)}>
                  <span className="invitado-menu-icon">{t.icono}</span>
                  <span className="invitado-menu-text">
                    <p className="invitado-menu-title">{t.label}</p>
                    <p className="invitado-menu-desc">{t.desc}</p>
                  </span>
                  <span className="invitado-menu-chevron">›</span>
                </button>
              ))}
            </div>

            <p className="invitado-menu-group-label">Day Pass</p>
            <div className="invitado-menu-list">
              {TIPOS.filter((t) => t.esDayPass).map((t) => (
                <button key={t.id} className="invitado-menu-item daypass" onClick={() => elegirTipo(t.id)}>
                  <span className="invitado-menu-icon">{t.icono}</span>
                  <span className="invitado-menu-text">
                    <p className="invitado-menu-title">{t.label}</p>
                    <p className="invitado-menu-desc">{t.desc}</p>
                  </span>
                  <span className="invitado-menu-chevron">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {paso === "datos" && (
          <form className="form-card" onSubmit={continuarDespuesDeDatos}>
            <p className="sub-label">Centro de tu interés</p>
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

            <p className="sub-label">Correo</p>
            <input
              type="email"
              placeholder="tu@correo.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <p className="sub-label">Empresa (opcional)</p>
            <input
              type="text"
              placeholder="Empresa"
              value={form.empresa}
              onChange={(e) => setForm({ ...form, empresa: e.target.value })}
            />

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" type="submit">
              Continuar
            </button>
          </form>
        )}

        {paso === "horario" && (
          <div className="form-card">
            <p className="sub-label">{tipoInfo?.esDayPass ? "Fecha del Day Pass" : "Fecha que te gustaría"}</p>
            <input type="date" min={hoyISO()} value={fechaDeseada} onChange={(e) => setFechaDeseada(e.target.value)} />

            {!tipoInfo?.esDayPass && (
              <>
                <p className="sub-label">Horario que te gustaría</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={horaInicio} onChange={(e) => setHoraInicio(Number(e.target.value))} style={{ flex: 1 }}>
                    {HORAS.map((h) => (
                      <option key={h} value={h}>
                        {formatHora(h)}
                      </option>
                    ))}
                  </select>
                  <span style={{ alignSelf: "center", color: "#888" }}>a</span>
                  <select value={horaFin} onChange={(e) => setHoraFin(Number(e.target.value))} style={{ flex: 1 }}>
                    {HORAS.map((h) => (
                      <option key={h} value={h}>
                        {formatHora(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <p className="sub-label">¿Algo más que debamos saber? (opcional)</p>
            <textarea placeholder="Comentarios" value={notas} onChange={(e) => setNotas(e.target.value)} />

            <div className="nota-info">
              ⏳ Esto es una solicitud, no una reservación confirmada. El centro revisará disponibilidad y te
              contactará para confirmar horario y, si aplica, forma de pago.
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={enviarSolicitud} disabled={enviando}>
              {enviando ? "Enviando..." : "Enviar solicitud"}
            </button>
          </div>
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
            <p className="exito-mensaje">
              Tu solicitud llegó a {form.centro}. Te contactaremos al {form.telefono || form.email} para confirmar
              todos los detalles.
            </p>
            <button className="exito-btn" onClick={reiniciar}>
              Hacer otra solicitud
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
