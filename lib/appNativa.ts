// ¿Se está viendo dentro de la app móvil de Nodus (Capacitor, carpeta mobile/)? La app nativa abre esta misma web
// y le inyecta window.Capacitor; en el navegador normal no existe. Se usa el objeto global (no el paquete npm) para
// que la web no cargue nada de Capacitor.
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, any>;
};

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor as CapacitorGlobal) || null;
}

export function esAppNativa(): boolean {
  return !!capacitor()?.isNativePlatform?.();
}

export function pluginNativo<T = any>(nombre: string): T | null {
  return (capacitor()?.Plugins?.[nombre] as T) || null;
}

export function plataformaNativa(): "android" | "ios" | null {
  const p = capacitor()?.getPlatform?.();
  return p === "android" || p === "ios" ? p : null;
}

// ---------- Avisos push nativos (Android: Firebase; iPhone: APNs) ----------
const CLAVE_TOKEN = "nodus_push_token";
const leerToken = () => {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
};
const guardarToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // sin almacenamiento: solo se pierde el recordatorio local
  }
};

export type EstadoPushNativo = "apagado" | "activo" | "bloqueado" | "no_soportado";

export async function estadoPushNativo(): Promise<EstadoPushNativo> {
  const push = pluginNativo("PushNotifications");
  if (!push) return "no_soportado";
  const { receive } = await push.checkPermissions();
  if (receive === "denied") return "bloqueado";
  return receive === "granted" && leerToken() ? "activo" : "apagado";
}

// Pide permiso, registra el celular con Firebase/Apple y guarda su token en el servidor. Si ya hay permiso, solo
// vuelve a registrar (el token puede cambiar), por eso se llama también al abrir la app.
export async function activarPushNativo(pedirPermiso = true): Promise<"ok" | "denegado" | "error"> {
  const push = pluginNativo("PushNotifications");
  const plataforma = plataformaNativa();
  if (!push || !plataforma) return "error";
  let { receive } = await push.checkPermissions();
  if (receive !== "granted" && pedirPermiso) receive = (await push.requestPermissions()).receive;
  if (receive !== "granted") return "denegado";

  return new Promise((resolver) => {
    const manejadores: { remove: () => void }[] = [];
    const terminar = (r: "ok" | "error") => {
      manejadores.forEach((m) => m.remove());
      resolver(r);
    };
    const espera = setTimeout(() => terminar("error"), 15000);
    Promise.all([
      push.addListener("registration", async ({ value }: { value: string }) => {
        clearTimeout(espera);
        try {
          const res = await fetch("/api/push/dispositivo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: value, plataforma }),
          });
          if (res.ok) guardarToken(value);
          terminar(res.ok ? "ok" : "error");
        } catch {
          terminar("error");
        }
      }),
      push.addListener("registrationError", () => {
        clearTimeout(espera);
        terminar("error");
      }),
    ]).then((hs) => {
      manejadores.push(...hs);
      push.register();
    });
  });
}

// Al cerrar sesión dentro de la app: el celular deja de recibir los avisos de esa cuenta. Fuera de la app no hace nada.
export async function soltarDispositivoNativo() {
  if (!esAppNativa()) return;
  await desactivarPushNativo().catch(() => {});
}

export async function desactivarPushNativo() {
  const token = leerToken();
  if (token) {
    await fetch("/api/push/dispositivo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
  }
  guardarToken(null);
  await pluginNativo("PushNotifications")?.unregister?.().catch?.(() => {});
}
