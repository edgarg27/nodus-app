"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ConsultaTarjetaFidelidad from "@/app/components/ConsultaTarjetaFidelidad";
import { WHATSAPP_MOSTRAR, whatsappUrl } from "@/lib/contacto";

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

// `icono` es la ruta a un icono real (ver /public/images/icons), no un emoji.
// Sala de juntas, coworking, oficina privada y working desk se cotizan por
// WhatsApp: el chatbot toma los datos y una administradora del centro
// trabaja la cotización.
const SERVICIOS_WHATSAPP: { icono: string; label: string; desc: string; mensaje: string }[] = [
  {
    icono: "/images/icons/sala-juntas.png",
    label: "Agendar sala de juntas",
    desc: "Reserva un horario para tu junta o reunión",
    mensaje: "Hola, quiero agendar una sala de juntas en Nodus Flex Center.",
  },
  {
    icono: "/images/icons/coworking.png",
    label: "Agendar coworking",
    desc: "Aparta tu espacio en el área de coworking",
    mensaje: "Hola, quiero agendar un espacio de coworking en Nodus Flex Center.",
  },
  {
    icono: "/images/icons/oficina-privada.png",
    label: "Agendar oficina privada",
    desc: "Solicita una oficina privada para tu equipo",
    mensaje: "Hola, quiero cotizar una oficina privada en Nodus Flex Center.",
  },
  {
    icono: "/images/icons/working-desk.png",
    label: "Agendar working desk",
    desc: "Aparta tu escritorio individual",
    mensaje: "Hola, quiero agendar un working desk en Nodus Flex Center.",
  },
];

// El Day Pass sí se pide aquí mismo: la solicitud llega a la pestaña
// Invitados del centro, donde se genera el pase.
type TipoDayPass = "day_pass_coworking" | "day_pass_oficina_privada" | "day_pass_working_desk";

const DAY_PASSES: { id: TipoDayPass; icono: string; label: string; desc: string }[] = [
  {
    id: "day_pass_coworking",
    icono: "/images/icons/coworking.png",
    label: "Day Pass — Coworking",
    desc: "Acceso de un día al área de coworking",
  },
  {
    id: "day_pass_oficina_privada",
    icono: "/images/icons/oficina-privada.png",
    label: "Day Pass — Oficina privada",
    desc: "Acceso de un día a una oficina privada",
  },
  {
    id: "day_pass_working_desk",
    icono: "/images/icons/working-desk.png",
    label: "Day Pass — Working Desk",
    desc: "Acceso de un día a un escritorio individual",
  },
];

type Paso = "menu" | "datos" | "horario" | "enviado";

