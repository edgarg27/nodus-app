// Mensajes de Facturapi / SAT explicados en palabras sencillas: qué revisar y dónde. El mensaje
// original se conserva al final, entre paréntesis, por si hace falta pasarlo a Sistemas.

const REGLAS: [RegExp, string][] = [
  [
    /nombre del receptor|nombre asociado al rfc/i,
    "La razón social del cliente no corresponde a su RFC según el SAT. Revisa que ambos sean exactamente los de su Constancia de Situación Fiscal (la razón social en MAYÚSCULAS y sin «S.A. DE C.V.» ni el régimen societario).",
  ],
  [
    /domiciliofiscalreceptor|c[oó]digo postal/i,
    "El código postal fiscal del cliente no corresponde al que tiene registrado ante el SAT. Revísalo en su Constancia de Situación Fiscal.",
  ],
  [
    /regimenfiscalreceptor|r[eé]gimen fiscal/i,
    "El régimen fiscal del cliente no corresponde a su tipo de persona (física o moral) ni a su RFC. Revísalo en su Constancia de Situación Fiscal.",
  ],
  [/usocfdi|uso del cfdi|uso cfdi/i, "El uso de la factura del cliente no es válido para su régimen o su tipo de persona."],
  [
    /tax_id.*formato|rfc.*(inv[aá]lido|formato)/i,
    "El RFC del cliente tiene un formato no válido: son 12 caracteres para empresas y 13 para personas, sin espacios.",
  ],
  [/no se encuentra en la lista|rfc.*no (existe|est[aá])|no existe.*rfc/i, "El SAT no tiene registrado ese RFC. Revisa que esté bien escrito."],
];

export function explicarErrorFacturapi(mensaje: string | null | undefined, porDefecto = "Facturapi rechazó la factura"): string {
  const m = String(mensaje || "").trim();
  if (!m) return porDefecto;
  const regla = REGLAS.find(([re]) => re.test(m));
  return regla ? `${regla[1]} (Detalle: ${m})` : m;
}
