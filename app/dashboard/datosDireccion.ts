import type { createClient } from "@/lib/supabase/server";
import { calcularOcupacionPorCentro } from "@/lib/ocupacion";
import { hoyMexicoISO } from "@/lib/fechaMexico";

// Datos del Panel de Dirección (rol "ceo", ver PanelDireccion.tsx).
// - Ocupación: mismo cálculo que el dashboard y Reportes (lib/ocupacion.ts),
//   más el desglose por tipo de espacio y los contratos por vencer.
// - Finanzas, cartera, clientes y ventas: se mandan los registros "crudos"
//   (solo las columnas que se usan) y la pantalla los agrupa por mes y centro,
//   con los mismos criterios que Ingresos por Centro y Cobranza.
// Todo de todos los centros; los filtros de centro y mes son en pantalla.

type Supabase = ReturnType<typeof createClient>;

export type TipoOcupacion = { tipo: string; total: number; ocupadas: number };

export type CentroDireccion = {
  centro: string;
  total: number;
  ocupadas: number;
  disponibles: number;
  porcentaje: number;
  porTipo: TipoOcupacion[];
  // precioMes: precio de lista mensual, con la misma regla que Cotizar
  // (CotizarForm.tsx): el del plan ligado a la oficina (paquete_default_id) o,
  // si no tiene, el precio propio de la oficina. Solo lo muestra Captive.
  disponiblesLista: { numero: string; tipo: string; precioMes: number | null }[];
};

export type ContratoPorVencer = {
  id: string;
  centro: string;
  cliente: string;
  empresa: string | null;
  espacio: string;
  fechaVencimiento: string;
  dias: number;
  rentaMensual: number;
};

export type PagoDir = {
  monto: number;
  concepto: string | null;
  estado: string;
  fecha_pago: string | null;
  fecha_limite: string | null;
  created_at: string;
  centro: string | null;
  user_id: string | null;
};
export type GastoDir = { monto: number; fecha: string; categoria: string | null; centro: string | null };
export type ContratoDir = {
  estatus: string;
  centro: string | null;
  user_id: string | null;
  fecha_inicio: string | null;
  fecha_baja: string | null;
  renta_mensual: number | null;
};
export type ClienteDir = {
  id: string;
  nombre: string | null;
  empresa: string | null;
  centro: string | null;
  activo: boolean | null;
  suspendido: boolean | null;
  created_at: string;
};
export type ProspectoDir = {
  id: string;
  centro: string | null;
  estado: string;
  medio: string | null;
  comentario_perdido: string | null;
  nombre: string;
  registrado_por: string | null;
  created_at: string;
};
export type CotizacionDir = { centro: string | null; contrato_id: string | null; created_by: string | null; created_at: string };
export type TourDir = { centro: string | null; fecha: string };
export type ActividadDir = { completada: boolean; fecha: string; creado_por: string | null; prospecto_id: string };

export type DatosDireccion = {
  hoy: string;
  centros: CentroDireccion[];
  contratos: ContratoPorVencer[];
  pagos: PagoDir[];
  gastos: GastoDir[];
  todosContratos: ContratoDir[];
  clientes: ClienteDir[];
  prospectos: ProspectoDir[];
  cotizaciones: CotizacionDir[];
  tours: TourDir[];
  actividades: ActividadDir[];
  // id → nombre del personal que registra prospectos, cotizaciones y actividades
  personal: Record<string, string>;
};

const esCoworking = (tipo: string | null) => (tipo || "").trim().toLowerCase() === "coworking";

