"use client";

import { useEffect, useState } from "react";

// App instalable (PWA): registra el service worker y, en el celular, ofrece instalar Nodus
// en la pantalla de inicio. En Android/Chrome sale el botón "Instalar"; en iPhone (Safari)
// no existe ese botón, así que se explica cómo agregarla. Si la persona dice "Ahora no", no
// se vuelve a mostrar en 30 días.

type EventoInstalar = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const CLAVE = "nodus_pwa_aviso";
const DIAS_OCULTO = 30;

function ocultoPorAhora(): boolean {
  try {
    const t = Number(localStorage.getItem(CLAVE) || 0);
    return !!t && Date.now() - t < DIAS_OCULTO * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function recordarCierre() {
  try {
    localStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    // sin almacenamiento (ventana privada): simplemente volverá a mostrarse
  }
}

export default function PwaInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [esIOS, setEsIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const instalada = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (instalada || ocultoPorAhora()) return;
    // Solo se ofrece en pantallas de celular o tableta chica; en la computadora no estorba.
    if (!window.matchMedia("(max-width: 900px)").matches) return;

    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    if (ios) {
      setEsIOS(true);
      temporizador = setTimeout(() => setVisible(true), 3000);
    }

    const alOfrecer = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalar);
      setVisible(true);
    };
    const alInstalar = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", alOfrecer);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      if (temporizador) clearTimeout(temporizador);
      window.removeEventListener("beforeinstallprompt", alOfrecer);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  if (!visible || (!evento && !esIOS)) return null;

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    if (outcome === "dismissed") recordarCierre();
    setEvento(null);
    setVisible(false);
  }

  function cerrar() {
    recordarCierre();
    setVisible(false);
  }

  return (
    <div className="pwa-aviso" role="dialog" aria-label="Instalar la app de Nodus">
      <img className="pwa-aviso-logo" src="/icons/pwa/icon-192.png" alt="" width={44} height={44} />
      <div className="pwa-aviso-texto">
        <p className="pwa-aviso-titulo">Instala Nodus en tu celular</p>
        {evento ? (
          <p className="pwa-aviso-sub">Ábrela como una app, directo desde tu pantalla de inicio.</p>
        ) : (
          <p className="pwa-aviso-sub">Toca el botón Compartir de Safari y elige «Agregar a pantalla de inicio».</p>
        )}
      </div>
      <div className="pwa-aviso-acciones">
        {evento && (
          <button type="button" className="pwa-aviso-instalar" onClick={instalar}>
            Instalar
          </button>
        )}
        <button type="button" className="pwa-aviso-cerrar" onClick={cerrar}>
          {evento ? "Ahora no" : "Entendido"}
        </button>
      </div>
    </div>
  );
}
