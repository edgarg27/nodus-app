"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSignedFileUrl } from "@/lib/storage";
import FileDropzone from "../soporte/FileDropzone";
import { conIva, esCobroMensual, totalAdicionalesMensuales } from "@/lib/adicionales";
import { CATEGORIA_PAGO_INFO, type CategoriaPago, categorizarPago, pagoEstaCubierto } from "@/lib/pagosCategoria";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  notas: string | null;
  proveedor_id: string | null;
  factura_url: string | null;
  comprobante_pago_url: string | null;
  centro?: string | null;
};
type Proveedor = { id: string; nombre: string };

// Fila de pagos usada para el desglose por categoría y la gráfica de la
// pestaña Resumen — solo lo que ya entró (estado "pagado") en el rango.
type PagoResumen = { monto: number; concepto: string | null; fecha_pago: string | null; contrato_id: string | null };

// Colores para "Ingresos por servicio" — mismos 3 valores que ya usa el
// catálogo de paquetes (paquetes.tipo_espacio / oficinas.tipo).
const COLOR_TIPO_ESPACIO: Record<string, string> = {
  Coworking: "#F07E3A",
  "Oficina Privada": "#0F6E56",
  "Working Desk": "#185FA5",
};
const colorTipoEspacio = (tipo: string) => COLOR_TIPO_ESPACIO[tipo] || "#888";

// Lo que le toca pagar este mes a cada cliente con contrato vigente, y si ya
// se cubrió. No depende del rango de fechas de Resumen — siempre es "este
// mes de calendario", que es como la gente entiende "mi mensualidad".
type ClienteIngreso = {
  contratoId: string;
  nombre: string;
  empresa: string | null;
  renta: number;
  adicionales: { concepto: string; monto: number }[];
  totalAdicionales: number;
  esperado: number;
  estadoMes: "adelantado" | "cubierto" | "pendiente" | "sin_generar";
  montoRelevante: number;
  tieneRecargo: boolean;
};

function primerDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}
function ultimoDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function IngresosCentroPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const esGlobal = ROLES_GLOBALES.includes(miRol);
  const [abriendoArchivoUrl, setAbriendoArchivoUrl] = useState<string | null>(null);

  async function abrirComprobante(archivoUrl: string) {
    setAbriendoArchivoUrl(archivoUrl);
    const { url, error: signErr } = await getSignedFileUrl(supabase, "comprobantes", archivoUrl);
    setAbriendoArchivoUrl(null);
    if (!url) {
      alert("No se pudo abrir el archivo: " + (signErr || "intenta de nuevo"));
      return;
    }
    window.open(url, "_blank");
  }

  const [tab, setTab] = useState<"resumen" | "clientes" | "gastos">("resumen");

  const [fechaDesde, setFechaDesde] = useState(primerDiaMes());
  const [fechaHasta, setFechaHasta] = useState(ultimoDiaMes());
  const [totalIngresos, setTotalIngresos] = useState(0);
  const [totalGastos, setTotalGastos] = useState(0);
  const [pagosPeriodo, setPagosPeriodo] = useState<PagoResumen[]>([]);
  // contrato_id -> tipo_espacio ("Coworking" | "Oficina Privada" | "Working
  // Desk"), para saber qué servicio generó cada pago. No depende del rango
  // de fechas, solo del centro.
  const [tipoEspacioPorContrato, setTipoEspacioPorContrato] = useState<Map<string, string>>(new Map());

  // ---- Por cliente: mensualidad de este mes, cubierta o pendiente ----
  const [clientesIngreso, setClientesIngreso] = useState<ClienteIngreso[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(true);

  // ---- Gastos (pestaña propia, dentro de esta misma pantalla) ----
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargandoGastos, setCargandoGastos] = useState(true);
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [errorGasto, setErrorGasto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [fechaGasto, setFechaGasto] = useState(hoyISO());
  const [notasGasto, setNotasGasto] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [factura, setFactura] = useState<File[]>([]);
  const [comprobante, setComprobante] = useState<File[]>([]);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, fechaDesde, fechaHasta]);

  useEffect(() => {
    if (centro) cargarGastos(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  useEffect(() => {
    if (centro) cargarClientes(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  useEffect(() => {
    if (centro) cargarTiposEspacio(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    // Ingresos = dinero que efectivamente entró (pagos.estado = 'pagado'),
    // no lo facturado — por eso sale de `pagos` y no de `facturas`, que
    // puede incluir pendientes/vencidas. concepto y fecha_pago se usan para
    // el desglose por categoría y la gráfica de abajo.
    const [{ data: pagosData }, { data: gastosData }] = await Promise.all([
      supabase
        .from("pagos")
        .select("monto, concepto, fecha_pago, contrato_id")
        .eq("centro", c)
        .eq("estado", "pagado")
        .gte("fecha_pago", fechaDesde)
        .lte("fecha_pago", fechaHasta),
      supabase.from("gastos").select("monto").eq("centro", c).gte("fecha", fechaDesde).lte("fecha", fechaHasta),
    ]);
    const pagos = pagosData || [];
    setTotalIngresos(pagos.reduce((s, p) => s + Number(p.monto), 0));
    setTotalGastos((gastosData || []).reduce((s, g) => s + Number(g.monto), 0));
    setPagosPeriodo(pagos);
    setLoading(false);
  }

  // Contratos vigentes del centro + sus adicionales mensuales + los pagos de
  // renta generados este mes, para saber quién ya cubrió su mensualidad.
  async function cargarClientes(c: string) {
    setCargandoClientes(true);
    const { data: contratosData } = await supabase
      .from("contratos")
      .select("id, user_id, renta_mensual, forma_pago, cliente_nombre_historico, cliente_empresa_historico")
      .eq("centro", c)
      .eq("estatus", "vigente")
      // Solo contratos con un cliente real dado de alta: hay contratos
      // "vigentes" de pruebas/cotizaciones que nunca se concluyeron (nunca
      // se les creó la cuenta) y no deben contarse como ocupando espacio.
      .not("user_id", "is", null);
    let contratosLista = contratosData || [];
    const userIds = Array.from(new Set(contratosLista.map((ct) => ct.user_id).filter(Boolean)));

    // Y que el cliente siga activo (no dado de baja ni suspendido) — mismo
    // criterio que usa el cron de facturación para decidir a quién cobrar.
    if (userIds.length > 0) {
      const { data: perfiles } = await supabase.from("profiles").select("id, activo, suspendido").in("id", userIds);
      const activos = new Set((perfiles || []).filter((p) => p.activo && !p.suspendido).map((p) => p.id));
      contratosLista = contratosLista.filter((ct) => activos.has(ct.user_id));
    } else {
      contratosLista = [];
    }
    const ids = contratosLista.map((ct) => ct.id);

    const inicioMes = primerDiaMes();
    const finMes = ultimoDiaMes();

    const [{ data: adicionalesData }, { data: pagosData }] = ids.length
      ? await Promise.all([
          supabase.from("contrato_adicionales").select("contrato_id, concepto, monto").in("contrato_id", ids),
          supabase
            .from("pagos")
            .select("contrato_id, concepto, monto, estado")
            .eq("centro", c)
            .in("contrato_id", ids)
            .gte("created_at", `${inicioMes}T00:00:00`)
            .lte("created_at", `${finMes}T23:59:59`),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

    const adicionalesPorContrato = new Map<string, { concepto: string; monto: number }[]>();
    for (const a of adicionalesData || []) {
      const arr = adicionalesPorContrato.get(a.contrato_id) || [];
      arr.push({ concepto: a.concepto, monto: Number(a.monto) || 0 });
      adicionalesPorContrato.set(a.contrato_id, arr);
    }

    const pagosPorContrato = new Map<string, { concepto: string; monto: number; estado: string }[]>();
    for (const p of pagosData || []) {
      if (!p.contrato_id) continue;
      const arr = pagosPorContrato.get(p.contrato_id) || [];
      arr.push(p);
      pagosPorContrato.set(p.contrato_id, arr);
    }

    const filas: ClienteIngreso[] = contratosLista.map((ct) => {
      const adicionalesRaw = adicionalesPorContrato.get(ct.id) || [];
      const adicionalesMensuales = adicionalesRaw
        .filter((a) => esCobroMensual(a.concepto))
        .map((a) => ({ concepto: a.concepto, monto: conIva(a.concepto, a.monto) }));
      const totalAdicionales = round2(adicionalesMensuales.reduce((s, a) => s + a.monto, 0));
      const renta = Number(ct.renta_mensual) || 0;
      const esperado = round2(renta + totalAdicionales);

      const pagosDelContrato = pagosPorContrato.get(ct.id) || [];
      const pagosRenta = pagosDelContrato.filter((p) => categorizarPago(p.concepto) === "renta");
      const pagado = pagosRenta.find((p) => pagoEstaCubierto(p.estado));
      const pendiente = pagosRenta.find((p) => !pagoEstaCubierto(p.estado));
      const tieneRecargo = pagosDelContrato.some((p) => categorizarPago(p.concepto) === "recargo");

      let estadoMes: ClienteIngreso["estadoMes"];
      let montoRelevante = esperado;
      if (ct.forma_pago === "adelantado") {
        estadoMes = "adelantado";
      } else if (pagado) {
        estadoMes = "cubierto";
        montoRelevante = Number(pagado.monto) || esperado;
      } else if (pendiente) {
        estadoMes = "pendiente";
        montoRelevante = Number(pendiente.monto) || esperado;
      } else {
        estadoMes = "sin_generar";
      }

      return {
        contratoId: ct.id,
        nombre: ct.cliente_nombre_historico || "Cliente",
        empresa: ct.cliente_empresa_historico,
        renta,
        adicionales: adicionalesMensuales,
        totalAdicionales,
        esperado,
        estadoMes,
        montoRelevante,
        tieneRecargo,
      };
    });

    filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    setClientesIngreso(filas);
    setCargandoClientes(false);
  }

  // contrato -> paquete -> tipo_espacio, para poder decir qué servicio
  // (Coworking / Oficina Privada / Working Desk) generó cada pago. Se
  // guardan todos los contratos del centro (no solo los vigentes) porque un
  // pago cobrado el mes pasado puede venir de un contrato ya terminado.
  async function cargarTiposEspacio(c: string) {
    const [{ data: contratosData }, { data: paquetesData }] = await Promise.all([
      supabase.from("contratos").select("id, paquete_id").eq("centro", c),
      supabase.from("paquetes").select("id, tipo_espacio").eq("centro", c),
    ]);
    const tipoPorPaquete = new Map<string, string>();
    for (const p of paquetesData || []) tipoPorPaquete.set(p.id, p.tipo_espacio);
    const tipoPorContrato = new Map<string, string>();
    for (const ct of contratosData || []) {
      const tipo = ct.paquete_id ? tipoPorPaquete.get(ct.paquete_id) : undefined;
      if (tipo) tipoPorContrato.set(ct.id, tipo);
    }
    setTipoEspacioPorContrato(tipoPorContrato);
  }

  async function cargarGastos(c: string) {
    setCargandoGastos(true);
    const [{ data: gastosData }, { data: provsData }] = await Promise.all([
      supabase.from("gastos").select("*").eq("centro", c).order("fecha", { ascending: false }),
      supabase.from("proveedores").select("id, nombre").eq("centro", c).order("nombre"),
    ]);
    setGastos(gastosData || []);
    setProveedores(provsData || []);
    setCargandoGastos(false);
  }

  function resetFormGasto() {
    setConcepto("");
    setCategoria("");
    setMonto("");
    setFechaGasto(hoyISO());
    setNotasGasto("");
    setProveedorId("");
    setFactura([]);
    setComprobante([]);
  }

  async function subirArchivoGasto(archivo: File, prefijo: string) {
    const fileName = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
      archivo.name.split(".").pop() || "jpg"
    }`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
    if (uploadError) return null;
    const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function registrarGasto(e: React.FormEvent) {
    e.preventDefault();
    if (!centro) return;
    if (!concepto.trim() || !monto || !fechaGasto) {
      setErrorGasto("Completa concepto, monto y fecha");
      return;
    }
    setGuardandoGasto(true);
    setErrorGasto("");

    const facturaUrl = factura[0] ? await subirArchivoGasto(factura[0], "factura") : null;
    const comprobanteUrl = comprobante[0] ? await subirArchivoGasto(comprobante[0], "pago") : null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from("gastos").insert({
      concepto: concepto.trim(),
      categoria: categoria.trim() || null,
      monto: Number(monto),
      fecha: fechaGasto,
      notas: notasGasto.trim() || null,
      centro,
      proveedor_id: proveedorId || null,
      factura_url: facturaUrl,
      comprobante_pago_url: comprobanteUrl,
      registrado_por: user?.id,
    });

    if (insertError) {
      setErrorGasto("No se pudo registrar el gasto. Intenta de nuevo.");
      setGuardandoGasto(false);
      return;
    }

    resetFormGasto();
    setGuardandoGasto(false);
    cargarGastos(centro);
    fetchTodo(centro);
  }

  const proveedorNombre = (id: string | null) => proveedores.find((p) => p.id === id)?.nombre;
  const totalGastosCentro = useMemo(() => gastos.reduce((s, g) => s + Number(g.monto), 0), [gastos]);

  const gananciaNeta = useMemo(() => totalIngresos - totalGastos, [totalIngresos, totalGastos]);

  // Desglose de lo ya cobrado en el rango, por categoría (renta, adicionales,
  // depósitos, recargos, oficinas agregadas, otros).
  const porCategoria = useMemo(() => {
    const totales = new Map<CategoriaPago, number>();
    for (const p of pagosPeriodo) {
      const cat = categorizarPago(p.concepto);
      totales.set(cat, (totales.get(cat) || 0) + Number(p.monto));
    }
    const maxMonto = Math.max(1, ...Array.from(totales.values()));
    return (Object.keys(CATEGORIA_PAGO_INFO) as CategoriaPago[])
      .map((cat) => ({ cat, monto: round2(totales.get(cat) || 0), pct: ((totales.get(cat) || 0) / maxMonto) * 100, ...CATEGORIA_PAGO_INFO[cat] }))
      .filter((c) => c.monto > 0)
      .sort((a, b) => b.monto - a.monto);
  }, [pagosPeriodo]);

  // Desglose de lo ya cobrado en el rango por tipo de servicio (Coworking /
  // Oficina Privada / Working Desk) — para ver qué se vende más. Un pago sin
  // contrato asociado, o de un contrato sin paquete reconocido, cae en
  // "Otros" (ej. un adicional suelto).
  const porServicio = useMemo(() => {
    const totales = new Map<string, number>();
    for (const p of pagosPeriodo) {
      const tipo = (p.contrato_id && tipoEspacioPorContrato.get(p.contrato_id)) || "Otros";
      totales.set(tipo, (totales.get(tipo) || 0) + Number(p.monto));
    }
    const maxMonto = Math.max(1, ...Array.from(totales.values()));
    return Array.from(totales.entries())
      .map(([tipo, monto]) => ({ tipo, monto: round2(monto), pct: (monto / maxMonto) * 100 }))
      .filter((s) => s.monto > 0)
      .sort((a, b) => b.monto - a.monto);
  }, [pagosPeriodo, tipoEspacioPorContrato]);

  // Ingresos por día (rangos cortos) o por semana (rangos largos), para la
  // gráfica de barras de Resumen.
  const rangoEnDias = useMemo(() => {
    if (!fechaDesde || !fechaHasta) return 0;
    const desde = new Date(fechaDesde + "T00:00:00");
    const hasta = new Date(fechaHasta + "T00:00:00");
    return Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1;
  }, [fechaDesde, fechaHasta]);
  const porSemana = rangoEnDias > 31;

  const serieTiempo = useMemo(() => {
    if (!fechaDesde || !fechaHasta) return [];
    const buckets = new Map<string, { label: string; monto: number }>();

    for (const p of pagosPeriodo) {
      if (!p.fecha_pago) continue;
      const fecha = new Date(p.fecha_pago + "T00:00:00");
      let clave: string;
      let label: string;
      if (porSemana) {
        const inicioSemana = new Date(fecha);
        inicioSemana.setDate(fecha.getDate() - fecha.getDay());
        clave = inicioSemana.toISOString().split("T")[0];
        label = inicioSemana.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
      } else {
        clave = p.fecha_pago;
        label = fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
      }
      const actual = buckets.get(clave) || { label, monto: 0 };
      actual.monto += Number(p.monto);
      buckets.set(clave, actual);
    }
    const maxMonto = Math.max(1, ...Array.from(buckets.values()).map((b) => b.monto));
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => ({ ...b, monto: round2(b.monto), pct: (b.monto / maxMonto) * 100 }));
  }, [pagosPeriodo, fechaDesde, fechaHasta, porSemana]);

  // Totales de la pestaña "Por cliente": lo que le toca al centro este mes,
  // cuánto ya se cubrió y cuánto sigue pendiente (incluye lo que ni siquiera
  // se ha facturado todavía, porque sigue siendo dinero que va a entrar).
  const resumenClientes = useMemo(() => {
    let esperado = 0;
    let cubierto = 0;
    let pendiente = 0;
    for (const f of clientesIngreso) {
      if (f.estadoMes === "adelantado") continue;
      esperado += f.esperado;
      if (f.estadoMes === "cubierto") cubierto += f.montoRelevante;
      else pendiente += f.montoRelevante;
    }
    return { esperado: round2(esperado), cubierto: round2(cubierto), pendiente: round2(pendiente) };
  }, [clientesIngreso]);

  const ESTADO_MES_INFO: Record<ClienteIngreso["estadoMes"], { label: string; bg: string; color: string }> = {
    cubierto: { label: "✓ Cubierto", bg: "#E1F5EE", color: "#0F6E56" },
    pendiente: { label: "⏳ Pendiente", bg: "#FCEBEB", color: "#A32D2D" },
    sin_generar: { label: "Aún no se genera", bg: "#F5F5F5", color: "#888" },
    adelantado: { label: "📦 Pagado por adelantado", bg: "#E6F1FB", color: "#185FA5" },
  };

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Ingresos por Centro</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!centro ? (
        <div className="rep-content">
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        </div>
      ) : (
        <>
          <div className="centro-tabs">
            <button className={"centro-tab" + (tab === "resumen" ? " active" : "")} onClick={() => setTab("resumen")}>
              📊 Resumen
            </button>
            <button className={"centro-tab" + (tab === "clientes" ? " active" : "")} onClick={() => setTab("clientes")}>
              🧑‍💼 Por cliente
            </button>
            <button className={"centro-tab" + (tab === "gastos" ? " active" : "")} onClick={() => setTab("gastos")}>
              💸 Gastos
            </button>
          </div>

          <div className="rep-content">
            {tab === "resumen" && (
              <>
                <div className="form-card">
                  <div className="tel-form-grid">
                    <div>
                      <p className="sub-label">Desde</p>
                      <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
                    </div>
                    <div>
                      <p className="sub-label">Hasta</p>
                      <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="nodus-inline-loading">
                    <div className="nodus-spinner nodus-spinner-sm">
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                    </div>
                    <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#0F6E56" }}>
                          ${totalIngresos.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Ingresos</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#A32D2D" }}>
                          ${totalGastos.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Gastos</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: gananciaNeta >= 0 ? "#0F6E56" : "#A32D2D" }}>
                          ${gananciaNeta.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Ganancia neta</p>
                      </div>
                    </div>

                    <p className="panel-section-label" style={{ marginTop: 16 }}>
                      Ingresos por tipo
                    </p>
                    {porCategoria.length === 0 ? (
                      <div className="empty-card">Sin ingresos en este rango</div>
                    ) : (
                      <div className="form-card">
                        {porCategoria.map((c) => (
                          <div className="cat-bar-row" key={c.cat}>
                            <div className="cat-bar-head">
                              <span>{c.label}</span>
                              <span style={{ fontWeight: 700 }}>${c.monto.toLocaleString("es-MX")}</span>
                            </div>
                            <div className="cat-bar-track">
                              <div className="cat-bar-fill" style={{ width: `${c.pct}%`, background: c.color }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="panel-section-label" style={{ marginTop: 16 }}>
                      Ingresos por servicio — qué se vende más
                    </p>
                    {porServicio.length === 0 ? (
                      <div className="empty-card">Sin ingresos en este rango</div>
                    ) : (
                      <div className="form-card">
                        {porServicio.map((s, i) => (
                          <div className="cat-bar-row" key={s.tipo}>
                            <div className="cat-bar-head">
                              <span>
                                {i === 0 ? "🏆 " : ""}
                                {s.tipo}
                              </span>
                              <span style={{ fontWeight: 700 }}>${s.monto.toLocaleString("es-MX")}</span>
                            </div>
                            <div className="cat-bar-track">
                              <div className="cat-bar-fill" style={{ width: `${s.pct}%`, background: colorTipoEspacio(s.tipo) }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="panel-section-label" style={{ marginTop: 16 }}>
                      Ingresos por {porSemana ? "semana" : "día"}
                    </p>
                    {serieTiempo.length === 0 ? (
                      <div className="empty-card">Sin ingresos en este rango</div>
                    ) : (
                      <div className="form-card">
                        <div className="serie-chart">
                          {serieTiempo.map((b, i) => (
                            <div className="serie-bar-col" key={i} title={`${b.label}: $${b.monto.toLocaleString("es-MX")}`}>
                              <span className="serie-bar-val">
                                {b.monto >= 1000 ? `${Math.round(b.monto / 100) / 10}k` : b.monto.toLocaleString("es-MX")}
                              </span>
                              <div className="serie-bar-track">
                                <div className="serie-bar" style={{ height: `${Math.max(b.pct, 3)}%` }} />
                              </div>
                              <span className="serie-bar-lbl">{b.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {tab === "clientes" && (
              <>
                <p style={{ fontSize: 13, color: "#666", margin: "0 0 4px" }}>
                  La mensualidad de {centro} este mes: renta más adicionales de cobro mensual (ej. Estacionamiento), y si
                  ya se cubrió.
                </p>

                {cargandoClientes ? (
                  <div className="nodus-inline-loading">
                    <div className="nodus-spinner nodus-spinner-sm">
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                    </div>
                    <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#0d1b3e" }}>
                          ${resumenClientes.esperado.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Le toca al centro este mes</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#0F6E56" }}>
                          ${resumenClientes.cubierto.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Ya cubierto</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#A32D2D" }}>
                          ${resumenClientes.pendiente.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Pendiente</p>
                      </div>
                    </div>

                    <p className="panel-section-label" style={{ marginTop: 16 }}>
                      Clientes con contrato vigente ({clientesIngreso.length})
                    </p>
                    {clientesIngreso.length === 0 ? (
                      <div className="empty-card">Sin clientes con contrato vigente en {centro}</div>
                    ) : (
                      clientesIngreso.map((f) => (
                        <div className="reserva-admin-card" key={f.contratoId}>
                          <div className="reserva-admin-top">
                            <div>
                              <p className="reserva-admin-cliente">
                                {f.nombre}
                                {f.empresa ? ` · ${f.empresa}` : ""}
                              </p>
                              <p className="reserva-admin-detalle">Renta: ${f.renta.toLocaleString("es-MX")}</p>
                              {f.adicionales.map((a, i) => (
                                <p className="reserva-admin-detalle" key={i}>
                                  + {a.concepto}: ${a.monto.toLocaleString("es-MX")}
                                </p>
                              ))}
                              <p className="reserva-admin-detalle" style={{ fontWeight: 700, color: "#1a1a1a" }}>
                                Total del mes: ${f.esperado.toLocaleString("es-MX")}
                              </p>
                              <span
                                className="factura-badge"
                                style={{ background: ESTADO_MES_INFO[f.estadoMes].bg, marginTop: 4 }}
                              >
                                <span className="factura-badge-text" style={{ color: ESTADO_MES_INFO[f.estadoMes].color }}>
                                  {ESTADO_MES_INFO[f.estadoMes].label}
                                  {f.estadoMes === "pendiente" && ` · $${f.montoRelevante.toLocaleString("es-MX")}`}
                                </span>
                              </span>
                              {f.tieneRecargo && (
                                <span className="factura-badge" style={{ background: "#FCEBEB", marginTop: 4, marginLeft: 6 }}>
                                  <span className="factura-badge-text" style={{ color: "#A32D2D" }}>
                                    ⚠️ Con recargo por pago tardío
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}

            {tab === "gastos" && (
              <>
                <div className="gastos-total-card">
                  <p className="gastos-total-monto">
                    ${totalGastosCentro.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                  <p className="gastos-total-lbl">Total registrado en {centro}</p>
                </div>

                <p className="panel-section-label" style={{ marginTop: 12 }}>
                  Registrar gasto
                </p>
                <form className="form-card" onSubmit={registrarGasto}>
                  <div className="tel-form-grid">
                    <input placeholder="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
                    <input
                      placeholder="Categoría (ej. Renta, Mantenimiento)"
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Monto"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                    />
                    <input type="date" value={fechaGasto} onChange={(e) => setFechaGasto(e.target.value)} />
                  </div>
                  <input
                    type="text"
                    placeholder="Notas"
                    value={notasGasto}
                    onChange={(e) => setNotasGasto(e.target.value)}
                  />
                  <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                    <option value="">Sin proveedor (opcional)</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                  <p className="sub-label">Factura</p>
                  <FileDropzone files={factura} onChange={setFactura} maxFiles={1} accept="image/*,.pdf" />
                  <p className="sub-label">Comprobante de pago</p>
                  <FileDropzone files={comprobante} onChange={setComprobante} maxFiles={1} accept="image/*,.pdf" />

                  {errorGasto && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorGasto}</p>}

                  <button className="btn-enviar" type="submit" disabled={guardandoGasto}>
                    {guardandoGasto ? "Guardando..." : "+ Agregar gasto"}
                  </button>
                </form>

                <p className="panel-section-label" style={{ marginTop: 12 }}>
                  Historial ({gastos.length})
                </p>
                {cargandoGastos ? (
                  <div className="nodus-inline-loading">
                    <div className="nodus-spinner nodus-spinner-sm">
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                    </div>
                    <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
                  </div>
                ) : gastos.length === 0 ? (
                  <div className="empty-card">Sin gastos registrados en este centro</div>
                ) : (
                  gastos.map((g) => (
                    <div className="item-card" key={g.id}>
                      <div className="item-card-info">
                        <p className="item-card-titulo">{g.concepto}</p>
                        <p className="item-card-sub">
                          {new Date(g.fecha).toLocaleDateString("es-MX")}
                          {g.categoria ? ` · ${g.categoria}` : ""}
                          {proveedorNombre(g.proveedor_id) ? ` · ${proveedorNombre(g.proveedor_id)}` : ""}
                        </p>
                        {g.notas && <p className="item-card-extra">{g.notas}</p>}
                        {(g.factura_url || g.comprobante_pago_url) && (
                          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                            {g.factura_url && (
                              <button
                                type="button"
                                onClick={() => abrirComprobante(g.factura_url!)}
                                disabled={abriendoArchivoUrl === g.factura_url}
                                style={{ fontSize: 11, color: "#185FA5", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
                                {abriendoArchivoUrl === g.factura_url ? "Abriendo…" : "📎 Factura"}
                              </button>
                            )}
                            {g.comprobante_pago_url && (
                              <button
                                type="button"
                                onClick={() => abrirComprobante(g.comprobante_pago_url!)}
                                disabled={abriendoArchivoUrl === g.comprobante_pago_url}
                                style={{ fontSize: 11, color: "#185FA5", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
                                {abriendoArchivoUrl === g.comprobante_pago_url ? "Abriendo…" : "🧾 Comprobante de pago"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="item-card-monto">${Number(g.monto).toLocaleString("es-MX")}</p>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