export default function AgendarInvitadoPage() {
  const supabase = createClient();
  const [paso, setPaso] = useState<Paso>("menu");
  const [tipo, setTipo] = useState<TipoDayPass | null>(null);

  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    empresa: "",
    centro: CENTROS[0],
  });

  const [fechaDeseada, setFechaDeseada] = useState(hoyISO());
  const [horaLlegada, setHoraLlegada] = useState<number>(9);
  const [notas, setNotas] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const tipoInfo = DAY_PASSES.find((t) => t.id === tipo) || null;

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

  function elegirDayPass(t: TipoDayPass) {
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

    const horaInicio = `${String(horaLlegada).padStart(2, "0")}:00`;

    setEnviando(true);
    const { error: insertError } = await supabase.from("solicitudes_invitados").insert({
      tipo,
      centro: form.centro,
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim(),
      email: form.email.trim(),
      empresa: form.empresa.trim() || null,
      fecha_deseada: fechaDeseada || null,
      duracion_tipo: "dia",
      fecha_fin_deseada: null,
      // Solo hora de llegada aproximada (el pase es de todo el día).
      hora_inicio_deseada: horaInicio,
      hora_fin_deseada: null,
      notas: notas.trim() || null,
      estado: "pendiente",
    });
    setEnviando(false);

    if (insertError) {
      setError("No se pudo enviar tu solicitud. Intenta de nuevo en un momento.");
      return;
    }

    // Best-effort: avisa al centro (campanita del panel + correo a los
    // admins). Si esto falla, la solicitud ya quedó guardada de todas
    // formas — no bloqueamos la confirmación al invitado por esto.
    try {
      await fetch("/api/notificar-solicitud-invitado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          centro: form.centro,
          nombre: form.nombre.trim(),
          telefono: form.telefono.trim(),
          email: form.email.trim(),
          empresa: form.empresa.trim() || undefined,
          fecha: fechaDeseada || undefined,
          duracion: "dia",
          horaInicio,
          notas: notas.trim() || undefined,
        }),
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
    setHoraLlegada(9);
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
          {(paso === "datos" || paso === "horario") && tipoInfo && tipoInfo.label}
          {paso === "enviado" && "Solicitud enviada"}
        </p>
      </div>

      <div className="rep-content">
        {paso === "menu" && (
          <>
            <div className="invitado-intro">
              <span className="invitado-intro-icon">💬</span>
              <span>
                No necesitas cuenta. Para agendar, elige lo que buscas y te llevamos a nuestro chatbot de WhatsApp (
                {WHATSAPP_MOSTRAR}): te tomará tus datos y una de las administradoras de cada centro trabajará tu
                cotización y se pondrá en contacto contigo.
              </span>
            </div>

            <p className="invitado-menu-group-label">Agendar una visita</p>
            <div className="invitado-menu-list">
              {SERVICIOS_WHATSAPP.map((s) => (
                <a
                  key={s.label}
                  className="invitado-menu-item"
                  href={whatsappUrl(s.mensaje)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="invitado-menu-icon">
                    <img src={s.icono} alt="" className="invitado-menu-icon-img" />
                  </span>
                  <span className="invitado-menu-text">
                    <p className="invitado-menu-title">{s.label}</p>
                    <p className="invitado-menu-desc">{s.desc}</p>
                  </span>
                  <span className="invitado-menu-chevron">›</span>
                </a>
              ))}
            </div>

            <p className="invitado-menu-group-label">Day Pass</p>
            <div className="invitado-menu-list">
              {DAY_PASSES.map((t) => (
                <button key={t.id} className="invitado-menu-item daypass" onClick={() => elegirDayPass(t.id)}>
                  <span className="invitado-menu-icon">
                    <img src={t.icono} alt="" className="invitado-menu-icon-img" />
                  </span>
                  <span className="invitado-menu-text">
                    <p className="invitado-menu-title">{t.label}</p>
                    <p className="invitado-menu-desc">{t.desc}</p>
                  </span>
                  <span className="invitado-menu-chevron">›</span>
                </button>
              ))}
            </div>

            <a className="invitado-menu-item daypass" href="/tarjeta-fidelidad">
              <span className="invitado-menu-icon">
                <img src="/images/icons/tarjeta-fidelidad.png" alt="" className="invitado-menu-icon-img" />
              </span>
              <span className="invitado-menu-text">
                <p className="invitado-menu-title">¿Eres cliente frecuente?</p>
                <p className="invitado-menu-desc">Pide o consulta tu tarjeta de fidelidad</p>
              </span>
              <span className="invitado-menu-chevron">›</span>
            </a>
          </>
        )}

        {paso === "datos" && (
          <form className="form-card" onSubmit={continuarDespuesDeDatos}>
            <p className="sub-label" style={{ color: "#f07e3a", fontWeight: 700 }}>
              Paso 1 de 2 · Tus datos (en el siguiente paso eliges fecha y horario)
            </p>
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
            <p className="sub-label" style={{ color: "#f07e3a", fontWeight: 700 }}>
              Paso 2 de 2 · Fecha y horario
            </p>

            <p className="sub-label">Fecha del Day Pass</p>
            <input type="date" min={hoyISO()} value={fechaDeseada} onChange={(e) => setFechaDeseada(e.target.value)} />

            <p className="sub-label">Hora de llegada aproximada</p>
            <select value={horaLlegada} onChange={(e) => setHoraLlegada(Number(e.target.value))}>
              {HORAS.map((h) => (
                <option key={h} value={h}>
                  {formatHora(h)}
                </option>
              ))}
            </select>

            <p className="sub-label">¿Algo más que debamos saber? (opcional)</p>
            <textarea placeholder="Comentarios" value={notas} onChange={(e) => setNotas(e.target.value)} />

            <div className="nota-info">
              ⏳ Esto es una solicitud, no una reservación confirmada. El centro revisará disponibilidad y te
              contactará para confirmar.
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={enviarSolicitud} disabled={enviando}>
              {enviando ? "Enviando..." : "Enviar solicitud"}
            </button>
          </div>
        )}

        {paso === "enviado" && (
          <>
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

            <div className="invitado-intro">
              <img src="/images/icons/tarjeta-fidelidad.png" alt="" className="invitado-intro-icon-img" />
              <span>
                ¿Tienes tarjeta de fidelidad? Escribe tu folio y consulta tu tarjeta digital y cuántos sellos llevas.
              </span>
            </div>
            <ConsultaTarjetaFidelidad />
            <a className="invitado-menu-item daypass" href="/tarjeta-fidelidad">
              <span className="invitado-menu-text">
                <p className="invitado-menu-title">¿Aún no tienes tarjeta?</p>
                <p className="invitado-menu-desc">Pídela gratis y junta sellos en cada visita</p>
              </span>
              <span className="invitado-menu-chevron">›</span>
            </a>
          </>
        )}
      </div>
    </div>
  );
}
