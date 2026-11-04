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

// Domicilio fiscal, tal como viene en la Constancia de Situación Fiscal (ver migracion_domicilio_fiscal.sql). Es para
// consulta y no impide facturar: el CFDI 4.0 solo lleva el código postal del receptor (cp_fiscal).
export const CAMPOS_DOMICILIO_FISCAL = [
  { campo: "dom_tipo_vialidad", label: "Tipo de vialidad", placeholder: "CALLE, AVENIDA…" },
  { campo: "dom_vialidad", label: "Nombre de vialidad", placeholder: "" },
  { campo: "dom_num_exterior", label: "Número exterior", placeholder: "" },
  { campo: "dom_num_interior", label: "Número interior", placeholder: "Si tiene" },
  { campo: "dom_colonia", label: "Colonia", placeholder: "" },
  { campo: "dom_localidad", label: "Localidad", placeholder: "Si tiene" },
  { campo: "dom_municipio", label: "Municipio o demarcación", placeholder: "" },
  { campo: "dom_entidad", label: "Entidad federativa", placeholder: "" },
  { campo: "dom_entre_calle", label: "Entre calle", placeholder: "Si tiene" },
  { campo: "dom_y_calle", label: "Y calle", placeholder: "Si tiene" },
] as const;

export type CampoDomicilioFiscal = (typeof CAMPOS_DOMICILIO_FISCAL)[number]["campo"];
export type DomicilioFiscal = Record<CampoDomicilioFiscal, string>;

export const DOMICILIO_FISCAL_VACIO = Object.fromEntries(CAMPOS_DOMICILIO_FISCAL.map((c) => [c.campo, ""])) as DomicilioFiscal;

// Lo que llega del perfil a un formulario (las columnas vacías vienen en null).
export function domicilioDePerfil(p: Partial<Record<CampoDomicilioFiscal, string | null>> | null | undefined): DomicilioFiscal {
  return Object.fromEntries(CAMPOS_DOMICILIO_FISCAL.map((c) => [c.campo, p?.[c.campo] || ""])) as DomicilioFiscal;
}

// Lo que se guarda: en mayúsculas como en la Constancia, y null lo vacío.
export function domicilioParaGuardar(body: any): Record<CampoDomicilioFiscal, string | null> {
  return Object.fromEntries(CAMPOS_DOMICILIO_FISCAL.map((c) => [c.campo, String(body?.[c.campo] ?? "").trim().toUpperCase().slice(0, 200) || null])) as Record<
    CampoDomicilioFiscal,
    string | null
  >;
}

// El domicilio en una línea: "CALLE RIO TIGRIS 9, COL. VILLA LA PAZ, TEPIC, NAYARIT".
export function textoDomicilioFiscal(p: Partial<Record<CampoDomicilioFiscal, string | null>> | null | undefined): string {
  if (!p) return "";
  const calle = [p.dom_tipo_vialidad, p.dom_vialidad, p.dom_num_exterior, p.dom_num_interior ? `INT. ${p.dom_num_interior}` : ""].filter(Boolean).join(" ");
  const entre = p.dom_entre_calle ? `ENTRE ${p.dom_entre_calle}${p.dom_y_calle ? ` Y ${p.dom_y_calle}` : ""}` : p.dom_y_calle || "";
  return [calle, p.dom_colonia ? `COL. ${p.dom_colonia}` : "", p.dom_localidad, p.dom_municipio, p.dom_entidad, entre].filter(Boolean).join(", ");
}

