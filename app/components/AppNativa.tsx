"use client";

import { useEffect } from "react";
import { esAppNativa, pluginNativo } from "@/lib/appNativa";

// Ajustes cuando la web corre dentro de la app móvil (Capacitor): marca el <body> con "app-nativa" (para estilos) y
// hace que el botón "atrás" de Android regrese a la pantalla anterior, o salga de la app si ya no hay a dónde regresar.
export default function AppNativa() {
  useEffect(() => {
    if (!esAppNativa()) return;
    document.body.classList.add("app-nativa");
    const app = pluginNativo("App");
    if (!app?.addListener) return;
    let quitar: { remove: () => void } | null = null;
    Promise.resolve(
      app.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
        if (canGoBack) window.history.back();
        else app.exitApp?.();
      })
    ).then((h: { remove: () => void }) => {
      quitar = h;
    });
    return () => quitar?.remove();
  }, []);
  return null;
}
