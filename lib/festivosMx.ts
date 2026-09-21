// Días festivos oficiales de México (Ley Federal del Trabajo, art. 74),
// calculados para cualquier año — en estos días los centros no abren.
// Devuelve { "YYYY-MM-DD": "Nombre del festivo" }.

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function iso(anio: number, mes0: number, dia: number) {
  return `${anio}-${pad(mes0 + 1)}-${pad(dia)}`;
}

// n-ésimo lunes (1 = primero) de un mes.
function nEsimoLunes(anio: number, mes0: number, n: number) {
  const primerDiaSemana = new Date(anio, mes0, 1).getDay(); // 0 = domingo
  const primerLunes = 1 + ((8 - primerDiaSemana) % 7);
  return primerLunes + (n - 1) * 7;
}

export function festivosMx(anio: number): Record<string, string> {
  const f: Record<string, string> = {
    [iso(anio, 0, 1)]: "Año Nuevo",
    [iso(anio, 1, nEsimoLunes(anio, 1, 1))]: "Día de la Constitución",
    [iso(anio, 2, nEsimoLunes(anio, 2, 3))]: "Natalicio de Benito Juárez",
    [iso(anio, 4, 1)]: "Día del Trabajo",
    [iso(anio, 8, 16)]: "Día de la Independencia",
    [iso(anio, 10, nEsimoLunes(anio, 10, 3))]: "Día de la Revolución",
    [iso(anio, 11, 25)]: "Navidad",
  };
  // Transmisión del Poder Ejecutivo Federal: 1 de octubre cada 6 años
  // (2024, 2030, 2036…).
  if (anio >= 2024 && (anio - 2024) % 6 === 0) {
    f[iso(anio, 9, 1)] = "Transmisión del Poder Ejecutivo Federal";
  }
  return f;
}

// Ajustes por centro guardados en la tabla dias_centro.
export type DiaCentro = {
  id: string;
  fecha: string; // YYYY-MM-DD
  tipo: "cierre" | "abre";
  motivo: string | null;
};

// Días sin servicio de un centro en un año: los festivos oficiales, más los
// cierres extra que capturó el staff, menos los festivos en que ese centro
// sí abre. Devuelve { "YYYY-MM-DD": "Motivo" }.
export function diasSinServicio(anio: number, ajustes: DiaCentro[]): Record<string, string> {
  const dias = festivosMx(anio);
  const prefijo = `${anio}-`;
  ajustes
    .filter((a) => a.fecha.startsWith(prefijo))
    .forEach((a) => {
      if (a.tipo === "abre") delete dias[a.fecha];
      else dias[a.fecha] = a.motivo || "Cierre del centro";
    });
  return dias;
}

// Los próximos `cuantos` días sin servicio de un centro a partir de una
// fecha (YYYY-MM-DD), incluyendo el mismo día.
export function proximosDiasSinServicio(
  desdeISO: string,
  cuantos: number,
  ajustes: DiaCentro[] = []
): { fecha: string; nombre: string }[] {
  const anio = Number(desdeISO.slice(0, 4));
  const todos = [...Object.entries(diasSinServicio(anio, ajustes)), ...Object.entries(diasSinServicio(anio + 1, ajustes))]
    .map(([fecha, nombre]) => ({ fecha, nombre }))
    .filter((x) => x.fecha >= desdeISO)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return todos.slice(0, cuantos);
}
