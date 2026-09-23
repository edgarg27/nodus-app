// Hoy en horario de México como 'YYYY-MM-DD' — para no desfasarse de día por
// comparar/guardar fechas en UTC cerca de la medianoche. Un solo lugar,
// reutilizado por lib/correosPagos.ts y por las rutas que marcan un pago
// como pagado (pagos.fecha_pago).
export function hoyMexicoISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}
