// Hoy en horario de México como 'YYYY-MM-DD' — para no desfasarse de día por
// comparar/guardar fechas en UTC cerca de la medianoche. Un solo lugar,
// reutilizado por lib/correosPagos.ts y por las rutas que marcan un pago
// como pagado (pagos.fecha_pago).
export function hoyMexicoISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

// Una columna `date` de Supabase llega como "2026-10-05". new Date() de esa
// cadena es medianoche UTC, y en horario de México (también en el servidor, que
// corre con TZ=America/Mexico_City) se ve como el día anterior ("4 oct"). Con
// la hora local sale el día correcto. Lo que ya trae hora (created_at, etc.) se
// deja igual. Usar esto para mostrar o comparar columnas de solo fecha.
export function fechaLocal(f: string | Date): Date {
  if (f instanceof Date) return f;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T00:00:00` : f);
}
