import { createAdminClient } from "@/lib/supabaseAdmin";

type Admin = ReturnType<typeof createAdminClient>;

// Qué renta y qué recargo ya se cobraron, por contrato y por mes
// (migracion_cargos_periodo.sql). Es la única forma de saberlo: el concepto y la
// fecha de una factura se pueden editar, un cliente puede tener varias facturas
// en el mes y una factura puede llevar la renta de dos contratos.
// Todo lo que lee lanza error si la consulta falla: "no pude revisar" nunca debe
// confundirse con "no existe", o se factura doble.

export type TipoCargo = "renta" | "recargo";
export type OrigenCargo = "cron" | "integrada";
export type CargoPeriodo = {
  id: string;
  contrato_id: string;
  user_id: string;
  periodo: string;
  tipo: TipoCargo;
  factura_id: string | null;
  pago_id: string | null;
  origen: OrigenCargo;
  created_at: string;
};

const COLUMNAS = "id, contrato_id, user_id, periodo, tipo, factura_id, pago_id, origen, created_at";
// El cobro diario aparta el mes y crea la factura en seguida. Un apartado sin factura
// más viejo que esto es de una corrida que se cayó a medias: se puede reponer.
const MINUTOS_APARTADO = 10;

// 'YYYY-MM-01' del mes de esa fecha (en la hora local del servidor, la de México).
export function periodoDe(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-01`;
}

function apartadoCaido(c: CargoPeriodo) {
  return !c.factura_id && Date.now() - new Date(c.created_at).getTime() > MINUTOS_APARTADO * 60 * 1000;
}

async function quitarApartadoCaido(admin: Admin, id: string) {
  const { error } = await admin.from("cargos_periodo").delete().eq("id", id).is("factura_id", null);
  if (error) throw new Error(`No se pudo liberar el cargo apartado: ${error.message}`);
}

// Para el cobro diario: el cargo de este contrato en el mes o, si no hay, el que el
// propio cobro diario generó en otro contrato del cliente. Como el cobro diario
// factura un solo contrato por cliente, esto evita una segunda renta si cambia cuál
// es su contrato más reciente (una renovación a media mensualidad).
export async function cargoDelPeriodo(
  admin: Admin,
  d: { userId: string; contratoId: string; periodo: string; tipo: TipoCargo }
): Promise<CargoPeriodo | null> {
  const { data, error } = await admin.from("cargos_periodo").select(COLUMNAS).eq("user_id", d.userId).eq("periodo", d.periodo).eq("tipo", d.tipo);
  if (error) throw new Error(`No se pudo revisar si ya existe el cargo del mes: ${error.message}`);
  const filas = (data || []) as CargoPeriodo[];
  const cargo = filas.find((c) => c.contrato_id === d.contratoId) || filas.find((c) => c.origen === "cron") || null;
  if (cargo && apartadoCaido(cargo)) {
    await quitarApartadoCaido(admin, cargo.id);
    return null;
  }
  return cargo;
}

// Reclama el mes para quien llama: la llave única deja pasar a uno solo. Devuelve el
// id del apartado, o null si otro proceso ganó.
export async function apartarCargo(
  admin: Admin,
  d: { userId: string; contratoId: string; periodo: string; tipo: TipoCargo; origen: OrigenCargo }
): Promise<string | null> {
  const { data, error } = await admin
    .from("cargos_periodo")
    .insert({ user_id: d.userId, contrato_id: d.contratoId, periodo: d.periodo, tipo: d.tipo, origen: d.origen })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw new Error(`No se pudo apartar el cargo del mes: ${error.message}`);
  }
  return data.id as string;
}

export async function ligarCargoAFactura(admin: Admin, cargoId: string, facturaId: string) {
  const { error } = await admin.from("cargos_periodo").update({ factura_id: facturaId }).eq("id", cargoId);
  if (error) throw new Error(`No se pudo ligar el cargo a su factura: ${error.message}`);
}

export async function soltarCargo(admin: Admin, cargoId: string) {
  const { error } = await admin.from("cargos_periodo").delete().eq("id", cargoId);
  if (error) throw new Error(`No se pudo liberar el cargo apartado: ${error.message}`);
}

export const facturaCancelada = (f: { estado: string | null; cancelacion_estatus?: string | null }) =>
  f.estado === "cancelada" || f.cancelacion_estatus === "cancelada";

// En qué va la factura de un cargo. Registrar el pago de una línea (Acciones > Pago, Cobranza) marca el
// pago pero NO cambia facturas.estado, así que "ya se pagó" se calcula también con las líneas: la renta
// está liquidada si la factura está pagada o si su línea ya se pagó, aunque otra línea siga pendiente.
export async function estadoDelCargo(admin: Admin, cargo: CargoPeriodo) {
  if (!cargo.factura_id) return null;
  const { data: factura, error } = await admin
    .from("facturas")
    .select("id, folio, concepto, monto, estado, fecha_vencimiento, cancelacion_estatus")
    .eq("id", cargo.factura_id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la factura del cargo: ${error.message}`);
  if (!factura) return null;

  const { data: pagos, error: errPagos } = await admin.from("pagos").select("id, estado, monto, openpay_charge_id").eq("factura_id", factura.id);
  if (errPagos) throw new Error(`No se pudieron leer los pagos de la factura: ${errPagos.message}`);
  const lineas = pagos || [];
  const pagado = lineas.filter((p) => p.estado === "pagado").reduce((s, p) => s + Number(p.monto), 0);
  const liquidada =
    factura.estado === "pagada" ||
    (cargo.pago_id ? lineas.some((p) => p.id === cargo.pago_id && p.estado === "pagado") : lineas.length > 0 && pagado >= Number(factura.monto) - 0.01);

  return {
    factura,
    cancelada: facturaCancelada(factura),
    liquidada,
    // Líneas capturadas a mano (no los cargos de Openpay): la factura ya no es solo la renta generada.
    tieneLineas: lineas.some((p) => !p.openpay_charge_id),
  };
}

// Para Integrar: si la renta de ese contrato y mes ya está en una factura viva, su folio. Una factura
// cancelada ya no la ocupa: se devuelve el id de su marca para reemplazarla al integrar.
export async function rentaOcupada(
  admin: Admin,
  contratoId: string,
  periodo: string
): Promise<{ folio: string | null } | { reemplazar: string | null }> {
  const { data, error } = await admin.from("cargos_periodo").select(COLUMNAS).eq("contrato_id", contratoId).eq("periodo", periodo).eq("tipo", "renta").maybeSingle();
  if (error) throw new Error(`No se pudo revisar si la renta ya existe: ${error.message}`);
  const cargo = data as CargoPeriodo | null;
  if (!cargo) return { reemplazar: null };
  if (!cargo.factura_id) {
    if (apartadoCaido(cargo)) return { reemplazar: cargo.id };
    return { folio: null };
  }
  const { data: factura, error: errFactura } = await admin.from("facturas").select("folio, estado, cancelacion_estatus").eq("id", cargo.factura_id).maybeSingle();
  if (errFactura) throw new Error(`No se pudo leer la factura de la renta: ${errFactura.message}`);
  if (!factura || facturaCancelada(factura)) return { reemplazar: cargo.id };
  return { folio: factura.folio as string | null };
}
