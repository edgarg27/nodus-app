import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { cargarCatalogo } from "@/lib/catalogoServicios";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
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
  const { data: cliente } = await admin.from("profiles").select("id, centro").eq("id", userId).maybeSingle();
  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && cliente.centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes consultar clientes de otro centro" }, { status: 403 });
  }

  const todos = q.get("estatus") === "todos";
  // select("*"): el folio del contrato es una columna nueva (migracion_contratos_folio.sql); así no falla si aún no existe.
  let consulta = admin.from("contratos").select("*").eq("user_id", userId);
  if (!todos) consulta = consulta.eq("estatus", "vigente");
  const { data: contratos } = await consulta.order("fecha_inicio", { ascending: false });

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

  type Linea = { key: string; tipo: string; contrato: string; descripcion: string; servicio: string; total: number; pagoId?: string; contratoId?: string; centro?: string };
  const lineas: Linea[] = [];

  // Recurrentes: renta mensual y adicionales mensuales (estacionamiento…) de cada contrato.
  const elegidos = contratosOut.filter((c) => !contratoId || c.id === contratoId);
  const { data: extras } = elegidos.length
    ? await admin.from("contrato_adicionales").select("contrato_id, concepto, monto").in("contrato_id", elegidos.map((c) => c.id))
    : { data: [] as { contrato_id: string; concepto: string; monto: number }[] };
  for (const c of elegidos) {
    const quien = c.folio || c.etiqueta;
    const servicio = (c.tipo || "renta de espacio").toLowerCase();
    if (c.renta > 0) lineas.push({ key: "renta-" + c.id, tipo: "Renta", contrato: quien, descripcion: `Renta mensual ${nombreMes}`, servicio, total: c.renta, contratoId: c.id, centro: c.centro });
    for (const [i, e] of (extras || []).filter((x) => x.contrato_id === c.id).entries()) {
      if (Number(e.monto) > 0)
        lineas.push({ key: `extra-${c.id}-${i}`, tipo: "Adicional mensual", contrato: quien, descripcion: `${e.concepto} ${nombreMes}`, servicio: String(e.concepto).toLowerCase(), total: Number(e.monto), contratoId: c.id, centro: c.centro });
    }
  }

  // Adicionales: pagos y cobros sueltos del cliente que todavía no tienen factura.
  const { servicios: catalogo } = await cargarCatalogo(admin);
  const etiquetaServicio = new Map(catalogo.map((s) => [s.clave, s.etiqueta]));
  const tipoUnico = elegidos.length === 1 ? (elegidos[0].tipo || "").toLowerCase() : "";
  const { data: pagos } = await admin
    .from("pagos")
    .select("id, concepto, monto, estado, adicional_tipo")
    .eq("user_id", userId)
    .is("factura_id", null)
    .order("created_at", { ascending: false });
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

  // ¿Ya existe el cobro de renta de ese mes? (el sistema lo genera solo en los primeros días del mes)
  const inicio = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const fin = `${anio}-${String(mes).padStart(2, "0")}-${String(new Date(anio, mes, 0).getDate()).padStart(2, "0")}`;
  const { data: rentaMes } = await admin
    .from("facturas")
    .select("folio, estado, uuid_cfdi")
    .eq("user_id", userId)
    .ilike("concepto", "Renta mensual%")
    .gte("fecha_emision", inicio)
    .lte("fecha_emision", fin)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    contratos: contratosOut,
    lineas,
    rentaYaIntegrada: rentaMes ? { folio: rentaMes.folio, estado: rentaMes.estado, timbrada: !!rentaMes.uuid_cfdi } : null,
    puedeTimbrar: rolPuede(miProfile?.rol, "facturaEmitir"),
  });
}
