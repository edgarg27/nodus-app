// Importe con letra para los contratos: 1500 → "mil quinientos pesos 00/100 M.N.".
// Las plantillas nuevas piden el monto de la renta y del depósito entre paréntesis,
// como "$1,500.00 (mil quinientos pesos 00/100 M.N.)".

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

// 1..999 (con "uno" sin apocopar).
function hasta999(n: number): string {
  if (n === 100) return "cien";
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (centena) partes.push(CENTENAS[centena]);
  if (resto) {
    if (resto < 30) partes.push(UNIDADES[resto]);
    else {
      const decena = Math.floor(resto / 10);
      const unidad = resto % 10;
      partes.push(unidad ? `${DECENAS[decena]} y ${UNIDADES[unidad]}` : DECENAS[decena]);
    }
  }
  return partes.join(" ");
}

// "uno" → "un" y "veintiuno" → "veintiún" cuando va antes de "mil", "millones" o "pesos".
function apocopar(texto: string): string {
  return texto.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
}

// Entero de 0 a 999,999,999 en letra, con "uno" apocopado al final (va antes de "pesos").
function enteroEnLetra(n: number): string {
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "un millón" : `${apocopar(hasta999(millones))} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${apocopar(hasta999(miles))} mil`);
  if (resto) partes.push(hasta999(resto));
  return apocopar(partes.join(" "));
}

export function importeEnLetra(monto: number): string {
  const centavosTotales = Math.round((Number(monto) || 0) * 100);
  const pesos = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;
  if (pesos >= 1_000_000_000) return `${pesos} pesos ${String(centavos).padStart(2, "0")}/100 M.N.`;
  const letra = enteroEnLetra(pesos);
  // "un millón de pesos", "dos millones de pesos": con millones exactos va "de".
  const de = pesos > 0 && pesos % 1_000_000 === 0 ? " de" : "";
  return `${letra}${de} ${pesos === 1 ? "peso" : "pesos"} ${String(centavos).padStart(2, "0")}/100 M.N.`;
}
