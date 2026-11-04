import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { TIPOS_SERVICIO, etiquetaTipoServicio } from "@/lib/tipoServicio";
import { tipoServicioFactura } from "@/lib/adicionales";
import { categorizarPago } from "@/lib/pagosCategoria";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const r2 = (n: number) => Math.round(n * 100) / 100;

// "Facturado por servicio": lo timbrado en un mes (sin canceladas ni complementos), agrupado por el tipo de servicio
// del contrato del cliente (Oficina privada, Coworking, Working desk, Oficina virtual) y, dentro, por concepto
// (renta, penalización, telefonía…). El tipo sale del contrato de esa renta (cargos_periodo) o, si no, del contrato
// vigente más reciente del cliente.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const mes = req.nextUrl.searchParams.get("mes") || "";
  if (!/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json({ error: "Elige el mes" }, { status: 400 });
  const [anio, m] = mes.split("-").map(Number);
  const inicio = `${mes}-01`;
  const fin = `${mes}-${String(new Date(anio, m, 0).getDate()).padStart(2, "0")}`;
  const pedido = req.nextUrl.searchParams.get("centro") || "";
  const centro = ROLES_GLOBALES.includes(yo!.rol) ? pedido : yo!.centro || "";
  if (!ROLES_GLOBALES.includes(yo!.rol) && !centro) return NextResponse.json({ error: "Tu cuenta no tiene centro" }, { status: 400 });

  const admin = createAdminClient();
  let consulta = admin
    .from("facturas")
    .select("id, user_id, folio, serie, folio_fiscal, centro, monto, subtotal, iva, fecha_emision, cancelacion_estatus, tipo_comprobante, adicional_tipo")
    .not("uuid_cfdi", "is", null)
    .gte("fecha_emision", inicio)
    .lte("fecha_emision", fin)
    .order("fecha_emision");
  if (centro) consulta = consulta.eq("centro", centro);
  const { data: todas, error } = await consulta;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const facturas = (todas || []).filter((f) => f.cancelacion_estatus !== "cancelada" && (f.tipo_comprobante || "I") === "I");
  const ids = facturas.map((f) => f.id);
  const userIds = Array.from(new Set(facturas.map((f) => f.user_id).filter(Boolean))) as string[];

  const [{ data: marcas }, { data: contratosClientes }, { data: pagos }, { data: perfiles }] = await Promise.all([
    ids.length ? admin.from("cargos_periodo").select("factura_id, contrato_id").in("factura_id", ids) : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? admin.from("contratos").select("id, user_id, tipo_servicio, estatus, fecha_inicio").in("user_id", userIds).order("fecha_inicio", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("pagos").select("factura_id, monto, concepto, adicional_tipo").in("factura_id", ids) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? admin.from("profiles").select("id, nombre, empresa, nombre_fiscal").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  function tipoDe(f: (typeof facturas)[number]): string | null {
    const contratos = (contratosClientes || []).filter((c) => c.user_id === f.user_id);
    const deLaRenta = (marcas || []).find((x) => x.factura_id === f.id)?.contrato_id;
    const c = contratos.find((x) => x.id === deLaRenta) || contratos.find((x) => x.estatus === "vigente") || contratos[0];
    return c?.tipo_servicio || null;
  }
  // Qué se facturó: un renglón por pago ligado (si suman el total); si no, todo es la renta (o su tipo de cobro).
  function conceptosDe(f: (typeof facturas)[number]) {
    const ligados = (pagos || []).filter((p) => p.factura_id === f.id);
    const suma = ligados.reduce((s, p) => s + Number(p.monto), 0);
    const nombre = (adicionalTipo: string | null | undefined, concepto?: string | null) =>
      adicionalTipo ? tipoServicioFactura(adicionalTipo)?.etiqueta || "Otros" : categorizarPago(concepto) === "deposito" ? "Depósito" : "Renta";
    if (ligados.length > 0 && Math.abs(suma - Number(f.monto)) <= 0.01) return ligados.map((p) => ({ concepto: nombre(p.adicional_tipo, p.concepto), total: Number(p.monto) }));
    return [{ concepto: nombre(f.adicional_tipo), total: Number(f.monto) }];
  }

  const porTipo = new Map<string, { facturas: number; subtotal: number; iva: number; total: number; conceptos: Map<string, number> }>();
  const detalle = facturas.map((f) => {
    const tipo = tipoDe(f) || "sin_tipo";
    const conceptos = conceptosDe(f);
    const total = Number(f.monto) || 0;
    const subtotal = f.subtotal != null ? Number(f.subtotal) : r2(total / 1.16);
    const iva = f.iva != null ? Number(f.iva) : r2(total - subtotal);
    const g = porTipo.get(tipo) || { facturas: 0, subtotal: 0, iva: 0, total: 0, conceptos: new Map<string, number>() };
    g.facturas++;
    g.subtotal += subtotal;
    g.iva += iva;
    g.total += total;
    for (const c of conceptos) g.conceptos.set(c.concepto, (g.conceptos.get(c.concepto) || 0) + c.total);
    porTipo.set(tipo, g);
    const p = (perfiles || []).find((x) => x.id === f.user_id);
    return {
      id: f.id,
      folio: f.serie && f.folio_fiscal ? `${f.serie}-${f.folio_fiscal}` : f.folio,
      fecha: f.fecha_emision,
      centro: f.centro,
      cliente: f.user_id ? p?.nombre_fiscal || p?.empresa || p?.nombre || "Cliente" : "Público en general",
      tipo,
      tipoEtiqueta: tipo === "sin_tipo" ? "Sin tipo" : etiquetaTipoServicio(tipo),
      conceptos: conceptos.map((c) => c.concepto).join(", "),
      subtotal: r2(subtotal),
      iva: r2(iva),
      total: r2(total),
    };
  });

  const orden = [...TIPOS_SERVICIO.map((t) => t.clave as string), "sin_tipo"];
  const resumen = orden
    .filter((t) => porTipo.has(t))
    .map((t) => {
      const g = porTipo.get(t)!;
      return {
        tipo: t,
        etiqueta: t === "sin_tipo" ? "Sin tipo" : etiquetaTipoServicio(t),
        facturas: g.facturas,
        subtotal: r2(g.subtotal),
        iva: r2(g.iva),
        total: r2(g.total),
        conceptos: Array.from(g.conceptos.entries())
          .map(([concepto, total]) => ({ concepto, total: r2(total) }))
          .sort((a, b) => b.total - a.total),
      };
    });

  return NextResponse.json({
    mes,
    centro: centro || null,
    resumen,
    totales: {
      facturas: detalle.length,
      subtotal: r2(detalle.reduce((s, d) => s + d.subtotal, 0)),
      iva: r2(detalle.reduce((s, d) => s + d.iva, 0)),
      total: r2(detalle.reduce((s, d) => s + d.total, 0)),
    },
    detalle,
  });
}