// Catálogo de regímenes fiscales del SAT (c_RegimenFiscal, CFDI 4.0) y a qué tipo de
// persona aplica cada uno. Antes solo estaban los más comunes y faltaban varios
// (p. ej. Arrendamiento de personas morales o Sociedades Cooperativas).
export const REGIMENES_FISCALES: { clave: string; nombre: string; aplica: TipoPersonaFiscal[] }[] = [
  { clave: "601", nombre: "General de Ley Personas Morales", aplica: ["moral"] },
  { clave: "603", nombre: "Personas Morales con Fines no Lucrativos", aplica: ["moral"] },
  { clave: "605", nombre: "Sueldos y Salarios e Ingresos Asimilados a Salarios", aplica: ["fisica"] },
  { clave: "606", nombre: "Arrendamiento", aplica: ["fisica"] },
  { clave: "607", nombre: "Régimen de Enajenación o Adquisición de Bienes", aplica: ["fisica"] },
  { clave: "608", nombre: "Demás ingresos", aplica: ["fisica"] },
  { clave: "609", nombre: "Consolidación", aplica: ["moral"] },
  { clave: "610", nombre: "Residentes en el Extranjero sin Establecimiento Permanente en México", aplica: ["fisica", "moral"] },
  { clave: "611", nombre: "Ingresos por Dividendos (socios y accionistas)", aplica: ["fisica"] },
  { clave: "612", nombre: "Personas Físicas con Actividades Empresariales y Profesionales", aplica: ["fisica"] },
  { clave: "614", nombre: "Ingresos por intereses", aplica: ["fisica"] },
  { clave: "615", nombre: "Régimen de los ingresos por obtención de premios", aplica: ["fisica"] },
  { clave: "616", nombre: "Sin obligaciones fiscales", aplica: ["fisica"] },
  { clave: "620", nombre: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos", aplica: ["moral"] },
  { clave: "621", nombre: "Incorporación Fiscal", aplica: ["fisica"] },
  { clave: "622", nombre: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", aplica: ["fisica", "moral"] },
  { clave: "623", nombre: "Opcional para Grupos de Sociedades", aplica: ["moral"] },
  { clave: "624", nombre: "Coordinados", aplica: ["moral"] },
  { clave: "625", nombre: "Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", aplica: ["fisica"] },
  { clave: "626", nombre: "Régimen Simplificado de Confianza (RESICO)", aplica: ["fisica", "moral"] },
  { clave: "628", nombre: "Hidrocarburos", aplica: ["moral"] },
  { clave: "629", nombre: "De los Regímenes Fiscales Preferentes y de las Empresas Multinacionales", aplica: ["fisica", "moral"] },
  { clave: "630", nombre: "Enajenación de acciones en bolsa de valores", aplica: ["fisica"] },
];

// Usos del CFDI 4.0 (c_UsoCFDI) que se pueden elegir al facturar un servicio. Los D01 a D10
// (deducciones personales) son solo de persona física; los demás, de ambas. No se incluyen
// P01 "Por definir" (ya no existe en 4.0: el SAT lo rechaza), CP01 (solo para complementos
// de pago) ni CN01 (solo nómina). El SAT además valida que el uso sea compatible con el
// régimen del receptor; si una factura automática se rechaza, el centro recibe el aviso.
export const USOS_CFDI: { clave: string; nombre: string; aplica: TipoPersonaFiscal[] }[] = [
  { clave: "G03", nombre: "Gastos en general", aplica: ["fisica", "moral"] },
  { clave: "G01", nombre: "Adquisición de mercancías", aplica: ["fisica", "moral"] },
  { clave: "G02", nombre: "Devoluciones, descuentos o bonificaciones", aplica: ["fisica", "moral"] },
  { clave: "I01", nombre: "Construcciones", aplica: ["fisica", "moral"] },
  { clave: "I02", nombre: "Mobiliario y equipo de oficina por inversiones", aplica: ["fisica", "moral"] },
  { clave: "I03", nombre: "Equipo de transporte", aplica: ["fisica", "moral"] },
  { clave: "I04", nombre: "Equipo de cómputo y accesorios", aplica: ["fisica", "moral"] },
  { clave: "I05", nombre: "Dados, troqueles, moldes, matrices y herramental", aplica: ["fisica", "moral"] },
  { clave: "I06", nombre: "Comunicaciones telefónicas", aplica: ["fisica", "moral"] },
  { clave: "I07", nombre: "Comunicaciones satelitales", aplica: ["fisica", "moral"] },
  { clave: "I08", nombre: "Otra maquinaria y equipo", aplica: ["fisica", "moral"] },
  { clave: "D01", nombre: "Honorarios médicos, dentales y gastos hospitalarios", aplica: ["fisica"] },
  { clave: "D02", nombre: "Gastos médicos por incapacidad o discapacidad", aplica: ["fisica"] },
  { clave: "D03", nombre: "Gastos funerales", aplica: ["fisica"] },
  { clave: "D04", nombre: "Donativos", aplica: ["fisica"] },
  { clave: "D05", nombre: "Intereses reales por créditos hipotecarios (casa habitación)", aplica: ["fisica"] },
  { clave: "D06", nombre: "Aportaciones voluntarias al SAR", aplica: ["fisica"] },
  { clave: "D07", nombre: "Primas por seguros de gastos médicos", aplica: ["fisica"] },
  { clave: "D08", nombre: "Gastos de transportación escolar obligatoria", aplica: ["fisica"] },
  { clave: "D09", nombre: "Depósitos en cuentas para el ahorro, primas de planes de pensiones", aplica: ["fisica"] },
  { clave: "D10", nombre: "Pagos por servicios educativos (colegiaturas)", aplica: ["fisica"] },
  { clave: "S01", nombre: "Sin efectos fiscales", aplica: ["fisica", "moral"] },
];

export function usosParaTipo(tipo: TipoPersonaFiscal) {
  return USOS_CFDI.filter((u) => u.aplica.includes(tipo));
}

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
    // Decir QUÉ está mal: antes siempre decía "tiene 13 caracteres" aunque
    // el RFC sí tuviera 13 y el problema fuera el formato.
    const largo = tipo === "moral" ? 12 : 13;
    const letras = tipo === "moral" ? 3 : 4;
    const ejemplo = tipo === "moral" ? "ABC010101AB1" : "ABCD010101AB1";
    const quien = tipo === "moral" ? "persona moral" : "persona física";
    if (rfc.length !== largo) {
      return `El RFC de una ${quien} tiene ${largo} caracteres y este tiene ${rfc.length} (ej. ${ejemplo})`;
    }
    return `El RFC no tiene el formato correcto: ${letras} letras, 6 números de la fecha (AAMMDD) y 3 de homoclave (ej. ${ejemplo})`;
  }
  if (!String(d.nombre_fiscal || "").trim()) {
    return tipo === "moral" ? "Falta la razón social" : "Falta el nombre completo como aparece en su constancia fiscal";
  }
  if (!REGIMENES_FISCALES.some((r) => r.clave === d.regimen_fiscal && r.aplica.includes(tipo))) {
    return "Elige el régimen fiscal";
  }
  if (!/^\d{5}$/.test(String(d.cp_fiscal || "").trim())) return "El código postal fiscal son 5 dígitos";
  if (!usosParaTipo(tipo).some((u) => u.clave === d.uso_cfdi)) return "Elige el uso de la factura";
  return "";
}

