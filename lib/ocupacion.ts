// Ocupación de oficinas por centro, compartida por el dashboard y Reportes
// para que ambos den siempre lo mismo.
//
// Reglas:
// - Todo el coworking de un centro cuenta como UN solo espacio (son cientos
//   de puestos sueltos y desbalancean el porcentaje): suma 1 al total y, si
//   tiene al menos un contrato vigente, 1 a las ocupadas.
// - Lo demás (oficina privada, working desk...) cuenta una por una.
// - "Ocupada" sale de contratos vigentes con cliente real, no de
//   oficinas.estado (nada lo libera al vencer un contrato).

export type OficinaOcupacion = { id: string; centro: string | null; tipo: string | null };
export type ContratoOcupacion = { oficina_id: string | null };

export type OcupacionCentro = { total: number; ocupadas: number; disponibles: number };

const esCoworking = (tipo: string | null) => (tipo || "").trim().toLowerCase() === "coworking";

export function calcularOcupacionPorCentro(
  oficinas: OficinaOcupacion[],
  contratos: ContratoOcupacion[]
): Record<string, OcupacionCentro> {
  const porId = new Map(oficinas.map((o) => [o.id, o]));
  const centros: Record<string, { individuales: number; hayCoworking: boolean; ocupadasIds: Set<string>; coworkingOcupado: boolean }> = {};

  const centroDe = (o: OficinaOcupacion) => o.centro || "Sin centro";
  const asegurar = (c: string) =>
    (centros[c] = centros[c] || { individuales: 0, hayCoworking: false, ocupadasIds: new Set<string>(), coworkingOcupado: false });

  oficinas.forEach((o) => {
    const c = asegurar(centroDe(o));
    if (esCoworking(o.tipo)) c.hayCoworking = true;
    else c.individuales++;
  });

  contratos.forEach((k) => {
    const o = k.oficina_id ? porId.get(k.oficina_id) : undefined;
    if (!o) return;
    const c = asegurar(centroDe(o));
    if (esCoworking(o.tipo)) c.coworkingOcupado = true;
    else c.ocupadasIds.add(o.id);
  });

  const resultado: Record<string, OcupacionCentro> = {};
  Object.entries(centros).forEach(([centro, c]) => {
    const total = c.individuales + (c.hayCoworking ? 1 : 0);
    const ocupadas = c.ocupadasIds.size + (c.coworkingOcupado ? 1 : 0);
    resultado[centro] = { total, ocupadas, disponibles: Math.max(0, total - ocupadas) };
  });
  return resultado;
}
