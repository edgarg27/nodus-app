// El número de usuario ya se guarda con su prefijo ("N-6951", ver app/api/crear-cliente). Para mostrarlo solo se
// agrega "N-" si le falta (registros viejos o importados guardados solo como número).
export function numeroUsuarioVisible(n: string | number | null | undefined): string | null {
  if (n == null || String(n).trim() === "") return null;
  const s = String(n).trim();
  return /^N-/i.test(s) ? s : `N-${s}`;
}
