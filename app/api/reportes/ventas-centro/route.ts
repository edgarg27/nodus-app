import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { accesoReporte, CENTROS_REPORTE } from "@/lib/reportesAcceso";

export const dynamic = "force-dynamic";

// Contratos que todavía no son venta (en espera de aprobar) o que se cayeron (igual que prospectos-medio).
const NO_VENDIDOS = ["pre_aprobado", "rechazado", "cancelado"];

export type FilaCentro = {
  centro: string;
  prospectos: number;
  convertidos: number;
  cotizaciones: number;
  contratos: number;
  rentaMensual: number;
  cobrado: number;
  facturado: number;
};

// Reporte "Ventas por centro" (/reportes): en el periodo, por centro, prospectos que llegaron (y cuántos ya son
// clientes), cotizaciones hechas, contratos cerrados (inicio en el periodo) con su renta mensual, lo cobrado (todo
// pago marcado como pagado en el periodo) y lo facturado (facturas timbradas no canceladas emitidas en el periodo).
export async function GET(req: NextRequest) {
  const acceso = await accesoReporte(req);
  if ("respuesta" in acceso) return acceso.respuesta;
  const { centro, desde, hasta } = acceso;
  const ini = `${desde}T00:00:00-06:00`;
  const fin = `${hasta}T23:59:59-06:00`;

  const admin = createAdminClient();
  let qProspectos = admin.from("prospectos").select("centro, estado").gte("created_at", ini).lte("created_at", fin);
  let qCotizaciones = admin.from("cotizaciones_comerciales").select("centro").gte("created_at", ini).lte("created_at", fin);
  let qContratos = admin
    .from("contratos")
    .select("centro, renta_mensual")
    .gte("fecha_inicio", desde)
    .lte("fecha_inicio", hasta)
    .not("estatus", "in", `(${NO_VENDIDOS.join(",")})`);
  let qPagos = admin.from("pagos").select("centro, monto").eq("estado", "pagado").gte("fecha_pago", desde).lte("fecha_pago", hasta);
  let qFacturas = admin
    .from("facturas")
    .select("centro, monto, cancelacion_estatus")
    .not("uuid_cfdi", "is", null)
    .gte("fecha_emision", desde)
    .lte("fecha_emision", hasta);
  if (centro) {
    qProspectos = qProspectos.eq("centro", centro);
    qCotizaciones = qCotizaciones.eq("centro", centro);
    qContratos = qContratos.eq("centro", centro);
    qPagos = qPagos.eq("centro", centro);
    qFacturas = qFacturas.eq("centro", centro);
  }
  const [{ data: prospectos }, { data: cotizaciones }, { data: contratos }, { data: pagos }, { data: facturas }] = await Promise.all([
    qProspectos.limit(20000),
    qCotizaciones.limit(20000),
    qContratos.limit(20000),
    qPagos.limit(50000),
    qFacturas.limit(50000),
  ]);

  const filas = new Map<string, FilaCentro>();
  const fila = (c: string | null | undefined) => {
    const k = (c || "").trim() || "Sin centro";
    if (!filas.has(k)) filas.set(k, { centro: k, prospectos: 0, convertidos: 0, cotizaciones: 0, contratos: 0, rentaMensual: 0, cobrado: 0, facturado: 0 });
    return filas.get(k) as FilaCentro;
  };
  // Todos los centros aparecen aunque no tengan movimiento, para comparar.
  (centro ? [centro] : CENTROS_REPORTE).forEach((c) => fila(c));
  (prospectos || []).forEach((p) => {
    const f = fila(p.centro);
    f.prospectos++;
    if (p.estado === "convertido") f.convertidos++;
  });
  (cotizaciones || []).forEach((c) => fila(c.centro).cotizaciones++);
  (contratos || []).forEach((c) => {
    const f = fila(c.centro);
    f.contratos++;
    f.rentaMensual += Number(c.renta_mensual) || 0;
  });
  (pagos || []).forEach((p) => (fila(p.centro).cobrado += Number(p.monto) || 0));
  (facturas || []).filter((f) => f.cancelacion_estatus !== "cancelada").forEach((f) => (fila(f.centro).facturado += Number(f.monto) || 0));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const resultado = Array.from(filas.values())
    .map((f) => ({ ...f, rentaMensual: r2(f.rentaMensual), cobrado: r2(f.cobrado), facturado: r2(f.facturado) }))
    .sort((a, b) => b.rentaMensual - a.rentaMensual || b.cobrado - a.cobrado || a.centro.localeCompare(b.centro));
  return NextResponse.json({ centro: centro || null, desde, hasta, filas: resultado });
}