// Avisos (no errores) sobre datos fiscales que probablemente no coinciden con lo que el SAT tiene
// registrado. Sirven para que quien factura lo revise ANTES de timbrar; el SAT es quien decide.
const ARTICULOS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "EN", "AL", "THE", "A"]);
const PINTA_DE_EMPRESA = /\b(S\.?A\.? DE C\.?V\.?|SA DE CV|S\.? DE R\.?L\.?|SAPI|S\.?A\.?S\.?|SOCIEDAD|EMPRESA|COMPANY|CORPORATIVO|CONSTRUCTORA|INMOBILIARIA|ASOCIADOS|GRUPO)\b/i;
const sinAcentosMayus = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

export function avisosDatosFiscales(d: { rfc?: string | null; nombre_fiscal?: string | null; regimen_fiscal?: string | null }): string[] {
  const avisos: string[] = [];
  const rfc = normalizarRfc(d.rfc || "");
  const nombre = (d.nombre_fiscal || "").trim();
  if (!rfc || !nombre || RFC_GENERICOS.includes(rfc)) return avisos;
  const moral = rfc.length === 12;
  const fisica = rfc.length === 13;

  if (nombre !== nombre.toUpperCase()) avisos.push("La razón social lleva minúsculas: el SAT la tiene en MAYÚSCULAS (escríbela como en la Constancia).");

  if (moral) {
    // El RFC de una empresa empieza con la inicial de su razón social. Si la razón social empieza con un número
    // ("4PES CONSTRUC" → PCO…), el SAT no usa el número tal cual: ahí no se compara.
    const primera = sinAcentosMayus(nombre)
      .split(/\s+/)
      .find((p) => p && !ARTICULOS.has(p));
    if (primera && /^[A-ZÑ&]/.test(primera) && primera[0] !== sinAcentosMayus(rfc)[0]) {
      avisos.push(`El RFC (de empresa) empieza con «${rfc[0]}» y la razón social con «${primera[0]}»: parece que no corresponden. Revisa ambos en la Constancia.`);
    }
  }
  if (fisica && PINTA_DE_EMPRESA.test(nombre)) avisos.push("El RFC es de persona física, pero la razón social parece de una empresa.");

  const regimen = REGIMENES_FISCALES.find((r) => r.clave === d.regimen_fiscal);
  if (regimen && (moral || fisica) && !regimen.aplica.includes(moral ? "moral" : "fisica")) {
    avisos.push(`El régimen ${regimen.clave} es de ${moral ? "personas físicas" : "empresas"}, pero el RFC es de ${moral ? "una empresa" : "una persona física"}.`);
  }
  return avisos;
}
