import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { categorizarPago, servicioDePago, type CategoriaPago } from "@/lib/pagosCategoria";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "gerente", "cobranza", "gerente_ventas", "superadmin", "sistemas"];
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type EstadoFacturacion = "timbrada" | "integrada" | "sin_facturar";

export type Movimiento = {
  id: string;
  origen: "pago" | "factura";
  fecha: string;
  userId: string | null;
  cliente: string;
  concepto: string;
  categoria: CategoriaPago;
  servicio: string;
  monto: number;
  formaPago: string | null;
  facturacion: EstadoFacturacion;
  folio: string | null;
  comprobanteUrl: string | null;
};

const timbrada = (f: { uuid_cfdi: string | null; estado: string; cancelacion_estatus: string | null } | undefined) =>
  !!f?.uuid_cfdi && f.estado !== "cancelada" && f.cancelacion_estatus !== "cancelada";

// Ingresos por Centro: todo lo que ya se cobró en el rango (registrado a mano en Cobranza → Pagado, o al aprobar el
// comprobante del cliente), con su servicio, su forma de pago y si ya se facturó. Incluye:
//   - pagos en estado "pagado" (por fecha de pago); los que el cliente subió sin centro cuentan para el centro del cliente;
//   - facturas "pagadas" que no tienen pagos ligados (importadas de ZORA o marcadas pagadas en Cobranza), por fecha de emisión.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!yo || !ROLES.includes(yo.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const centro = ROLES_GLOBALES.includes(yo.rol) ? sp.get("centro") || yo.centro : yo.centro;
  const desde = sp.get("desde") || "";
  const hasta = sp.get("hasta") || "";
  if (!centro) return NextResponse.json({ error: "Sin centro" }, { status: 400 });
  if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: "Fechas no válidas" }, { status: 400 });

  const admin = createAdminClient();
  const { data: clientes } = await admin.from("profiles").select("id, nombre, empresa, nombre_fiscal").eq("rol", "cliente").eq("centro", centro);
  const idsCentro = (clientes || []).map((c) => c.id);

  const columnas = "id, user_id, concepto, monto, fecha_pago, contrato_id, factura_id, adicional_tipo, forma_pago, comprobante_url";
  const [{ data: pagosCentro }, { data: pagosSinCentro }, { data: facturasPagadas }] = await Promise.all([
    admin.from("pagos").select(columnas).eq("estado", "pagado").eq("centro", centro).gte("fecha_pago", desde).lte("fecha_pago", hasta),
    idsCentro.length
      ? admin.from("pagos").select(columnas).eq("estado", "pagado").is("centro", null).in("user_id", idsCentro.slice(0, 1000)).gte("fecha_pago", desde).lte("fecha_pago", hasta)
      : Promise.resolve({ data: [] as any[] }),
    admin
      .from("facturas")
      .select("id, user_id, folio, concepto, monto, fecha_emision, forma_pago, uuid_cfdi, estado, cancelacion_estatus, nombre_receptor")
      .eq("estado", "pagada")
      .eq("centro", centro)
      .gte("fecha_emision", desde)
      .lte("fecha_emision", hasta),
  ]);
  const pagos = [...(pagosCentro || []), ...(pagosSinCentro || [])];

  // Facturas de los pagos (para saber si ya se facturaron) y si las facturas pagadas tienen pagos ligados.
  const idsFacturaPagos = Array.from(new Set(pagos.map((p) => p.factura_id).filter(Boolean))) as string[];
  const idsFacturasPagadas = (facturasPagadas || []).map((f) => f.id);
  const [{ data: facturasDePagos }, { data: ligados }] = await Promise.all([
    idsFacturaPagos.length
      ? admin.from("facturas").select("id, folio, uuid_cfdi, estado, cancelacion_estatus").in("id", idsFacturaPagos)
      : Promise.resolve({ data: [] as any[] }),
    idsFacturasPagadas.length
      ? admin.from("pagos").select("factura_id").in("factura_id", idsFacturasPagadas)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const facturaPorId = new Map((facturasDePagos || []).map((f) => [f.id, f]));
  const conPagos = new Set((ligados || []).map((p) => p.factura_id));

  // Tipo de espacio de cada contrato (para separar la renta por Coworking / Oficina Privada / Working Desk).
  const idsContrato = Array.from(new Set(pagos.map((p) => p.contrato_id).filter(Boolean))) as string[];
  const tipoPorContrato = new Map<string, string>();
  if (idsContrato.length) {
    const { data: contratos } = await admin.from("contratos").select("id, paquete_id, oficina_id").in("id", idsContrato);
    const idsPaquete = Array.from(new Set((contratos || []).map((c) => c.paquete_id).filter(Boolean))) as string[];
    const idsOficina = Array.from(new Set((contratos || []).map((c) => c.oficina_id).filter(Boolean))) as string[];
    const [{ data: paquetes }, { data: oficinas }] = await Promise.all([
      idsPaquete.length ? admin.from("paquetes").select("id, tipo_espacio").in("id", idsPaquete) : Promise.resolve({ data: [] as any[] }),
      idsOficina.length ? admin.from("oficinas").select("id, tipo").in("id", idsOficina) : Promise.resolve({ data: [] as any[] }),
    ]);
    const tipoPaquete = new Map((paquetes || []).map((p) => [p.id, p.tipo_espacio]));
    const tipoOficina = new Map((oficinas || []).map((o) => [o.id, o.tipo]));
    for (const c of contratos || []) {
      const tipo = (c.paquete_id && tipoPaquete.get(c.paquete_id)) || (c.oficina_id && tipoOficina.get(c.oficina_id));
      if (tipo) tipoPorContrato.set(c.id, tipo);
    }
  }

  // Nombres de clientes (incluye a los de otros centros que tengan pagos aquí).
  const nombres = new Map((clientes || []).map((c) => [c.id, c.nombre_fiscal || c.empresa || c.nombre]));
  const faltan = Array.from(new Set([...pagos, ...(facturasPagadas || [])].map((x) => x.user_id).filter((id) => id && !nombres.has(id)))) as string[];
  if (faltan.length) {
    const { data: otros } = await admin.from("profiles").select("id, nombre, empresa, nombre_fiscal").in("id", faltan);
    (otros || []).forEach((c) => nombres.set(c.id, c.nombre_fiscal || c.empresa || c.nombre));
  }

  const movimientos: Movimiento[] = [];
  for (const p of pagos) {
    const f = p.factura_id ? facturaPorId.get(p.factura_id) : undefined;
    const facturacion: EstadoFacturacion = timbrada(f) ? "timbrada" : f ? "integrada" : "sin_facturar";
    movimientos.push({
      id: p.id,
      origen: "pago",
      fecha: String(p.fecha_pago).slice(0, 10),
      userId: p.user_id,
      cliente: (p.user_id && nombres.get(p.user_id)) || "Sin cliente",
      concepto: p.concepto || "Pago",
      categoria: categorizarPago(p.concepto, p.adicional_tipo),
      servicio: servicioDePago(p.concepto, p.adicional_tipo, p.contrato_id ? tipoPorContrato.get(p.contrato_id) : null),
      monto: Number(p.monto) || 0,
      formaPago: p.forma_pago || null,
      facturacion,
      folio: f?.folio || null,
      comprobanteUrl: p.comprobante_url || null,
    });
  }
  for (const f of facturasPagadas || []) {
    if (conPagos.has(f.id)) continue;
    if (f.cancelacion_estatus === "cancelada") continue;
    movimientos.push({
      id: f.id,
      origen: "factura",
      fecha: String(f.fecha_emision).slice(0, 10),
      userId: f.user_id,
      cliente: (f.user_id && nombres.get(f.user_id)) || f.nombre_receptor || "Sin cliente",
      concepto: f.concepto || "Factura",
      categoria: categorizarPago(f.concepto, null),
      servicio: servicioDePago(f.concepto, null, null),
      monto: Number(f.monto) || 0,
      formaPago: f.forma_pago && f.forma_pago !== "99" ? f.forma_pago : null,
      facturacion: f.uuid_cfdi ? "timbrada" : "integrada",
      folio: f.folio,
      comprobanteUrl: null,
    });
  }
  movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return NextResponse.json({ centro, movimientos });
}
