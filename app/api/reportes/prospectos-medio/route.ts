import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive"];
const ROLES_GLOBALES = ["gerente", "gerente_ventas", "superadmin", "sistemas", "ceo", "captive"];
// Contratos que todavía no son venta (en espera de aprobar) o que se cayeron.
const NO_VENDIDOS = ["pre_aprobado", "rechazado", "cancelado"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type FilaMedio = {
  medio: string;
  prospectos: number;
  convertidos: number;
  contratos: number;
  rentaMensual: number;
  cobrado: number;
};

// Reporte "Prospectos y ventas por medio de contacto" (Reportes y Panel de Dirección): por cada medio, cuántos
// prospectos llegaron en el periodo, cuántos se convirtieron en cliente, cuántos contratos se cerraron (inicio en el
// periodo), su renta mensual y lo que ya se cobró de esos contratos en el periodo.
// El medio de una venta es el de su cotización; si la cotización no lo tiene, el del prospecto.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!yo || !ROLES.includes(yo.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const desde = sp.get("desde") || "";
  const hasta = sp.get("hasta") || "";
  if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: "Fechas no válidas" }, { status: 400 });
  const centro = ROLES_GLOBALES.includes(yo.rol) ? sp.get("centro") || "" : yo.centro || "";

  const admin = createAdminClient();
  let qProspectos = admin.from("prospectos").select("id, medio, estado, centro, created_at").gte("created_at", `${desde}T00:00:00-06:00`).lte("created_at", `${hasta}T23:59:59-06:00`);
  let qContratos = admin
    .from("contratos")
    .select("id, cotizacion_id, estatus, renta_mensual, fecha_inicio, centro")
    .gte("fecha_inicio", desde)
    .lte("fecha_inicio", hasta)
    .not("estatus", "in", `(${NO_VENDIDOS.join(",")})`);
  if (centro) {
    qProspectos = qProspectos.eq("centro", centro);
    qContratos = qContratos.eq("centro", centro);
  }
  const [{ data: prospectos }, { data: contratos }] = await Promise.all([qProspectos.limit(20000), qContratos.limit(20000)]);

  // Medio de cada contrato vendido: cotización → (medio de la cotización o del prospecto).
  const idsCot = Array.from(new Set((contratos || []).map((c) => c.cotizacion_id).filter(Boolean))) as string[];
  const { data: cotizaciones } = idsCot.length
    ? await admin.from("cotizaciones_comerciales").select("id, medio_contacto, prospecto_id").in("id", idsCot)
    : { data: [] as { id: string; medio_contacto: string | null; prospecto_id: string | null }[] };
  const idsProsp = Array.from(new Set((cotizaciones || []).map((c) => c.prospecto_id).filter(Boolean))) as string[];
  const { data: prospDeVentas } = idsProsp.length
    ? await admin.from("prospectos").select("id, medio").in("id", idsProsp)
    : { data: [] as { id: string; medio: string | null }[] };
  const medioProspecto = new Map((prospDeVentas || []).map((p) => [p.id, p.medio]));
  const medioCotizacion = new Map(
    (cotizaciones || []).map((c) => [c.id, c.medio_contacto || (c.prospecto_id ? medioProspecto.get(c.prospecto_id) : null) || null])
  );

  // Lo cobrado en el periodo de esos contratos.
  const idsContrato = (contratos || []).map((c) => c.id);
  const { data: pagos } = idsContrato.length
    ? await admin.from("pagos").select("contrato_id, monto").eq("estado", "pagado").in("contrato_id", idsContrato).gte("fecha_pago", desde).lte("fecha_pago", hasta)
    : { data: [] as { contrato_id: string; monto: number }[] };
  const cobradoPorContrato = new Map<string, number>();
  (pagos || []).forEach((p) => cobradoPorContrato.set(p.contrato_id, (cobradoPorContrato.get(p.contrato_id) || 0) + (Number(p.monto) || 0)));

  const filas = new Map<string, FilaMedio>();
  const fila = (medio: string | null | undefined) => {
    const k = (medio || "").trim() || "Sin medio";
    if (!filas.has(k)) filas.set(k, { medio: k, prospectos: 0, convertidos: 0, contratos: 0, rentaMensual: 0, cobrado: 0 });
    return filas.get(k) as FilaMedio;
  };
  for (const p of prospectos || []) {
    const f = fila(p.medio);
    f.prospectos++;
    if (p.estado === "convertido") f.convertidos++;
  }
  for (const c of contratos || []) {
    const f = fila(c.cotizacion_id ? medioCotizacion.get(c.cotizacion_id) : null);
    f.contratos++;
    f.rentaMensual += Number(c.renta_mensual) || 0;
    f.cobrado += cobradoPorContrato.get(c.id) || 0;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const resultado = Array.from(filas.values())
    .map((f) => ({ ...f, rentaMensual: r2(f.rentaMensual), cobrado: r2(f.cobrado) }))
    .sort((a, b) => b.rentaMensual - a.rentaMensual || b.prospectos - a.prospectos);
  return NextResponse.json({ centro: centro || null, desde, hasta, filas: resultado });
}
