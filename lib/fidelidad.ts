// Catálogo y reglas de negocio de la tarjeta de fidelidad — compartido
// entre el panel de staff (CentroPanel) y la consulta pública por folio,
// para no duplicar la lógica de "qué se rentó más".

export type TipoEspacioFidelidad = "sala_juntas" | "coworking" | "oficina_privada" | "working_desk";

// `icono` es la ruta a un icono real (ver /public/images/icons), no un
// emoji — se usa en <img>, así que no es válido dentro de <option>.
export const TIPOS_ESPACIO_FIDELIDAD: { id: TipoEspacioFidelidad; icono: string; label: string }[] = [
  { id: "sala_juntas", icono: "/images/icons/sala-juntas.png", label: "Sala de juntas" },
  { id: "coworking", icono: "/images/icons/coworking.png", label: "Coworking" },
  { id: "oficina_privada", icono: "/images/icons/oficina-privada.png", label: "Oficina privada" },
  { id: "working_desk", icono: "/images/icons/working-desk.png", label: "Working desk" },
];

export const LABEL_TIPO_ESPACIO_FIDELIDAD: Record<TipoEspacioFidelidad, string> = {
  sala_juntas: "Sala de juntas",
  coworking: "Coworking",
  oficina_privada: "Oficina privada",
  working_desk: "Working desk",
};

export type SelloFidelidad = {
  numero: number;
  tipo_espacio: TipoEspacioFidelidad;
  detalle: string | null;
  created_at: string;
};

export type Regalo = {
  tipo_espacio: TipoEspacioFidelidad;
  detalle: string | null;
  veces: number;
};

// Agrupa los sellos por (tipo_espacio + detalle normalizado); gana el grupo
// con más sellos y, en caso de empate, el que se registró primero
// cronológicamente. Se calcula en vivo — no se persiste una copia — porque
// una vez que los 8 sellos existen, el resultado ya no cambia.
export function calcularRegalo(sellos: SelloFidelidad[]): Regalo | null {
  if (sellos.length === 0) return null;

  const grupos = new Map<string, { tipo_espacio: TipoEspacioFidelidad; detalle: string | null; veces: number; primerOrden: number }>();

  sellos.forEach((s, i) => {
    const detalleNorm = (s.detalle || "").trim().toLowerCase();
    const clave = `${s.tipo_espacio}::${detalleNorm}`;
    const existente = grupos.get(clave);
    if (existente) {
      existente.veces += 1;
    } else {
      grupos.set(clave, { tipo_espacio: s.tipo_espacio, detalle: s.detalle, veces: 1, primerOrden: i });
    }
  });

  let mejor: { tipo_espacio: TipoEspacioFidelidad; detalle: string | null; veces: number; primerOrden: number } | null = null;
  for (const g of Array.from(grupos.values())) {
    if (!mejor || g.veces > mejor.veces || (g.veces === mejor.veces && g.primerOrden < mejor.primerOrden)) {
      mejor = g;
    }
  }

  if (!mejor) return null;
  return { tipo_espacio: mejor.tipo_espacio, detalle: mejor.detalle, veces: mejor.veces };
}
