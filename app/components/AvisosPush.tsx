"use client";

import { useEffect, useState } from "react";

// Activa o desactiva los avisos al celular (notificaciones push) en este dispositivo.
// Va dentro del menú de la campana, tanto en el panel del personal como en el del cliente.

type Estado = "cargando" | "no_soportado" | "instalar_ios" | "apagado" | "activo" | "bloqueado";

function claveAUint8(base64: string) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(b64);
  const salida = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) salida[i] = crudo.charCodeAt(i);
  return salida;
}

export default function AvisosPush() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const ua = navigator.userAgent;
      const ios = /iphone|ipad|ipod/i.test(ua);
      const instalada = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      const soporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!soporta) return vivo && setEstado(ios && !instalada ? "instalar_ios" : "no_soportado");
      if (Notification.permission === "denied") return vivo && setEstado("bloqueado");
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (vivo) setEstado(sub && Notification.permission === "granted" ? "activo" : "apagado");
      } catch {
        if (vivo) setEstado("apagado");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function activar() {
    setOcupado(true);
    setMensaje("");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        return;
      }
      const { clave } = await (await fetch("/api/push/clave")).json();
      if (!clave) {
        setMensaje("Los avisos al celular todavía no están disponibles. Intenta más tarde.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveAUint8(clave) });
      const res = await fetch("/api/push/suscribir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) {
        await sub.unsubscribe();
        setMensaje("No se pudo activar. Intenta de nuevo.");
        return;
      }
      setEstado("activo");
      setMensaje("Listo: te llegarán los avisos a este dispositivo.");
    } catch {
      setMensaje("No se pudo activar en este dispositivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function desactivar() {
    setOcupado(true);
    setMensaje("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/desuscribir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setEstado("apagado");
    } catch {
      setMensaje("No se pudo desactivar.");
    } finally {
      setOcupado(false);
    }
  }

  async function probar() {
    setOcupado(true);
    setMensaje("");
    try {
      const res = await fetch("/api/push/probar", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setMensaje(res.ok ? "Te mandamos un aviso de prueba." : data.error || "No se pudo mandar la prueba.");
    } finally {
      setOcupado(false);
    }
  }

  if (estado === "cargando") return null;

  return (
    <div className="notif-push">
      {estado === "no_soportado" && <p className="notif-push-texto">Este navegador no permite avisos al celular.</p>}
      {estado === "instalar_ios" && <p className="notif-push-texto">Para recibir avisos en tu iPhone, primero instala la app: en Safari toca Compartir y «Agregar a pantalla de inicio».</p>}
      {estado === "bloqueado" && <p className="notif-push-texto">Los avisos están bloqueados en este dispositivo. Actívalos desde los permisos del navegador o de la app.</p>}
      {estado === "apagado" && (
        <>
          <p className="notif-push-texto">Recibe los avisos en tu celular, aunque no tengas la app abierta.</p>
          <button type="button" className="notif-push-btn" disabled={ocupado} onClick={activar}>
            {ocupado ? "Activando..." : "Activar avisos"}
          </button>
        </>
      )}
      {estado === "activo" && (
        <>
          <p className="notif-push-texto">Avisos al celular activados en este dispositivo.</p>
          <div className="notif-push-acciones">
            <button type="button" className="notif-push-btn" disabled={ocupado} onClick={probar}>
              Enviar prueba
            </button>
            <button type="button" className="notif-push-enlace" disabled={ocupado} onClick={desactivar}>
              Desactivar
            </button>
          </div>
        </>
      )}
      {mensaje && <p className="notif-push-texto">{mensaje}</p>}
    </div>
  );
}
