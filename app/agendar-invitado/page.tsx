"use client";

import { WHATSAPP_MOSTRAR, whatsappUrl } from "@/lib/contacto";

// `icono` es la ruta a un icono real (ver /public/images/icons), no un
// emoji. Los Day Pass reusan el icono de su mismo tipo de espacio.
const SERVICIOS: { icono: string; label: string; desc: string; mensaje: string; esDayPass: boolean }[] = [
  {
    icono: "/images/icons/sala-juntas.png",
    label: "Agendar sala de juntas",
    desc: "Reserva un horario para tu junta o reunión",
    mensaje: "Hola, quiero agendar una sala de juntas en Nodus Flex Center.",
    esDayPass: false,
  },
  {
    icono: "/images/icons/coworking.png",
    label: "Agendar coworking",
    desc: "Aparta tu espacio en el área de coworking",
    mensaje: "Hola, quiero agendar un espacio de coworking en Nodus Flex Center.",
    esDayPass: false,
  },
  {
    icono: "/images/icons/oficina-privada.png",
    label: "Agendar oficina privada",
    desc: "Solicita una oficina privada para tu equipo",
    mensaje: "Hola, quiero cotizar una oficina privada en Nodus Flex Center.",
    esDayPass: false,
  },
  {
    icono: "/images/icons/working-desk.png",
    label: "Agendar working desk",
    desc: "Aparta tu escritorio individual",
    mensaje: "Hola, quiero agendar un working desk en Nodus Flex Center.",
    esDayPass: false,
  },
  {
    icono: "/images/icons/coworking.png",
    label: "Day Pass — Coworking",
    desc: "Acceso de un día al área de coworking",
    mensaje: "Hola, quiero un Day Pass de coworking en Nodus Flex Center.",
    esDayPass: true,
  },
  {
    icono: "/images/icons/oficina-privada.png",
    label: "Day Pass — Oficina privada",
    desc: "Acceso de un día a una oficina privada",
    mensaje: "Hola, quiero un Day Pass de oficina privada en Nodus Flex Center.",
    esDayPass: true,
  },
  {
    icono: "/images/icons/working-desk.png",
    label: "Day Pass — Working Desk",
    desc: "Acceso de un día a un escritorio individual",
    mensaje: "Hola, quiero un Day Pass de working desk en Nodus Flex Center.",
    esDayPass: true,
  },
];

export default function AgendarInvitadoPage() {
  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/login">
          ← Regresar al login
        </a>
        <p className="rep-title">Nodus Flex Center</p>
        <p className="rep-sub">¿Qué te gustaría hacer?</p>
      </div>

      <div className="rep-content">
        <div className="invitado-intro">
          <span className="invitado-intro-icon">💬</span>
          <span>
            No necesitas cuenta. Elige lo que buscas y te llevamos a nuestro chatbot de WhatsApp ({WHATSAPP_MOSTRAR}):
            te tomará tus datos y una de las administradoras de cada centro trabajará tu cotización y se pondrá en
            contacto contigo.
          </span>
        </div>

        <p className="invitado-menu-group-label">Agendar una visita</p>
        <div className="invitado-menu-list">
          {SERVICIOS.filter((s) => !s.esDayPass).map((s) => (
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
          {SERVICIOS.filter((s) => s.esDayPass).map((s) => (
            <a
              key={s.label}
              className="invitado-menu-item daypass"
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
      </div>
    </div>
  );
}