function diasEntre(desdeISO: string, hastaISO: string) {
  const a = new Date(`${desdeISO}T00:00:00`).getTime();
  const b = new Date(`${hastaISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function cargarDatosDireccion(supabase: Supabase): Promise<DatosDireccion> {
  const hoy = hoyMexicoISO();

  const [{ data: oficinas }, { data: contratos }, { data: planes }] = await Promise.all([
    supabase.from("oficinas").select("id, centro, tipo, numero, precio, paquete_default_id").limit(5000),
    // Vigentes con cliente real (mismo criterio que lib/ocupacion.ts).
    supabase
      .from("contratos")
      .select("id, centro, oficina_id, user_id, fecha_vencimiento, renta_mensual, cliente_nombre_historico, cliente_empresa_historico")
      .eq("estatus", "vigente")
      .not("user_id", "is", null)
      .limit(5000),
    supabase.from("paquetes").select("id, precio_mes").limit(5000),
  ]);
  const precioMesPlan = new Map((planes || []).map((p) => [p.id, Number(p.precio_mes) || 0]));
  const precioMesDe = (o: { precio: unknown; paquete_default_id: string | null }) => {
    const precio = o.paquete_default_id ? precioMesPlan.get(o.paquete_default_id) : Number(o.precio);
    return precio ? precio : null;
  };

  const listaOficinas = oficinas || [];
  const listaContratos = contratos || [];
  const oficinaPorId = new Map(listaOficinas.map((o) => [o.id, o]));

  // ---- Ocupación por centro ----
  const conOficina = listaContratos.filter((c) => c.oficina_id);
  const ocupacion = calcularOcupacionPorCentro(listaOficinas, conOficina);
  const ocupadasIds = new Set(conOficina.map((c) => c.oficina_id as string));

  const centros: CentroDireccion[] = Object.entries(ocupacion).map(([centro, d]) => {
    const deCentro = listaOficinas.filter((o) => (o.centro || "Sin centro") === centro);
    const porTipoMap = new Map<string, TipoOcupacion>();
    let coworking: TipoOcupacion | null = null;
    for (const o of deCentro) {
      if (esCoworking(o.tipo)) {
        // Todo el coworking del centro cuenta como un solo espacio.
        coworking = coworking || { tipo: "Coworking", total: 1, ocupadas: 0 };
        if (ocupadasIds.has(o.id)) coworking.ocupadas = 1;
        continue;
      }
      const tipo = (o.tipo || "Sin tipo").trim();
      const t = porTipoMap.get(tipo) || { tipo, total: 0, ocupadas: 0 };
      t.total++;
      if (ocupadasIds.has(o.id)) t.ocupadas++;
      porTipoMap.set(tipo, t);
    }
    const porTipo = [...Array.from(porTipoMap.values()).sort((a, b) => b.total - a.total), ...(coworking ? [coworking] : [])];
    const disponiblesLista = deCentro
      .filter((o) => !esCoworking(o.tipo) && !ocupadasIds.has(o.id))
      .map((o) => ({ numero: String(o.numero ?? ""), tipo: (o.tipo || "").trim(), precioMes: precioMesDe(o) }))
      .sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true }));
    return {
      centro,
      ...d,
      porcentaje: d.total ? Math.round((d.ocupadas / d.total) * 100) : 0,
      porTipo,
      disponiblesLista,
    };
  });
  centros.sort((a, b) => a.centro.localeCompare(b.centro, "es"));

  // ---- Contratos por vencer (y vencidos que siguen como vigentes) ----
  const idsClientes = Array.from(new Set(listaContratos.map((c) => c.user_id as string)));
  const { data: perfiles } = idsClientes.length
    ? await supabase.from("profiles").select("id, nombre, empresa").in("id", idsClientes)
    : { data: [] as { id: string; nombre: string | null; empresa: string | null }[] };
  const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]));

  const porVencer: ContratoPorVencer[] = listaContratos
    .filter((c) => c.fecha_vencimiento)
    .map((c) => {
      const perfil = perfilPorId.get(c.user_id as string);
      const oficina = c.oficina_id ? oficinaPorId.get(c.oficina_id) : undefined;
      const espacio = oficina
        ? esCoworking(oficina.tipo)
          ? "Coworking"
          : `${(oficina.tipo || "Espacio").trim()} ${oficina.numero ?? ""}`.trim()
        : "Sin espacio asignado";
      const fecha = String(c.fecha_vencimiento).slice(0, 10);
      return {
        id: c.id,
        centro: c.centro || oficina?.centro || "Sin centro",
        cliente: perfil?.nombre || c.cliente_nombre_historico || "Cliente",
        empresa: perfil?.empresa || c.cliente_empresa_historico || null,
        espacio,
        fechaVencimiento: fecha,
        dias: diasEntre(hoy, fecha),
        rentaMensual: Number(c.renta_mensual) || 0,
      };
    })
    .filter((c) => c.dias <= 90)
    .sort((a, b) => a.dias - b.dias);

  // ---- Finanzas, cartera, clientes y ventas ----
  const [pagos, gastos, todosContratos, clientes, prospectos, cotizaciones, tours, actividades] = await Promise.all([
    supabase.from("pagos").select("monto, concepto, estado, fecha_pago, fecha_limite, created_at, centro, user_id").limit(50000),
    supabase.from("gastos").select("monto, fecha, categoria, centro").limit(50000),
    supabase.from("contratos").select("estatus, centro, user_id, fecha_inicio, fecha_baja, renta_mensual").limit(20000),
    supabase.from("profiles").select("id, nombre, empresa, centro, activo, suspendido, created_at").eq("rol", "cliente").limit(20000),
    supabase
      .from("prospectos")
      .select("id, centro, estado, medio, comentario_perdido, nombre, registrado_por, created_at")
      .limit(20000),
    supabase.from("cotizaciones_comerciales").select("centro, contrato_id, created_by, created_at").limit(20000),
    supabase.from("tours").select("centro, fecha").limit(20000),
    // Puede no existir todavía si no se ha corrido migracion_prospectos_actividades.sql.
    supabase.from("prospecto_actividades").select("completada, fecha, creado_por, prospecto_id").limit(50000),
  ]);

  const idsPersonal = Array.from(
    new Set(
      [
        ...(prospectos.data || []).map((p) => p.registrado_por),
        ...(cotizaciones.data || []).map((c) => c.created_by),
        ...(actividades.data || []).map((a) => a.creado_por),
      ].filter((id): id is string => !!id)
    )
  );
  const { data: personal } = idsPersonal.length
    ? await supabase.from("profiles").select("id, nombre").in("id", idsPersonal)
    : { data: [] as { id: string; nombre: string | null }[] };

  return {
    hoy,
    centros,
    contratos: porVencer,
    pagos: (pagos.data || []).map((p) => ({ ...p, monto: Number(p.monto) || 0 })),
    gastos: (gastos.data || []).map((g) => ({ ...g, monto: Number(g.monto) || 0 })),
    todosContratos: todosContratos.data || [],
    clientes: clientes.data || [],
    prospectos: prospectos.data || [],
    cotizaciones: cotizaciones.data || [],
    tours: tours.data || [],
    actividades: actividades.data || [],
    personal: Object.fromEntries((personal || []).map((p) => [p.id, p.nombre || "Sin nombre"])),
  };
}
