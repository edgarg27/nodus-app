// Datos de Cobranza: por cliente, lo que debe (cargos pendientes con su fecha límite) y lo que ha pagado.
// Un "cargo" es un pago pendiente (renta, adicional, depósito…) o una factura pendiente que no tiene pagos ligados
// (por ejemplo, las importadas). La fecha límite es la del estado de cuenta; un cargo suelto vence a los 10 días.
import type { createAdminClient } from "@/lib/supabaseAdmin";
import { etiquetaPagoSuelto } from "@/lib/adicionales";

type Admin = ReturnType<typeof createAdminClient>;

export const DIAS_PARA_PAGAR = 10;

export type TipoCargo = "renta" | "adicional" | "deposito" | "otro";

export type ClienteCobranza = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  telefono: string | null;
  centro: string | null;
  suspendido: boolean;
  activo: boolean;
  numero_usuario: string | null;
  nombre_fiscal: string | null;
};

export type Cargo = {
  id: string;
  origen: "pago" | "factura";
  userId: string;
  concepto: string;
  monto: number;
  estado: string;
  fechaLimite: string;
  tipo: TipoCargo;
  comprobanteUrl: string | null;
  folio: string | null;
  centro: string | null;
};

export type Pagado = { userId: string; monto: number; fecha: string; tipo: TipoCargo; centro: string | null };

export type Baja = { userId: string; fechaBaja: string | null; montoAdeudado: number };

export function tipoDeCargo(concepto: string | null | undefined, adicionalTipo: string | null | undefined): TipoCargo {
  if (adicionalTipo) return "adicional";
  const c = (concepto || "").toLowerCase();
  if (/dep[oó]sito/.test(c)) return "deposito";
  if (/renta|mensualidad|contrato|estacionamiento/.test(c)) return "renta";
  return "otro";
}

function sumarDias(iso: string, dias: number) {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
}

async function enTrozos<T>(ids: string[], consulta: (trozo: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const res: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await consulta(ids.slice(i, i + 200));
    res.push(...(data || []));
  }
  return res;
}

// centro null = todos los centros. userIds = solo esos clientes (recordatorios).
export async function cargarCobranza(admin: Admin, opts: { centro: string | null; userIds?: string[] }) {
  let q = admin.from("profiles").select("id, nombre, email, empresa, telefono, centro, suspendido, activo, numero_usuario, nombre_fiscal").eq("rol", "cliente");
  if (opts.centro) q = q.eq("centro", opts.centro);
  if (opts.userIds) q = q.in("id", opts.userIds);
  const { data: perfiles } = await q.order("nombre");
  const todos = (perfiles || []) as ClienteCobranza[];
  const ids = todos.map((c) => c.id);

  const pagos = await enTrozos<any>(ids, (t) =>
    admin.from("pagos").select("id, user_id, concepto, monto, estado, adicional_tipo, factura_id, created_at, fecha_pago, comprobante_url, centro").in("user_id", t)
  );
  const facturas = await enTrozos<any>(ids, (t) =>
    admin.from("facturas").select("id, user_id, folio, concepto, monto, estado, fecha_emision, fecha_vencimiento, cancelacion_estatus, centro").in("user_id", t)
  );
  const facturaPorId = new Map(facturas.map((f) => [f.id, f]));
  const facturasConPagos = new Set(pagos.map((p) => p.factura_id).filter(Boolean));

  const cargos: Cargo[] = [];
  const pagados: Pagado[] = [];
  for (const p of pagos) {
    const tipo = tipoDeCargo(p.concepto, p.adicional_tipo);
    if (p.estado === "pagado") {
      pagados.push({ userId: p.user_id, monto: Number(p.monto) || 0, fecha: String(p.fecha_pago || p.created_at).slice(0, 10), tipo, centro: p.centro || null });
      continue;
    }
    if (["cancelado", "rechazado"].includes(p.estado)) continue;
    const f = p.factura_id ? facturaPorId.get(p.factura_id) : null;
    if (f && (f.estado === "cancelada" || f.cancelacion_estatus === "cancelada")) continue;
    cargos.push({
      id: p.id,
      origen: "pago",
      userId: p.user_id,
      concepto: etiquetaPagoSuelto(p.concepto),
      monto: Number(p.monto) || 0,
      estado: p.estado,
      fechaLimite: f?.fecha_vencimiento || sumarDias(String(p.created_at), DIAS_PARA_PAGAR),
      tipo,
      comprobanteUrl: p.comprobante_url || null,
      folio: f?.folio || null,
      centro: p.centro || null,
    });
  }
  for (const f of facturas) {
    if (facturasConPagos.has(f.id)) continue;
    if (["pagada", "cancelada"].includes(f.estado) || f.cancelacion_estatus === "cancelada") continue;
    cargos.push({
      id: f.id,
      origen: "factura",
      userId: f.user_id,
      concepto: f.concepto || "Factura",
      monto: Number(f.monto) || 0,
      estado: f.estado,
      fechaLimite: f.fecha_vencimiento || f.fecha_emision,
      tipo: tipoDeCargo(f.concepto, null),
      comprobanteUrl: null,
      folio: f.folio,
      centro: f.centro || null,
    });
  }

  // Bajas que se fueron debiendo (contrato "inactivo_debe"): el adeudo que se anotó al darlos de baja.
  const contratosBaja = await enTrozos<any>(ids, (t) =>
    admin.from("contratos").select("user_id, fecha_baja, monto_adeudado").eq("estatus", "inactivo_debe").in("user_id", t)
  );
  const bajas: Baja[] = contratosBaja.map((ct) => ({
    userId: ct.user_id,
    fechaBaja: ct.fecha_baja,
    montoAdeudado: Number(ct.monto_adeudado) || 0,
  }));

  // Clientes: los activos, más los inactivos (bajas) que todavía deben algo.
  const conDeuda = new Set([...cargos.map((c) => c.userId), ...bajas.map((b) => b.userId)]);
  const clientes = todos.filter((c) => c.activo || conDeuda.has(c.id));
  return { clientes, cargos, pagados, bajas };
}

// Saldo y fecha límite más próxima de un cliente (para el texto de los recordatorios).
export function resumenCliente(cargos: Cargo[], userId: string) {
  const suyos = cargos.filter((c) => c.userId === userId);
  const saldo = Math.round(suyos.reduce((s, c) => s + c.monto, 0) * 100) / 100;
  const fechaLimite = suyos.map((c) => c.fechaLimite).sort()[0] || null;
  return { saldo, fechaLimite };
}
