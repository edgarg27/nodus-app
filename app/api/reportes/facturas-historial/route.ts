import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { accesoReporte, CENTROS_REPORTE } from "@/lib/reportesAcceso";

export const dynamic = "force-dynamic";

type Totales = { facturas: number; facturado: number; pagado: number; porCobrar: number; canceladas: number };

export type CentroFacturas = Totales & { centro: string };
export type ClienteFacturas = Totales & {
  id: string | null;
  cliente: string;
  centro: string;
  ultima: string;
};
export type MesFacturas = { mes: string; facturas: number; facturado: number };

// Reporte "Historial de facturas" (/reportes): facturas timbradas por centro y por cliente (cuántas, cuánto se
// facturó, cuánto ya está pagado y cuánto falta), y por mes. Sin ?desde/?hasta es todo el historial. Las canceladas
// se cuentan aparte y no suman. El detalle de cada factura (PDF/XML) está en Facturación → Por cliente.
export async function GET(req: NextRequest) {
  const acceso = await accesoReporte(req, true);
  if ("respuesta" in acceso) return acceso.respuesta;
  const { centro, desde, hasta } = acceso;

  const admin = createAdminClient();
  let q = admin
    .from("facturas")
    .select("user_id, centro, monto, estado, fecha_emision, cancelacion_estatus")
    .not("uuid_cfdi", "is", null);
  if (centro) q = q.eq("centro", centro);
  if (desde) q = q.gte("fecha_emision", desde);
  if (hasta) q = q.lte("fecha_emision", hasta);
  const { data: facturas, error } = await q.order("fecha_emision", { ascending: false }).limit(50000);
  if (error) return NextResponse.json({ error: "No se pudieron leer las facturas" }, { status: 500 });

  const ids = Array.from(new Set((facturas || []).map((f) => f.user_id).filter(Boolean))) as string[];
  const { data: perfiles } = ids.length
    ? await admin.from("profiles").select("id, nombre, empresa, nombre_fiscal, numero_usuario").in("id", ids)
    : { data: [] as { id: string; nombre: string | null; empresa: string | null; nombre_fiscal: string | null; numero_usuario: string | null }[] };
  const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]));

  const vacio = (): Totales => ({ facturas: 0, facturado: 0, pagado: 0, porCobrar: 0, canceladas: 0 });
  const sumar = (t: Totales, f: { monto: number | null; estado: string | null; cancelacion_estatus: string | null }) => {
    if (f.cancelacion_estatus === "cancelada") {
      t.canceladas++;
      return;
    }
    const m = Number(f.monto) || 0;
    t.facturas++;
    t.facturado += m;
    if (f.estado === "pagada") t.pagado += m;
    else t.porCobrar += m;
  };

  const porCentro = new Map<string, CentroFacturas>();
  (centro ? [centro] : CENTROS_REPORTE).forEach((c) => porCentro.set(c, { centro: c, ...vacio() }));
  const porCliente = new Map<string, ClienteFacturas>();
  const porMes = new Map<string, MesFacturas>();

  for (const f of facturas || []) {
    const c = (f.centro || "").trim() || "Sin centro";
    if (!porCentro.has(c)) porCentro.set(c, { centro: c, ...vacio() });
    sumar(porCentro.get(c) as CentroFacturas, f);

    const k = `${f.user_id || "sin"}|${c}`;
    if (!porCliente.has(k)) {
      const p = f.user_id ? perfilPorId.get(f.user_id) : null;
      const nombre = p ? p.nombre_fiscal || p.empresa || p.nombre || "Sin nombre" : "Sin cliente ligado";
      porCliente.set(k, {
        id: f.user_id || null,
        cliente: p?.numero_usuario ? `${nombre} (${p.numero_usuario})` : nombre,
        centro: c,
        ultima: f.fecha_emision || "",
        ...vacio(),
      });
    }
    const cl = porCliente.get(k) as ClienteFacturas;
    sumar(cl, f);
    if ((f.fecha_emision || "") > cl.ultima) cl.ultima = f.fecha_emision || "";

    if (f.cancelacion_estatus !== "cancelada" && f.fecha_emision) {
      const mes = f.fecha_emision.slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, { mes, facturas: 0, facturado: 0 });
      const pm = porMes.get(mes) as MesFacturas;
      pm.facturas++;
      pm.facturado += Number(f.monto) || 0;
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const redondear = <T extends Totales>(t: T): T => ({ ...t, facturado: r2(t.facturado), pagado: r2(t.pagado), porCobrar: r2(t.porCobrar) });
  return NextResponse.json({
    centro: centro || null,
    desde: desde || null,
    hasta: hasta || null,
    centros: Array.from(porCentro.values()).map(redondear).sort((a, b) => b.facturado - a.facturado || a.centro.localeCompare(b.centro)),
    clientes: Array.from(porCliente.values()).map(redondear).sort((a, b) => b.facturado - a.facturado),
    meses: Array.from(porMes.values())
      .map((m) => ({ ...m, facturado: r2(m.facturado) }))
      .sort((a, b) => b.mes.localeCompare(a.mes)),
  });
}
