// Rate limiting simple en memoria, basado en un Map a nivel de módulo.
//
// Válido porque este proyecto corre como un solo servidor Next.js (no
// funciones serverless separadas), así que el Map persiste entre requests
// dentro del mismo proceso Node. No sirve para despliegues multi-instancia
// (ahí haría falta Redis u otro store compartido), pero no es el caso aquí.

const buckets = new Map<string, number[]>();

// Evita que el Map crezca sin límite con IPs que ya no vuelven a pegarle
// al endpoint: cada tanto barremos las entradas completamente vencidas.
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  buckets.forEach((timestamps, key) => {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  });
}

// IP del solicitante detrás del proxy (mismo criterio que usan las demás rutas).
export function ipDeRequest(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "desconocida";
}

/**
 * Verifica si `key` puede hacer una solicitud más dentro de la ventana de
 * tiempo dada. Regresa `true` si se permite (y registra el intento), o
 * `false` si ya se alcanzó el límite.
 *
 * @param key IP (u otro identificador) del solicitante
 * @param maxRequests máximo de solicitudes permitidas dentro de la ventana
 * @param windowMs duración de la ventana en milisegundos
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);

  const timestamps = buckets.get(key) || [];
  const windowStart = now - windowMs;
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= maxRequests) {
    buckets.set(key, recent);
    return false;
  }

  recent.push(now);
  buckets.set(key, recent);
  return true;
}
