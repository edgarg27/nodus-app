"use client";

import { useEffect } from "react";
import { activarPushNativo, esAppNativa, estadoPushNativo, pluginNativo } from "@/lib/appNativa";

type Manejador = { remove: () => void };

// Ajustes cuando la web corre dentro de la app móvil (Capacitor):
// - marca el <body> con "app-nativa" (para estilos);
// - el botón "atrás" de Android regresa a la pantalla anterior, o sale de la app si ya no hay a dónde regresar;
// - al tocar un aviso push se abre la pantalla que trae (url);
// - si ya dio permiso de avisos, vuelve a registrar el celular (el token puede cambiar).
export default function AppNativa() {
  useEffect(() => {
    if (!esAppNativa()) return;
    document.body.classList.add("app-nativa");
    const manejadores: Promise<Manejador>[] = [];

    const app = pluginNativo("App");
    if (app?.addListener) {
      manejadores.push(
        Promise.resolve(
          app.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
            if (canGoBack) window.history.back();
            else app.exitApp?.();
          })
        )
      );
    }

    const push = pluginNativo("PushNotifications");
    if (push?.addListener) {
      manejadores.push(
        Promise.resolve(
          push.addListener("pushNotificationActionPerformed", (accion: { notification?: { data?: Record<string, unknown> } }) => {
            const url = accion?.notification?.data?.url;
            if (typeof url === "string" && url.startsWith("/")) window.location.href = url;
          })
        )
      );
      // Solo si ya los había activado (y no los apagó) y hay sesión: el token se guarda a nombre de quien la inició.
      if (!window.location.pathname.startsWith("/login")) {
        estadoPushNativo()
          .then((e) => (e === "activo" ? activarPushNativo(false) : null))
          .catch(() => {});
      }
    }

    return () => {
      manejadores.forEach((m) => m.then((h) => h?.remove?.()).catch(() => {}));
    };
  }, []);
  return null;
}
