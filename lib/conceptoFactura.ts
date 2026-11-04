// Concepto predefinido de las facturas de un cliente (profiles.concepto_factura): Finanzas lo escribe una vez en
// Configuración fiscal, con el mes, p. ej. "Prestación de servicios de OFICINA 4, Noviembre del 2026", y cada factura
// lo usa con el mes y el año de su periodo ("..., Diciembre del 2026"). Lo demás del texto no cambia.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// El mes, y el año si va justo después ("noviembre 2026", "Noviembre de 2026", "NOVIEMBRE DEL 2026").
const PATRON_MES = new RegExp(`\\b(${[...MESES, "setiembre"].join("|")})\\b(\\s+(?:del?\\s+)?)?(\\d{4})?`, "gi");

// Escribe el mes nuevo con las mismas mayúsculas que el que se reemplaza.
function comoElOriginal(original: string, mes: string) {
  if (original === original.toUpperCase()) return mes.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return mes[0].toUpperCase() + mes.slice(1);
  return mes;
}

export function conceptoDelPeriodo(plantilla: string, mes: number, anio: number): string {
  const nombre = MESES[mes - 1];
  if (!nombre) return plantilla.trim();
  return plantilla.trim().replace(PATRON_MES, (_t, m: string, separador: string | undefined, a: string | undefined) => {
    const mesNuevo = comoElOriginal(m, nombre);
    return a ? `${mesNuevo}${separador || " "}${anio}` : mesNuevo + (separador || "");
  });
}

export function tieneMes(plantilla: string): boolean {
  return new RegExp(PATRON_MES.source, "i").test(plantilla);
}
