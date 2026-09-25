// Datos fiscales del cliente (CFDI 4.0). Se piden al aceptar la cotización; ver
// migracion_datos_fiscales.sql y app/cotizaciones/ModalDatosFiscales.tsx.

export type DatosFiscales = {
  rfc: string;
  nombre_fiscal: string;
  regimen_fiscal: string;
  cp_fiscal: string;
  uso_cfdi: string;
};

export type TipoPersonaFiscal = "fisica" | "moral";

// Regímenes más comunes del catálogo del SAT y a qué tipo de persona aplican.
export const REGIMENES_FISCALES: { clave: string; nombre: string; aplica: TipoPersonaFiscal[] }[] = [
  { clave: "601", nombre: "General de Ley Personas Morales", aplica: ["moral"] },
  { clave: "603", nombre: "Personas Morales con Fines no Lucrativos", aplica: ["moral"] },
  { clave: "605", nombre: "Sueldos y Salarios e Ingresos Asimilados a Salarios", aplica: ["fisica"] },
  { clave: "606", nombre: "Arrendamiento", aplica: ["fisica"] },
  { clave: "612", nombre: "Personas Físicas con Actividades Empresariales y Profesionales", aplica: ["fisica"] },
  { clave: "616", nombre: "Sin obligaciones fiscales", aplica: ["fisica"] },
  { clave: "621", nombre: "Incorporación Fiscal", aplica: ["fisica"] },
  { clave: "625", nombre: "Actividades Empresariales con ingresos por Plataformas Tecnológicas", aplica: ["fisica"] },
  { clave: "626", nombre: "Régimen Simplificado de Confianza (RESICO)", aplica: ["fisica", "moral"] },
];

export const USOS_CFDI: { clave: string; nombre: string }[] = [
  { clave: "G03", nombre: "Gastos en general" },
  { clave: "G01", nombre: "Adquisición de mercancías" },
  { clave: "P01", nombre: "Por definir" },
  { clave: "S01", nombre: "Sin efectos fiscales" },
];

export const USO_CFDI_DEFAULT = "G03";

// Cuando el cliente no da datos fiscales, la factura se hace a "público en general":
// RFC genérico del SAT, ese nombre exacto, régimen 616 y uso S01. En el CFDI 4.0 el código
// postal es el del lugar de expedición (el del centro). Ojo: esa factura no es deducible
// para el cliente.
export const RFC_PUBLICO_GENERAL = "XAXX010101000";
export const DATOS_PUBLICO_GENERAL = {
  rfc: RFC_PUBLICO_GENERAL,
  nombre_fiscal: "PUBLICO EN GENERAL",
  regimen_fiscal: "616",
  uso_cfdi: "S01",
};

export function esPublicoGeneral(rfc: string) {
  return normalizarRfc(rfc) === RFC_PUBLICO_GENERAL;
}

// Si el RFC es el de público en general, el nombre, régimen y uso van fijos.
export function normalizarDatosFiscales(d: DatosFiscales): DatosFiscales {
  return esPublicoGeneral(d.rfc) ? { ...d, ...DATOS_PUBLICO_GENERAL } : d;
}

// RFC de persona física (13) o moral (12), más los genéricos del SAT.
const RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
const RFC_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
const RFC_GENERICOS = ["XAXX010101000", "XEXX010101000"];

export function normalizarRfc(rfc: string) {
  return String(rfc || "").trim().toUpperCase().replace(/\s+/g, "");
}

// Devuelve el mensaje de error, o "" si todo está bien.
export function validarDatosFiscales(d: DatosFiscales, tipo: TipoPersonaFiscal): string {
  const rfc = normalizarRfc(d.rfc);
  if (!rfc) return "Falta el RFC";
  if (rfc === RFC_PUBLICO_GENERAL && tipo === "moral") {
    return "Una persona moral necesita su RFC: público en general solo aplica a personas físicas";
  }
  if (!RFC_GENERICOS.includes(rfc) && !(tipo === "moral" ? RFC_MORAL : RFC_FISICA).test(rfc)) {
    return tipo === "moral"
      ? "El RFC de una persona moral tiene 12 caracteres (ej. ABC010101AB1)"
      : "El RFC de una persona física tiene 13 caracteres (ej. ABCD010101AB1)";
  }
  if (!String(d.nombre_fiscal || "").trim()) {
    return tipo === "moral" ? "Falta la razón social" : "Falta el nombre completo como aparece en su constancia fiscal";
  }
  if (!REGIMENES_FISCALES.some((r) => r.clave === d.regimen_fiscal && r.aplica.includes(tipo))) {
    return "Elige el régimen fiscal";
  }
  if (!/^\d{5}$/.test(String(d.cp_fiscal || "").trim())) return "El código postal fiscal son 5 dígitos";
  if (!USOS_CFDI.some((u) => u.clave === d.uso_cfdi)) return "Elige el uso de la factura";
  return "";
}
