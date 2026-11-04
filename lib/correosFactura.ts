// Correos adicionales del cliente para sus facturas (profiles.correos_factura, migracion_correos_factura.sql). Son
// opcionales: la factura y el estado de cuenta siempre van al correo de su cuenta y, además, a estos.

export const MAXIMO_CORREOS_EXTRA = 5;

const CORREO = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Lo que se escribe (uno por renglón, o separados por coma o punto y coma) → la lista limpia, sin repetidos ni el
// correo de la cuenta. Devuelve el error a mostrar si alguno no es un correo.
export function leerCorreosExtra(texto: unknown, correoCuenta?: string | null): { correos: string[] } | { error: string } {
  const partes = (Array.isArray(texto) ? texto.join("\n") : String(texto || ""))
    .split(/[\n,;]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const malo = partes.find((c) => !CORREO.test(c));
  if (malo) return { error: `"${malo}" no es un correo válido` };
  const cuenta = (correoCuenta || "").trim().toLowerCase();
  const correos = Array.from(new Set(partes)).filter((c) => c !== cuenta);
  if (correos.length > MAXIMO_CORREOS_EXTRA) return { error: `Máximo ${MAXIMO_CORREOS_EXTRA} correos adicionales` };
  return { correos };
}

export function correosExtraDe(p: { correos_factura?: string[] | null } | null | undefined): string[] {
  return Array.isArray(p?.correos_factura) ? p!.correos_factura!.filter(Boolean) : [];
}
