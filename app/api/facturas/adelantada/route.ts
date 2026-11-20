import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import { facturaCancelada } from "@/lib/cargosPeriodo";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
// Hasta cuántos meses hacia adelante se revisa qué rentas ya tienen estado de cuenta.
const MESES_A_REVISAR = 36;

// Factura adelantada (varios meses de renta en un solo estado de cuenta): los contratos vigentes del cliente con lo
// que se cobra al mes (renta + adicionales mensuales) y su fecha de fin, y, del contrato elegido, qué meses ya tienen
// su renta en un estado de cuenta vivo. La factura se crea con /api/facturas/integrar (una línea de renta por mes),
// que aparta cada mes en cargos_periodo: así el cobro diario ya no la genera.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const userId = q.get("userId") || "";
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, miProfile!.rol, miProfile!.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok) return NextResponse.json({ error: "No puedes consultar clientes de otro centro" }, { status: 403 });
  const cliente = acceso.cliente;
  const esGlobal = ROLES_GLOBALES.includes(miProfile!.rol);

  const { data: todos } = await admin.from("contratos").select("*").eq("user_id", userId).eq("estatus", "vigente").order("fecha_inicio", { ascending: false });
  const contratos = (todos || []).filter((c) => esGlobal || (c.centro ? c.centro === miProfile!.centro : cliente.centro === miProfile!.centro));

  const ids = contratos.map((c) => c.id as string);
  const oficinaIds = Array.from(new Set(contratos.map((c) => c.oficina_id).filter(Boolean))) as string[];
  const [{ data: extras }, { data: oficinas }] = await Promise.all([
    ids.length ? admin.from("contrato_adicionales").select("contrato_id, concepto, monto").in("contrato_id", ids) : Promise.resolve({ data: [] as { contrato_id: string; concepto: string; monto: number }[] }),
    oficinaIds.length ? admin.from("oficinas").select("id, numero, tipo").in("id", oficinaIds) : Promise.resolve({ data: [] as { id: string; numero: string | null; tipo: string | null }[] }),
  ]);
  const oficinaPorId = new Map((oficinas || []).map((o) => [o.id, o]));

  const contratosOut = contratos.map((c) => {
    const o = c.oficina_id ? oficinaPorId.get(c.oficina_id) : undefined;
    const centro: string = c.centro || cliente.centro || "";
    const adicionales = (extras || []).filter((e) => e.contrato_id === c.id && Number(e.monto) > 0).map((e) => ({ concepto: String(e.concepto), monto: Number(e.monto) }));
    return {
      id: c.id as string,
      folio: (c.folio as string | null) || null,
      centro,
      etiqueta: [c.folio, centro, o?.tipo, o?.numero ? "Oficina " + o.numero : null].filter(Boolean).join(" · ") || "Contrato",
      renta: Number(c.renta_mensual) || 0,
      adicionales,
      fechaInicio: (c.fecha_inicio as string | null) || null,
      fechaVencimiento: (c.fecha_vencimiento as string | null) || null,
      formaPago: (c.forma_pago as string | null) || null,
    };
  });

  // Meses del contrato elegido que ya tienen su renta en un estado de cuenta vivo (desde el mes actual).
  const contratoId = q.get("contratoId") || "";
  let ocupados: { periodo: string; folio: string }[] = [];
  if (contratoId) {
    if (!contratosOut.some((c) => c.id === contratoId)) return NextResponse.json({ error: "Ese contrato no es de este cliente o no está vigente" }, { status: 400 });
    const hoy = new Date();
    const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + MESES_A_REVISAR, 1);
    const hasta = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, "0")}-01`;
    const { data: marcas, error: errMarcas } = await admin
      .from("cargos_periodo")
      .select("periodo, factura_id")
      .eq("contrato_id", contratoId)
      .eq("tipo", "renta")
      .gte("periodo", desde)
      .lte("periodo", hasta)
      .not("factura_id", "is", null);
    if (errMarcas) return NextResponse.json({ error: "No se pudo revisar qué meses ya están facturados" }, { status: 500 });
    const { data: facturas } = (marcas || []).length
      ? await admin.from("facturas").select("id, folio, estado, cancelacion_estatus").in("id", (marcas || []).map((m) => m.factura_id))
      : { data: [] as { id: string; folio: string; estado: string; cancelacion_estatus: string | null }[] };
    ocupados = (marcas || []).flatMap((m) => {
      const f = (facturas || []).find((x) => x.id === m.factura_id);
      // Una factura cancelada ya no ocupa el mes.
      return f && !facturaCancelada(f) ? [{ periodo: String(m.periodo).slice(0, 10), folio: f.folio }] : [];
    });
  }

  return NextResponse.json({ contratos: contratosOut, ocupados });
}
