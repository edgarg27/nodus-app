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
