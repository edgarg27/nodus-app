import type { SupabaseClient } from "@supabase/supabase-js";

// Los vouchers de WiFi ya solo se dan a clientes de Coworking (ahí se
// quedan por días u horas; las oficinas usan su propia red). Un cliente
// cuenta como de Coworking si tiene al menos un contrato VIGENTE cuyo
// espacio es Coworking: por la oficina ligada (oficinas.tipo) o por el
// paquete (paquetes.tipo_espacio). Si tiene oficina
// y además Coworking, cuenta como Coworking.
//
// Sirve igual con el cliente del navegador, el del servidor o el admin
// (Service Role) del cron.

function esTipoCoworking(tipo: string | null | undefined) {
  return !!tipo && tipo.trim().toLowerCase() === "coworking";
}

export const AVISO_SOLO_COWORKING = "Los vouchers de WiFi solo se generan para clientes con contrato vigente de Coworking.";

export type EspaciosClientes = {
  // user_id con Coworking vigente.
  coworking: Set<string>;
  // user_id → espacios de sus contratos vigentes (ej. "Oficina 3",
  // "Espacio A"), para agrupar en Vouchers por lo que dice el contrato y no
  // por profiles.numero_oficina (que casi nunca se llena).
  espacios: Map<string, string[]>;
};

// Lee los contratos vigentes (de todos, o solo de userIds) y resuelve su
// tipo de espacio y número.
export async function espaciosDeClientes(supabase: SupabaseClient, userIds?: string[]): Promise<EspaciosClientes> {
  const vacio: EspaciosClientes = { coworking: new Set(), espacios: new Map() };
  if (userIds && userIds.length === 0) return vacio;

  let q = supabase
    .from("contratos")
    .select("user_id, oficina_id, paquete_id")
    .eq("estatus", "vigente")
    .not("user_id", "is", null);
  if (userIds) q = q.in("user_id", userIds);
  const { data: contratos } = await q;
  if (!contratos || contratos.length === 0) return vacio;

  const oficinaIds = Array.from(new Set(contratos.map((c) => c.oficina_id).filter(Boolean))) as string[];
  const paqueteIds = Array.from(new Set(contratos.map((c) => c.paquete_id).filter(Boolean))) as string[];
  const [{ data: oficinas }, { data: paquetes }] = await Promise.all([
    oficinaIds.length > 0
      ? supabase.from("oficinas").select("id, numero, tipo").in("id", oficinaIds)
      : Promise.resolve({ data: [] as { id: string; numero: string | null; tipo: string | null }[] }),
    paqueteIds.length > 0
      ? supabase.from("paquetes").select("id, tipo_espacio").in("id", paqueteIds)
      : Promise.resolve({ data: [] as { id: string; tipo_espacio: string | null }[] }),
  ]);
  const oficinaPorId = new Map((oficinas || []).map((o) => [o.id, o]));
  const tipoPaquete = new Map((paquetes || []).map((p) => [p.id, p.tipo_espacio]));

  for (const c of contratos) {
    const userId = c.user_id as string;
    const oficina = c.oficina_id ? oficinaPorId.get(c.oficina_id) : undefined;
    const porPaquete = c.paquete_id ? tipoPaquete.get(c.paquete_id) : null;
    const esCow = esTipoCoworking(oficina?.tipo) || esTipoCoworking(porPaquete);
    if (esCow) vacio.coworking.add(userId);
    if (oficina?.numero) {
      const etiqueta = `${esCow ? "Espacio" : "Oficina"} ${oficina.numero}`;
      const lista = vacio.espacios.get(userId) || [];
      if (!lista.includes(etiqueta)) lista.push(etiqueta);
      vacio.espacios.set(userId, lista);
    }
  }
  return vacio;
}

// Regresa el conjunto de user_id con Coworking vigente. Si se pasan
// userIds, solo revisa esos (más ligero); si no, revisa todos.
export async function clientesConCoworking(supabase: SupabaseClient, userIds?: string[]): Promise<Set<string>> {
  return (await espaciosDeClientes(supabase, userIds)).coworking;
}

export async function esClienteCoworking(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await clientesConCoworking(supabase, [userId])).has(userId);
}
