// Normalización de `empresa` (texto libre en `profiles.empresa` y
// `clientes.empresa`) — forward-only, sin backfill de datos existentes.
// Colapsa espacios y fija un casing consistente para que el picker de
// empresas (`empresasDistintas`) agrupe variantes como "ABC" / "abc " /
// "Abc" bajo un mismo valor al leer, sin tener que migrar nada.

export function normalizarEmpresa(empresa: string): string {
  return empresa
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((palabra) => (palabra ? palabra[0].toUpperCase() + palabra.slice(1) : palabra))
    .join(" ");
}

// Recibe filas con `empresa` (típicamente `profiles` de un centro) y
// regresa la lista de nombres de empresa distintos, ya normalizados y
// ordenados — para poblar un <select>, nunca para escribir a mano.
export function empresasDistintas(filas: { empresa: string | null }[]): string[] {
  const set = new Set<string>();
  filas.forEach((f) => {
    if (f.empresa && f.empresa.trim()) set.add(normalizarEmpresa(f.empresa));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}
