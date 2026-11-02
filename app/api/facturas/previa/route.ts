import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { cargarCatalogo } from "@/lib/catalogoServicios";
import { accesoCliente } from "@/lib/facturasAcceso";
import { facturaCancelada } from "@/lib/cargosPeriodo";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Integrar por cliente: contratos del cliente (con su folio) y, con "previa", lo que se le puede cobrar en el mes:
// renta y adicionales mensuales de cada contrato, más sus pagos sueltos sin factura.
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

  const todos = q.get("estatus") === "todos";
  // select("*"): el folio del contrato es una columna nueva (migracion_contratos_folio.sql); así no falla si aún no existe.
  let consulta = admin.from("contratos").select("*").eq("user_id", userId);
  if (!todos) consulta = consulta.eq("estatus", "vigente");
  const { data: todosContratos } = await consulta.order("fecha_inicio", { ascending: false });
  // Quien no es global solo ve los contratos de su centro.
  const contratos = (todosContratos || []).filter((c) => esGlobal || (c.centro ? c.centro === miProfile!.centro : cliente.centro === miProfile!.centro));

  const oficinaIds = Array.from(new Set((contratos || []).map((c) => c.oficina_id).filter(Boolean))) as string[];
  const paqueteIds = Array.from(new Set((contratos || []).map((c) => c.paquete_id).filter(Boolean))) as string[];
  const [{ data: oficinas }, { data: paquetes }] = await Promise.all([
    oficinaIds.length ? admin.from("oficinas").select("id, numero, tipo").in("id", oficinaIds) : Promise.resolve({ data: [] as { id: string; numero: string | null; tipo: string | null }[] }),
    paqueteIds.length ? admin.from("paquetes").select("id, nombre, tipo_espacio").in("id", paqueteIds) : Promise.resolve({ data: [] as { id: string; nombre: string | null; tipo_espacio: string | null }[] }),
  ]);
  const oficinaPorId = new Map((oficinas || []).map((o) => [o.id, o]));
  const paquetePorId = new Map((paquetes || []).map((p) => [p.id, p]));

  const contratosOut = (contratos || []).map((c) => {
    const o = c.oficina_id ? oficinaPorId.get(c.oficina_id) : undefined;
    const p = c.paquete_id ? paquetePorId.get(c.paquete_id) : undefined;
    const tipo: string = o?.tipo || p?.tipo_espacio || "";
    const espacio = [tipo, o?.numero ? "Oficina " + o.numero : null, p?.nombre].filter(Boolean).join(" · ") || "Contrato";
    const centroContrato: string = c.centro || cliente.centro || "";
    return {
      id: c.id as string,
      folio: (c.folio as string | null) || null,
      centro: centroContrato,
      estatus: c.estatus as string,
      renta: Number(c.renta_mensual) || 0,
      tipo,
      etiqueta: [c.folio, centroContrato, espacio].filter(Boolean).join(" · "),
    };
  });

  if (q.get("accion") !== "previa") return NextResponse.json({ contratos: contratosOut });

  const mes = Number(q.get("mes"));
  const anio = Number(q.get("anio"));
  if (!(mes >= 1 && mes <= 12) || !(anio >= 2020 && anio <= 2100)) return NextResponse.json({ error: "Mes o año no válidos" }, { status: 400 });
  const nombreMes = `${MESES[mes - 1]} de ${anio}`;
  const contratoId = q.get("contratoId") || "";
  const inicio = `${anio}-${String(mes).padStart(2, "0")}-01`;

  type Linea = { key: string; tipo: string; contrato: string; descripcion: string; servicio: string; total: number; pagoId?: string; contratoId?: string; centro?: string; periodo?: string };
  const lineas: Linea[] = [];

  // Recurrentes: renta mensual y adicionales mensuales (estacionamiento…) de cada contrato.
  const elegidos = contratosOut.filter((c) => !contratoId || c.id === contratoId);
  const { data: extras } = elegidos.length
    ? await admin.from("contrato_adicionales").select("contrato_id, concepto, monto").in("contrato_id", elegidos.map((c) => c.id))
    : { data: [] as { contrato_id: string; concepto: string; monto: number }[] };
  for (const c of elegidos) {
    const quien = c.folio || c.etiqueta;
    const servicio = (c.tipo || "renta de espacio").toLowerCase();
    if (c.renta > 0) lineas.push({ key: "renta-" + c.id, tipo: "Renta", contrato: quien, descripcion: `Renta mensual ${nombreMes}`, servicio, total: c.renta, contratoId: c.id, centro: c.centro, periodo: inicio });
    for (const [i, e] of (extras || []).filter((x) => x.contrato_id === c.id).entries()) {
      if (Number(e.monto) > 0)
        lineas.push({ key: `extra-${c.id}-${i}`, tipo: "Adicional mensual", contrato: quien, descripcion: `${e.concepto} ${nombreMes}`, servicio: String(e.concepto).toLowerCase(), total: Number(e.monto), contratoId: c.id, centro: c.centro });
    }
  }

  // Adicionales: pagos y cobros sueltos del cliente que todavía no tienen factura.
  const { servicios: catalogo } = await cargarCatalogo(admin);
  const etiquetaServicio = new Map(catalogo.map((s) => [s.clave, s.etiqueta]));
  const tipoUnico = elegidos.length === 1 ? (elegidos[0].tipo || "").toLowerCase() : "";
  let consultaPagos = admin.from("pagos").select("id, concepto, monto, estado, adicional_tipo").eq("user_id", userId).is("factura_id", null);
  // Un cliente de otro centro con contrato aquí: solo sus pagos de este centro.
  if (acceso.cruzado) consultaPagos = consultaPagos.eq("centro", miProfile!.centro);
  const { data: pagos } = await consultaPagos.order("created_at", { ascending: false });
  for (const p of pagos || []) {
    const nombre = etiquetaPagoSuelto(p.concepto);
    const esDeposito = /dep[oó]sito/i.test(nombre);
    const esMensualidad = /mensualidad/i.test(nombre);
    const tipo = p.adicional_tipo ? "Adicional" : esDeposito ? "Depósito" : esMensualidad ? "Mensualidad" : "Pago";
    const servicio = p.adicional_tipo
      ? (etiquetaServicio.get(p.adicional_tipo) || nombre).toLowerCase()
      : esDeposito
        ? "depósito en garantía"
        : esMensualidad
          ? tipoUnico || "renta de espacio"
          : nombre.toLowerCase();
    lineas.push({ key: "pago-" + p.id, tipo, contrato: "—", descripcion: `${nombre}${p.estado === "pagado" ? " (ya pagado)" : ""}`, servicio, total: Number(p.monto), pagoId: p.id });
  }

  // ¿Ya existe el cobro de renta de ese mes, contrato por contrato? (la genera el cobro diario o se integró a mano)
  const { data: marcas, error: errMarcas } = elegidos.length
    ? await admin.from("cargos_periodo").select("contrato_id, factura_id").in("contrato_id", elegidos.map((c) => c.id)).eq("periodo", inicio).eq("tipo", "renta").not("factura_id", "is", null)
    : { data: [] as { contrato_id: string; factura_id: string }[], error: null };
  if (errMarcas) return NextResponse.json({ error: "No se pudo revisar si la renta ya existe" }, { status: 500 });
  const { data: facturasRenta } = (marcas || []).length
    ? await admin.from("facturas").select("id, folio, estado, uuid_cfdi, cancelacion_estatus").in("id", (marcas || []).map((m) => m.factura_id))
    : { data: [] as { id: string; folio: string; estado: string; uuid_cfdi: string | null; cancelacion_estatus: string | null }[] };
  const rentasYaIntegradas = (marcas || []).flatMap((m) => {
    const f = (facturasRenta || []).find((x) => x.id === m.factura_id);
    // Una factura cancelada ya no ocupa la renta: se puede volver a integrar.
    return f && !facturaCancelada(f) ? [{ contratoId: m.contrato_id, folio: f.folio, estado: f.estado, timbrada: !!f.uuid_cfdi }] : [];
  });

  return NextResponse.json({
    contratos: contratosOut,
    lineas,
    rentasYaIntegradas,
    puedeTimbrar: rolPuede(miProfile?.rol, "facturaEmitir"),
  });
}
