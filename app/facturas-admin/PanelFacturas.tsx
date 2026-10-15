"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import BotonArchivo from "@/app/components/BotonArchivo";
import { exportarExcel } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";
import { FORMAS_PAGO_SAT } from "@/lib/formasPagoSat";
import { esFacturaSimulada } from "@/lib/facturaSimulada";

// ---- Íconos de Facturas timbradas (trazo simple, toman el color del texto) ----
const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IconoBuscar = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
const IconoBorrar = () => (
  <Svg>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </Svg>
);
const IconoDocumento = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Svg>
);
const IconoArchivo = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M9 13h6M9 17h6" />
  </Svg>
);
const IconoEnlace = () => (
  <Svg>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Svg>
);
const IconoOjo = () => (
  <Svg>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
const IconoDescargar = () => (
  <Svg>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </Svg>
);
const IconoExcel = () => (
  <Svg>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m8 8 8 8M16 8l-8 8" />
  </Svg>
);
const IconoPdf = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M9 15h1.5a1.5 1.5 0 0 0 0-3H9v6" />
  </Svg>
);
const IconoImprimir = () => (
  <Svg>
    <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" />
  </Svg>
);

const COLUMNAS_TIMBRADAS: { clave: string; titulo: string }[] = [
  { clave: "folio", titulo: "Serie y folio" },
  { clave: "cliente", titulo: "Cliente" },
  { clave: "rfc", titulo: "RFC" },
  { clave: "concepto", titulo: "Concepto" },
  { clave: "fecha", titulo: "Fecha de emisión" },
  { clave: "situacion", titulo: "Situación del CFDI" },
  { clave: "fuente", titulo: "Fuente" },
  { clave: "total", titulo: "Total" },
];
const POR_PAGINA = 20;
const fechaCorta = (iso: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : iso || "");

type DatoTimbrada = {
  key: string;
  facturaId?: string;
  complementoId?: string;
  seleccionable: boolean;
  serieFolio: string;
  cliente: string;
  rfc: string;
  concepto: string;
  fecha: string;
  situacion: { texto: string; tipo: "verde" | "roja" | "ambar" | "gris" };
  fuente: { texto: string; icono: "archivo" | "enlace" };
  total: number;
  ver: string | null;
  pdf: string | null;
  xml: string | null;
  simulada: boolean;
  metodo: string | null;
  tipo: "I" | "P";
};

// De dónde viene cada factura. Las emitidas desde Nodus cuentan como "Manual" (las hace el personal);
// las importadas pueden venir de Nómina/Contpaq, del Portal del SAT o de ZORA.
function grupoFuente(fuente: string | null | undefined): string {
  return !fuente || fuente === "facturapi_auto" || fuente === "manual" ? "manual" : fuente;
}

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  parcial: { label: "◐ Parcial", bg: "#E8EEF9", color: "#254B8C" },
  pagada: { label: "✓ Pagada", bg: "#E1F5EE", color: "#0F6E56" },
  vencida: { label: "⚠️ Vencida", bg: "#FCEBEB", color: "#A32D2D" },
};

const dinero = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROLES_CANCELAR = ["admin", "gerente", "cobranza", "superadmin"];

const MOTIVOS_CANCELACION: { clave: string; texto: string }[] = [
  { clave: "02", texto: "Comprobante emitido con errores sin relación" },
  { clave: "01", texto: "Comprobante emitido con errores con relación" },
  { clave: "03", texto: "No se llevó a cabo la operación" },
  { clave: "04", texto: "Operación nominativa relacionada en una factura global" },
];

const CANCELACION_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  en_proceso: { label: "⏳ Cancelación en proceso", bg: "#FAEEDA", color: "#854F0B" },
  cancelada: { label: "✕ CFDI cancelado", bg: "#FCEBEB", color: "#A32D2D" },
  rechazada: { label: "↩ Cancelación rechazada (sigue vigente)", bg: "#E8EEF9", color: "#254B8C" },
};

// Una factura emitida desde Nodus (Facturapi) con CFDI vigente se puede cancelar.
function sePuedeCancelar(f: { fuente?: string | null; uuid_cfdi?: string | null; cancelacion_estatus?: string | null }) {
  return f.fuente === "facturapi_auto" && !!f.uuid_cfdi && f.cancelacion_estatus !== "cancelada" && f.cancelacion_estatus !== "en_proceso";
}

// Un cobro sin CFDI, con cliente y todavía por cobrar, se puede facturar a pago diferido (PPD).
// Como en ZORA: lo ya pagado se factura PUE y lo pendiente PPD; solo los cancelados no se facturan.
function sePuedeFacturar(f: { user_id?: string | null; uuid_cfdi?: string | null; estado: string }) {
  return !!f.user_id && !f.uuid_cfdi && f.estado !== "cancelada";
}

type Cliente = { id: string; nombre: string; email: string; empresa: string | null; nombre_fiscal?: string | null; rfc?: string | null };

type Factura = {
  id: string;
  user_id: string | null;
  folio: string;
  concepto: string;
  monto: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string;
  archivo_url: string | null;
  xml_url?: string | null;
  subtotal?: number | null;
  fuente?: string | null;
  uuid_cfdi?: string | null;
  cancelacion_estatus?: "en_proceso" | "cancelada" | "rechazada" | null;
  cancelacion_motivo?: string | null;
  metodo_pago?: string | null;
  serie?: string | null;
  folio_fiscal?: string | null;
  rfc_receptor?: string | null;
  cliente_nombre?: string;
  // Razón social (o empresa) del cliente: es lo que busca contabilidad.
  cliente_fiscal?: string;
  cliente_email?: string;
};

type Complemento = {
  id: string;
  user_id: string | null;
  cliente_nombre?: string;
  cliente_fiscal?: string;
  serie: string | null;
  folio_fiscal: string | null;
  uuid_cfdi: string | null;
  forma_pago: string;
  fecha_pago: string;
  monto: number;
  archivo_url: string | null;
  xml_url: string | null;
  numero_operacion?: string | null;
  notas?: string | null;
  comprobante_url?: string | null;
  cancelacion_estatus: "en_proceso" | "cancelada" | "rechazada" | null;
};
type FilaComplemento = { complemento_id: string; factura_id: string; importe: number };

type Pago = { id: string; monto: number; concepto: string | null; estado: string; factura_id: string | null; created_at: string; adicional_tipo?: string | null };
type PagoSuelto = Pago & { user_id: string };

// Un solo panel con dos vistas: "estados" (lo integrado que falta timbrar) y "timbradas" (los CFDI emitidos).
export default function PanelFacturas({ modo }: { modo: "estados" | "timbradas" }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pagosSueltos, setPagosSueltos] = useState<PagoSuelto[]>([]);
  const [complementos, setComplementos] = useState<Complemento[]>([]);
  const [filasComplemento, setFilasComplemento] = useState<FilaComplemento[]>([]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
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
    // Desde "Facturas generadas" del estado de cuenta se llega con el cliente (y su centro) ya elegidos.
    const params = new URLSearchParams(window.location.search);
    const clienteParam = params.get("cliente");
    const centroParam = params.get("centro");
    if (clienteParam) setFiltroCliente(clienteParam);
    // Desde el buscador de Facturación (?q=): se busca y se muestra la lista.
    const qParam = params.get("q");
    if (qParam) {
      setBusqueda(qParam);
      setVerTodas(true);
    }
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(centroParam && CENTROS_SUGERIDOS.includes(centroParam) ? centroParam : profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    const { data: clis } = await supabase
      .from("profiles")
      .select("id, nombre, email, empresa, nombre_fiscal, rfc")
      .eq("rol", "cliente")
      .eq("centro", c)
      .order("nombre");
    setClientes(clis || []);

    const clienteIds = (clis || []).map((cl) => cl.id);
    const nombrePorId: Record<string, string> = {};
    const emailPorId: Record<string, string> = {};
    const fiscalPorId: Record<string, string> = {};
    (clis || []).forEach((cl) => {
      nombrePorId[cl.id] = cl.nombre;
      emailPorId[cl.id] = cl.email;
      fiscalPorId[cl.id] = cl.nombre_fiscal || cl.empresa || "";
    });

    // Se filtra por `centro` (no por user_id in clienteIds) para que las
    // facturas importadas de CFDI sin cliente identificado (user_id null)
    // también aparezcan en la lista, no solo las que ya tienen dueño.
    const { data: facts } = await supabase
      .from("facturas")
      .select("*")
      .eq("centro", c)
      .order("fecha_emision", { ascending: false });
    setFacturas(
      (facts || []).map((f) => ({
        ...f,
        cliente_nombre: f.user_id ? nombrePorId[f.user_id] || "Cliente" : f.rfc_receptor === "XAXX010101000" ? "Público en general" : "Cliente no identificado",
        cliente_email: f.user_id ? emailPorId[f.user_id] || "" : "",
        cliente_fiscal: f.user_id ? fiscalPorId[f.user_id] || "" : "",
      }))
    );

    // Pagos sin factura vinculada — candidatos a "Vincular a esta factura".
    const { data: sueltos } =
      clienteIds.length > 0
        ? await supabase
            .from("pagos")
            .select("id, user_id, monto, concepto, estado, factura_id, created_at, adicional_tipo")
            .in("user_id", clienteIds)
            .is("factura_id", null)
            .order("created_at", { ascending: false })
        : { data: [] as PagoSuelto[] };
    setPagosSueltos((sueltos as PagoSuelto[]) || []);

    // Complementos de pago del centro y qué facturas cubre cada uno (para calcular saldos).
    const { data: comps } = await supabase
      .from("complementos_pago")
      .select("id, user_id, serie, folio_fiscal, uuid_cfdi, forma_pago, fecha_pago, monto, archivo_url, xml_url, numero_operacion, notas, comprobante_url, cancelacion_estatus")
      .eq("centro", c)
      .order("created_at", { ascending: false })
      .limit(300);
    const compIds = (comps || []).map((x) => x.id);
    const { data: filasComp } = compIds.length
      ? await supabase.from("complemento_pago_facturas").select("complemento_id, factura_id, importe").in("complemento_id", compIds)
      : { data: [] as FilaComplemento[] };
    setComplementos(((comps as Complemento[]) || []).map((x) => ({ ...x, cliente_nombre: x.user_id ? nombrePorId[x.user_id] || "Cliente" : "Cliente", cliente_fiscal: x.user_id ? fiscalPorId[x.user_id] || "" : "" })));
    setFilasComplemento((filasComp as FilaComplemento[]) || []);
    setLoading(false);
  }

  // ---- Ver / vincular pagos de una factura ----
  const [facturaExpandidaId, setFacturaExpandidaId] = useState<string | null>(null);
  const [pagosDeFactura, setPagosDeFactura] = useState<Pago[]>([]);
  const [cargandoPagos, setCargandoPagos] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  async function toggleFactura(f: Factura) {
    if (facturaExpandidaId === f.id) {
      setFacturaExpandidaId(null);
      return;
    }
    setFacturaExpandidaId(f.id);
    setCargandoPagos(true);
    const { data } = await supabase
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, created_at")
      .eq("factura_id", f.id)
      .order("created_at", { ascending: false });
    setPagosDeFactura(data || []);
    setCargandoPagos(false);
  }

  async function vincularPago(pagoId: string, facturaId: string) {
    setVinculando(pagoId);
    await fetch("/api/pagos/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoIds: [pagoId], facturaId }),
    });
    setVinculando(null);
    if (centro) fetchTodo(centro);
    // Refresca la lista de pagos de la factura abierta
    const { data } = await supabase
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, created_at")
      .eq("factura_id", facturaId)
      .order("created_at", { ascending: false });
    setPagosDeFactura(data || []);
  }

  const pagosSueltosDelCliente = (clienteId: string) => pagosSueltos.filter((p) => p.user_id === clienteId);

  // ---- Filtros (100% client-side, no tocan la consulta a Supabase) ----
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroFuente, setFiltroFuente] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [soloSinCliente, setSoloSinCliente] = useState(false);
  const [filtroCliente, setFiltroCliente] = useState("");
  // Filtros avanzados de Facturas timbradas.
  const [filtroMetodo, setFiltroMetodo] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const pestana = modo === "timbradas" ? "timbradas" : "por_timbrar";
  const [filtroCfdi, setFiltroCfdi] = useState("");

  const hayFiltrosActivos =
    !!busqueda || !!filtroEstado || !!filtroFuente || !!filtroDesde || !!filtroHasta || soloSinCliente || !!filtroCliente || !!filtroCfdi;

  // La lista no se muestra completa de entrada: primero se busca un cliente (o se pide ver todas).
  const [verTodas, setVerTodas] = useState(false);

  function limpiarFiltros() {
    setVerTodas(false);
    setBusqueda("");
    setFiltroEstado("");
    setFiltroFuente("");
    setFiltroDesde("");
    setFiltroHasta("");
    setSoloSinCliente(false);
    setFiltroCliente("");
    setFiltroCfdi("");
    setFiltroMetodo("");
    setFiltroTipo("");
  }

  // Lo que coincide con los filtros, de las dos pestañas (de aquí salen los conteos y el resumen del cliente).
  const facturasBase = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return facturas.filter((f) => {
      if (q) {
        const enTexto = [f.folio, f.concepto, f.uuid_cfdi, f.rfc_receptor, f.cliente_nombre, f.cliente_fiscal, f.cliente_email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!enTexto.includes(q)) return false;
      }
      if (filtroEstado === "cancelacion") {
        if (!f.cancelacion_estatus) return false;
      } else if (filtroEstado && f.estado !== filtroEstado) return false;
      if (filtroFuente && grupoFuente(f.fuente) !== filtroFuente) return false;
      if (filtroDesde && f.fecha_emision < filtroDesde) return false;
      if (filtroHasta && f.fecha_emision > filtroHasta) return false;
      if (soloSinCliente && (f.user_id || f.rfc_receptor === "XAXX010101000")) return false;
      if (filtroCliente && f.user_id !== filtroCliente) return false;
      if (filtroCfdi === "vigente" && (f.cancelacion_estatus === "cancelada" || f.cancelacion_estatus === "en_proceso")) return false;
      if (filtroCfdi && filtroCfdi !== "vigente" && f.cancelacion_estatus !== filtroCfdi) return false;
      return true;
    });
  }, [facturas, busqueda, filtroEstado, filtroFuente, filtroDesde, filtroHasta, soloSinCliente, filtroCliente, filtroCfdi]);

  const facturasFiltradas = useMemo(
    () => facturasBase.filter((f) => (pestana === "timbradas" ? !!f.uuid_cfdi : !f.uuid_cfdi)),
    [facturasBase, pestana]
  );

  // Los complementos de pago son CFDI timbrados (tipo Pago): salen en la pestaña Timbradas.
  const complementosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return complementos.filter((c) => {
      // Los complementos los emite Nodus: entran en "Manual".
      if (filtroEstado || (filtroFuente && filtroFuente !== "manual") || soloSinCliente) return false;
      if (filtroCliente && c.user_id !== filtroCliente) return false;
      if (q && ![c.serie, c.folio_fiscal, c.uuid_cfdi, c.cliente_nombre, c.cliente_fiscal, c.numero_operacion].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
      if (filtroDesde && c.fecha_pago < filtroDesde) return false;
      if (filtroHasta && c.fecha_pago > filtroHasta) return false;
      if (filtroCfdi === "vigente" && (c.cancelacion_estatus === "cancelada" || c.cancelacion_estatus === "en_proceso")) return false;
      if (filtroCfdi && filtroCfdi !== "vigente" && c.cancelacion_estatus !== filtroCfdi) return false;
      return true;
    });
  }, [complementos, busqueda, filtroEstado, filtroFuente, soloSinCliente, filtroCliente, filtroDesde, filtroHasta, filtroCfdi]);

  type FilaTimbrada = { tipo: "I"; fecha: string; f: Factura } | { tipo: "P"; fecha: string; c: Complemento };
  const filasTimbradas: FilaTimbrada[] = [
    ...facturasFiltradas.map((f): FilaTimbrada => ({ tipo: "I", fecha: f.fecha_emision, f })),
    ...complementosFiltrados.map((c): FilaTimbrada => ({ tipo: "P", fecha: c.fecha_pago, c })),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  // ---- Facturas timbradas: tabla con orden, páginas, exportar e imprimir (diseño que pidió contabilidad) ----
  const [avanzados, setAvanzados] = useState(false);
  const [orden, setOrden] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "fecha", dir: "desc" });
  const [pagina, setPagina] = useState(1);
  const [compSel, setCompSel] = useState<string | null>(null);
  const [todoVisible, setTodoVisible] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const tablaTimbradasRef = useRef<HTMLDivElement>(null);
  // Vista previa del PDF de una factura (ícono del ojo).
  const [pdfVisor, setPdfVisor] = useState<{ url: string; descarga: string; titulo: string } | null>(null);

  const rfcPorCliente = new Map(clientes.map((c) => [c.id, c.rfc || ""]));
  const situacionDe = (cancel: string | null | undefined, uuid: string | null | undefined): DatoTimbrada["situacion"] =>
    cancel === "cancelada"
      ? { texto: "Cancelado", tipo: "roja" }
      : cancel === "en_proceso"
        ? { texto: "En cancelación", tipo: "ambar" }
        : esFacturaSimulada(uuid)
          ? { texto: "Simulada (prueba)", tipo: "gris" }
          : { texto: "Vigente", tipo: "verde" };
  const fuenteDe = (fuente: string | null | undefined): DatoTimbrada["fuente"] =>
    fuente === "cfdi_import"
      ? { texto: "Importada (ZORA)", icono: "enlace" }
      : fuente === "contpaq"
        ? { texto: "Nómina/Contpaq", icono: "enlace" }
        : fuente === "portal_sat"
          ? { texto: "Portal SAT", icono: "enlace" }
          : { texto: "Manual", icono: "archivo" };

  const filasT: DatoTimbrada[] = filasTimbradas
    .map((fila): DatoTimbrada => {
      if (fila.tipo === "P") {
        const c = fila.c;
        const cubierta = filasComplemento.find((x) => x.complemento_id === c.id)?.factura_id;
        return {
          key: "c" + c.id,
          complementoId: c.id,
          seleccionable: false,
          serieFolio: c.serie ? c.serie + "-" + (c.folio_fiscal || "") : c.folio_fiscal || "—",
          cliente: c.cliente_fiscal || c.cliente_nombre || "Cliente",
          rfc: c.user_id ? rfcPorCliente.get(c.user_id) || "" : "",
          concepto: "Complemento de pago",
          fecha: c.fecha_pago,
          situacion: situacionDe(c.cancelacion_estatus, c.uuid_cfdi),
          fuente: fuenteDe("facturapi_auto"),
          total: Number(c.monto),
          ver: cubierta ? "/facturas-admin/estados-de-cuenta/" + cubierta : null,
          pdf: c.archivo_url ? "/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=pdf" : null,
          xml: c.xml_url ? "/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=xml" : null,
          simulada: false,
          metodo: null,
          tipo: "P",
        };
      }
      const f = fila.f;
      return {
        key: "f" + f.id,
        facturaId: f.id,
        seleccionable: ROLES_CANCELAR.includes(miRol) && (sePuedeCancelar(f) || sePuedeComplementar(f)),
        serieFolio: f.serie ? f.serie + "-" + (f.folio_fiscal || "") : f.folio,
        cliente: f.cliente_fiscal || f.cliente_nombre || "Cliente",
        rfc: f.rfc_receptor || "",
        concepto: f.concepto,
        fecha: f.fecha_emision,
        situacion: situacionDe(f.cancelacion_estatus, f.uuid_cfdi),
        fuente: fuenteDe(f.fuente),
        total: Number(f.monto),
        ver: "/facturas-admin/estados-de-cuenta/" + f.id,
        pdf: f.archivo_url ? "/api/facturas/descargar?id=" + f.id + "&tipo=pdf" : null,
        xml: f.xml_url ? "/api/facturas/descargar?id=" + f.id + "&tipo=xml" : null,
        simulada: esFacturaSimulada(f.uuid_cfdi),
        metodo: f.metodo_pago || null,
        tipo: "I",
      };
    })
    .filter((d) => (!filtroMetodo || d.metodo === filtroMetodo) && (!filtroTipo || d.tipo === filtroTipo))
    .sort((a, b) => {
      const k = orden.col;
      const va: string | number = k === "total" ? a.total : k === "situacion" ? a.situacion.texto : k === "fuente" ? a.fuente.texto : k === "folio" ? a.serieFolio : (a as any)[k] || "";
      const vb: string | number = k === "total" ? b.total : k === "situacion" ? b.situacion.texto : k === "fuente" ? b.fuente.texto : k === "folio" ? b.serieFolio : (b as any)[k] || "";
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { numeric: true });
      return orden.dir === "asc" ? c : -c;
    });
  const totalPaginas = Math.max(1, Math.ceil(filasT.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const filasVisibles = todoVisible ? filasT : filasT.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  const idsPaginaSeleccionables = filasVisibles.filter((d) => d.facturaId && d.seleccionable).map((d) => d.facturaId as string);

  function ordenarPor(col: string) {
    setOrden((o) => (o.col === col ? { col, dir: o.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "fecha" || col === "total" ? "desc" : "asc" }));
    setPagina(1);
  }

  function exportarTimbradasExcel() {
    exportarExcel(
      `facturas-timbradas-${centro}`,
      filasT.map((d) => ({
        "Serie y folio": d.serieFolio,
        Cliente: d.cliente,
        RFC: d.rfc,
        Concepto: d.concepto,
        "Fecha de emisión": d.fecha,
        "Situación del CFDI": d.situacion.texto,
        Fuente: d.fuente.texto,
        Tipo: d.tipo === "P" ? "Pago" : "Ingreso",
        Método: d.metodo || "",
        Total: d.total,
      }))
    );
  }

  async function descargarTimbradasPdf() {
    setGenerandoPdf(true);
    setTodoVisible(true);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      // @ts-ignore — html2pdf.js no trae tipos; depende del navegador, por eso se carga aquí.
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [8, 8, 8, 8],
          filename: `facturas-timbradas-${centro}.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "letter", orientation: "landscape" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(tablaTimbradasRef.current)
        .save();
    } finally {
      setTodoVisible(false);
      setGenerandoPdf(false);
    }
  }

  function imprimirTimbradas() {
    setTodoVisible(true);
    setTimeout(() => {
      window.print();
      setTodoVisible(false);
    }, 200);
  }

  // ---- Complementos de pago (facturas a pago diferido) ----
  const [tipoCancelar, setTipoCancelar] = useState<"factura" | "complemento">("factura");
  const [modalComplemento, setModalComplemento] = useState<{ userId: string; ids: string[] } | null>(null);
  const [formaPagoComp, setFormaPagoComp] = useState("03");
  const [fechaPagoComp, setFechaPagoComp] = useState("");
  const [importesComp, setImportesComp] = useState<Record<string, string>>({});
  const [emitiendoComp, setEmitiendoComp] = useState(false);
  const [numeroOpComp, setNumeroOpComp] = useState("");
  const [notasComp, setNotasComp] = useState("");
  const [comprobanteComp, setComprobanteComp] = useState<File | null>(null);
  const [errorComp, setErrorComp] = useState("");

  // Lo cubierto por complementos no cancelados; el saldo es lo que falta.
  function saldoDe(facturaId: string): number {
    const f = facturas.find((x) => x.id === facturaId);
    if (!f) return 0;
    const cancelados = new Set(complementos.filter((c) => c.cancelacion_estatus === "cancelada").map((c) => c.id));
    const cubierto = filasComplemento.filter((r) => r.factura_id === facturaId && !cancelados.has(r.complemento_id)).reduce((s, r) => s + Number(r.importe), 0);
    return Math.round((Number(f.monto) - cubierto) * 100) / 100;
  }

  function sePuedeComplementar(f: Factura) {
    return (
      !!f.user_id &&
      !!f.uuid_cfdi &&
      f.metodo_pago === "PPD" &&
      f.cancelacion_estatus !== "cancelada" &&
      f.cancelacion_estatus !== "en_proceso" &&
      saldoDe(f.id) > 0
    );
  }

  function abrirComplemento(ids: string[]) {
    const elegidas = ids.map((id) => facturas.find((f) => f.id === id)).filter(Boolean) as Factura[];
    const clientesDistintos = new Set(elegidas.map((f) => f.user_id));
    if (elegidas.length === 0) return;
    if (clientesDistintos.size > 1) {
      setAvisoCancelar("Un complemento cubre facturas de un solo cliente: elige facturas del mismo cliente.");
      return;
    }
    setModalComplemento({ userId: elegidas[0].user_id as string, ids });
    setFormaPagoComp("03");
    setFechaPagoComp(hoyMexicoISO());
    setImportesComp(Object.fromEntries(ids.map((id) => [id, String(saldoDe(id))])));
    setNumeroOpComp("");
    setNotasComp("");
    setComprobanteComp(null);
    setErrorComp("");
  }

  async function emitirComplemento() {
    if (!modalComplemento) return;
    const items = modalComplemento.ids.map((id) => ({ facturaId: id, importe: Number(importesComp[id]) }));
    if (items.some((i) => !(i.importe > 0))) {
      setErrorComp("Escribe un importe mayor a cero para cada factura");
      return;
    }
    setEmitiendoComp(true);
    setErrorComp("");
    // El comprobante (opcional) se sube primero al almacenamiento privado.
    let comprobanteUrl: string | null = null;
    if (comprobanteComp) {
      const ext = comprobanteComp.name.split(".").pop() || "pdf";
      const nombre = "comprobante-pago-" + modalComplemento.userId + "-" + Date.now() + "." + ext;
      const { error: errSubida } = await supabase.storage.from("facturas").upload(nombre, comprobanteComp, { contentType: comprobanteComp.type, upsert: true });
      if (errSubida) {
        setEmitiendoComp(false);
        setErrorComp("No se pudo subir el comprobante: " + errSubida.message);
        return;
      }
      comprobanteUrl = supabase.storage.from("facturas").getPublicUrl(nombre).data.publicUrl;
    }
    const res = await fetch("/api/complementos/emitir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: modalComplemento.userId,
        items,
        formaPago: formaPagoComp,
        fecha: fechaPagoComp,
        numeroOperacion: numeroOpComp,
        notas: notasComp,
        comprobanteUrl,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setEmitiendoComp(false);
    if (!res.ok) {
      setErrorComp(data.error || "No se pudo emitir el complemento");
      return;
    }
    setModalComplemento(null);
    setSeleccion([]);
    setAvisoCancelar("✓ Complemento de pago emitido (" + items.length + " factura(s)).");
    if (centro) fetchTodo(centro);
  }

  function abrirCancelarComplemento(id: string) {
    setTipoCancelar("complemento");
    setModalCancelar([id]);
    setMotivoCancelar("02");
    setSustitutaUuid("");
    setErrorCancelar("");
  }

  // ---- Facturar cobros pendientes (CFDI a pago diferido) ----
  const [facturando, setFacturando] = useState(false);
  // Varios estados de cuenta a la vez: cuadro con las mismas opciones del cuadro Facturar (condiciones, método y forma).
  const [loteFacturar, setLoteFacturar] = useState<string[] | null>(null);
  const [condLote, setCondLote] = useState("Contado");
  const [metodoLote, setMetodoLote] = useState<"PPD" | "PUE">("PPD");
  const [formaLote, setFormaLote] = useState("03");
  function abrirFacturarLote(ids: string[]) {
    setLoteFacturar(ids);
    setCondLote("Contado");
    setMetodoLote("PPD");
    setFormaLote("03");
  }
  async function facturarCobros(ids: string[]) {
    if (ids.length === 0) return;
    setFacturando(true);
    const res = await fetch("/api/facturas/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaIds: ids, metodo: metodoLote, formaPago: metodoLote === "PUE" ? formaLote : undefined, condicionesPago: condLote.trim() || undefined }),
    });
    setLoteFacturar(null);
    const data = await res.json().catch(() => ({}));
    setFacturando(false);
    if (!res.ok && !data.resultados) {
      setAvisoCancelar(data.error || "No se pudo facturar");
      return;
    }
    const resultados: { id: string; folio?: string; ok: boolean; error?: string }[] = data.resultados || [];
    const fallidas = resultados.filter((r) => !r.ok);
    const hechas = resultados.length - fallidas.length;
    setSeleccion((s) => s.filter((i) => !resultados.some((r) => r.id === i && r.ok)));
    setAvisoCancelar(
      (hechas > 0 ? "✓ " + hechas + " factura(s) emitida(s). " : "") +
        (fallidas.length > 0
          ? "✗ " + fallidas.length + " no se pudo(ieron): " + fallidas.slice(0, 3).map((r) => (r.folio || "") + " — " + r.error).join(" · ") + (fallidas.length > 3 ? " …" : "")
          : "")
    );
    if (centro) fetchTodo(centro);
  }

  // ---- Cancelación de CFDI ----
  const puedoCancelar = ROLES_CANCELAR.includes(miRol);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [modalCancelar, setModalCancelar] = useState<string[] | null>(null);
  const [motivoCancelar, setMotivoCancelar] = useState("02");
  const [sustitutaUuid, setSustitutaUuid] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState("");
  const [avisoCancelar, setAvisoCancelar] = useState("");
  const [actualizandoEstatus, setActualizandoEstatus] = useState(false);
  const hayEnProceso = facturas.some((f) => f.cancelacion_estatus === "en_proceso") || complementos.some((c) => c.cancelacion_estatus === "en_proceso");
  const seleccionComplementables = seleccion.filter((id) => {
    const f = facturas.find((x) => x.id === id);
    return !!f && sePuedeComplementar(f);
  });
  const seleccionFacturables = seleccion.filter((id) => {
    const f = facturas.find((x) => x.id === id);
    return !!f && sePuedeFacturar(f);
  });
  const seleccionCancelables = seleccion.filter((id) => {
    const f = facturas.find((x) => x.id === id);
    return !!f && sePuedeCancelar(f);
  });

  function abrirCancelar(ids: string[]) {
    setTipoCancelar("factura");
    setModalCancelar(ids);
    setMotivoCancelar("02");
    setSustitutaUuid("");
    setErrorCancelar("");
  }

  async function confirmarCancelar() {
    if (!modalCancelar) return;
    setCancelando(true);
    setErrorCancelar("");
    const esComp = tipoCancelar === "complemento";
    const res = await fetch(esComp ? "/api/complementos/cancelar" : "/api/facturas/cancelar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        esComp ? { complementoId: modalCancelar[0], motivo: motivoCancelar, sustitutaUuid } : { facturaIds: modalCancelar, motivo: motivoCancelar, sustitutaUuid }
      ),
    });
    const data = await res.json().catch(() => ({}));
    setCancelando(false);
    if (!res.ok && !data.resultados) {
      setErrorCancelar(data.error || "No se pudo cancelar");
      return;
    }
    if (esComp) {
      setModalCancelar(null);
      setAvisoCancelar("✓ Cancelación del complemento enviada al SAT. Lo que cubría vuelve al saldo de sus facturas.");
      if (centro) fetchTodo(centro);
      return;
    }
    const resultados: { id: string; ok: boolean; estatus?: string; error?: string }[] = data.resultados || [];
    const fallidas = resultados.filter((r) => !r.ok);
    const hechas = resultados.length - fallidas.length;
    setModalCancelar(null);
    setSeleccion([]);
    setAvisoCancelar(
      (hechas > 0 ? `✓ ${hechas} cancelación(es) enviada(s) al SAT. ` : "") +
        (fallidas.length > 0 ? `✗ ${fallidas.length} no se pudo(ieron): ${fallidas[0].error}` : "")
    );
    if (centro) fetchTodo(centro);
  }

  async function actualizarEstatusCancelaciones(silencioso = false) {
    setActualizandoEstatus(true);
    const res = await fetch("/api/facturas/estatus-cancelacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    setActualizandoEstatus(false);
    const cambiaron = (data.resultados || []).filter((r: { estatus?: string }) => r.estatus && r.estatus !== "en_proceso").length;
    if (cambiaron > 0 && centro) fetchTodo(centro);
    if (!silencioso) setAvisoCancelar(cambiaron > 0 ? `✓ ${cambiaron} cancelación(es) cambió de estatus.` : "Sin cambios: siguen esperando respuesta del cliente.");
  }

  // Al abrir la pantalla, se revisan solas las cancelaciones que esperaban respuesta.
  const [revisoCancelaciones, setRevisoCancelaciones] = useState(false);
  useEffect(() => {
    if (!revisoCancelaciones && hayEnProceso && puedoCancelar) {
      setRevisoCancelaciones(true);
      actualizarEstatusCancelaciones(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayEnProceso, puedoCancelar]);

  const [asignando, setAsignando] = useState<string | null>(null);
  async function asignarCliente(facturaId: string, clienteId: string) {
    if (!clienteId) return;
    setAsignando(facturaId);
    await supabase.from("facturas").update({ user_id: clienteId }).eq("id", facturaId);
    setAsignando(null);
    if (centro) fetchTodo(centro);
  }

  // Si se busca a un cliente (o se elige en el filtro) y todo lo que se ve es suyo, se muestra su resumen arriba.
  const resumenCliente = (() => {
    if (!busqueda.trim() && !filtroCliente) return null;
    const ids = new Set(facturasBase.map((f) => f.user_id));
    const id = ids.size === 1 ? [...ids][0] : null;
    if (!id) return null;
    const cli = clientes.find((c) => c.id === id);
    if (!cli) return null;
    const vigentes = facturasBase.filter((f) => f.cancelacion_estatus !== "cancelada");
    const suma = (lista: Factura[]) => Math.round(lista.reduce((s, f) => s + Number(f.monto), 0) * 100) / 100;
    return {
      id,
      nombre: cli.nombre_fiscal || cli.empresa || cli.nombre,
      email: cli.email,
      rfc: facturasBase.find((f) => f.rfc_receptor)?.rfc_receptor || "",
      vigentes: vigentes.length,
      canceladas: facturasBase.length - vigentes.length,
      facturado: suma(vigentes),
      pagado: suma(vigentes.filter((f) => f.estado === "pagada")),
      porCobrar: suma(vigentes.filter((f) => f.estado !== "pagada")),
    };
  })();

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Facturación
        </a>
        <p className="rep-title">{modo === "timbradas" ? "Facturas timbradas" : "Estados de cuenta"}</p>
        <p className="rep-sub">
          {centro || "Selecciona un centro"}
          {modo === "timbradas" ? " · consulta y descarga tus facturas electrónicas de pago" : " · lo integrado que falta por timbrar"}
        </p>
      </div>

      <div className="rep-content rep-content-completo">
        {!centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : loading ? (
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
            {modo !== "timbradas" && (
              <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Facturas ({hayFiltrosActivos ? `${facturasFiltradas.length} de ${facturas.length}` : facturas.length})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {puedoCancelar && hayEnProceso && (
                  <button className="btn-exportar" disabled={actualizandoEstatus} onClick={() => actualizarEstatusCancelaciones()}>
                    {actualizandoEstatus ? "Consultando..." : "Actualizar estatus"}
                  </button>
                )}
                {puedoCancelar && seleccionFacturables.length > 0 && (
                  <button className="btn-exportar" disabled={facturando} onClick={() => abrirFacturarLote(seleccionFacturables)}>
                    {facturando ? "Facturando..." : `Facturar seleccionados (${seleccionFacturables.length})`}
                  </button>
                )}
                {puedoCancelar && seleccionComplementables.length > 0 && (
                  <button className="btn-exportar" onClick={() => abrirComplemento(seleccionComplementables)}>
                    Emitir complemento de pago ({seleccionComplementables.length})
                  </button>
                )}
                {puedoCancelar && seleccionCancelables.length > 0 && (
                  <button className="btn-exportar" style={{ color: "#A32D2D" }} onClick={() => abrirCancelar(seleccionCancelables)}>
                    Cancelar seleccionadas ({seleccionCancelables.length})
                  </button>
                )}
                <button
                  className="btn-exportar"
                  onClick={() =>
                    exportarExcel(
                      `facturas-${centro}`,
                      facturasFiltradas.map((f) => ({
                        Cliente: f.cliente_fiscal || f.cliente_nombre || "",
                        RFC: f.rfc_receptor || "",
                        Correo: f.cliente_email || "",
                        Folio: f.serie ? f.serie + "-" + (f.folio_fiscal || "") : f.folio,
                        UUID: f.uuid_cfdi || "",
                        Subtotal: f.subtotal ?? "",
                        Metodo: f.metodo_pago || "",
                        Concepto: f.concepto,
                        Monto: f.monto,
                        Emision: f.fecha_emision,
                        Vencimiento: f.fecha_vencimiento,
                        Estado: f.estado,
                        Fuente: f.fuente || "manual",
                      }))
                    )
                  }
                >
                  Excel
                </button>
                {modo === "estados" && (
                  <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} href="/facturas-admin/integrar-cliente">
                    + Integrar por cliente
                  </a>
                )}
              </div>
            </div>

            <div className="form-card" style={{ marginTop: 8 }}>
              <div className="tel-form-grid">
                {esGlobal && centrosDisponibles.length > 1 && (
                  <div>
                    <p className="sub-label">Centro</p>
                    <select
                      value={centro || ""}
                      onChange={(e) => {
                        setFiltroCliente("");
                        setCentro(e.target.value);
                      }}
                    >
                      {centrosDisponibles.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <p className="sub-label">Cliente</p>
                  <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
                    <option value="">Todos</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre_fiscal || c.empresa || c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="sub-label">Buscar</p>
                  <input
                    className="search-box"
                    placeholder="Folio, concepto, RFC, cliente..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                  />
                </div>
                <div>
                  <p className="sub-label">Estado</p>
                  <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="parcial">Parcial</option>
                    <option value="pagada">Pagada</option>
                    <option value="vencida">Vencida</option>
                    <option value="cancelacion">Con cancelación</option>
                  </select>
                </div>
                {pestana === "timbradas" && (
                  <div>
                    <p className="sub-label">Situación del CFDI</p>
                    <select value={filtroCfdi} onChange={(e) => setFiltroCfdi(e.target.value)}>
                      <option value="">Todas</option>
                      <option value="vigente">Emitida (vigente)</option>
                      <option value="cancelada">Cancelada</option>
                      <option value="en_proceso">Cancelación en proceso</option>
                      <option value="rechazada">Cancelación rechazada</option>
                    </select>
                  </div>
                )}
                <div>
                  <p className="sub-label">Fuente</p>
                  <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)}>
                    <option value="">Todas</option>
                    <option value="manual">Manual</option>
                    <option value="contpaq">Nómina/Contpaq</option>
                    <option value="portal_sat">Portal SAT</option>
                    <option value="cfdi_import">Importada (ZORA)</option>
                  </select>
                </div>
                <div>
                  <p className="sub-label">Emisión desde</p>
                  <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
                </div>
                <div>
                  <p className="sub-label">Emisión hasta</p>
                  <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#333" }}>
                <input type="checkbox" checked={soloSinCliente} onChange={(e) => setSoloSinCliente(e.target.checked)} />
                Solo sin cliente
              </label>
              {hayFiltrosActivos && (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#A32D2D", fontWeight: 600, marginTop: 8 }}
                  onClick={limpiarFiltros}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
              </>
            )}

            {modo === "timbradas" && (
              <div className="ft-card no-imprimir">
                <div className="ft-card-cab">
                  <div className="ft-cab-titulo">
                    <span className="ft-cab-icono">
                      <IconoBuscar />
                    </span>
                    <div>
                      <p className="ft-titulo">Filtros de búsqueda</p>
                      <p className="ft-sub">Selecciona los criterios para encontrar tus facturas timbradas.</p>
                    </div>
                  </div>
                  <button type="button" className="ft-btn-sec" onClick={limpiarFiltros}>
                    <IconoBorrar /> Limpiar filtros
                  </button>
                </div>
                <div className="ft-grid">
                  <label className="ft-campo">
                    <span>Centro</span>
                    <select
                      value={centro || ""}
                      disabled={!esGlobal || centrosDisponibles.length <= 1}
                      onChange={(e) => {
                        setFiltroCliente("");
                        setCentro(e.target.value);
                      }}
                    >
                      {(esGlobal && centrosDisponibles.length > 1 ? centrosDisponibles : [centro || ""]).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ft-campo">
                    <span>Cliente</span>
                    <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
                      <option value="">Todos</option>
                      {clientes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre_fiscal || c.empresa || c.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ft-campo">
                    <span>Buscar</span>
                    <input placeholder="Folio, concepto, RFC, cliente..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                  </label>
                  <label className="ft-campo">
                    <span>Estado</span>
                    <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                      <option value="">Todos</option>
                      <option value="pendiente">Pendiente de pago</option>
                      <option value="parcial">Pago parcial</option>
                      <option value="pagada">Pagada</option>
                      <option value="vencida">Vencida</option>
                    </select>
                  </label>
                  <label className="ft-campo">
                    <span>Situación del CFDI</span>
                    <select value={filtroCfdi} onChange={(e) => setFiltroCfdi(e.target.value)}>
                      <option value="">Todos</option>
                      <option value="vigente">Vigente</option>
                      <option value="cancelada">Cancelado</option>
                      <option value="en_proceso">Cancelación en proceso</option>
                      <option value="rechazada">Cancelación rechazada</option>
                    </select>
                  </label>
                  <label className="ft-campo">
                    <span>Fuente</span>
                    <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)}>
                      <option value="">Todos</option>
                      <option value="manual">Manual</option>
                      <option value="contpaq">Nómina/Contpaq</option>
                      <option value="portal_sat">Portal SAT</option>
                      <option value="cfdi_import">Importada (ZORA)</option>
                    </select>
                  </label>
                  <label className="ft-campo">
                    <span>Emisión desde</span>
                    <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
                  </label>
                  <label className="ft-campo">
                    <span>Emisión hasta</span>
                    <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
                  </label>
                </div>
                {avanzados && (
                  <div className="ft-grid" style={{ paddingTop: 0 }}>
                    <label className="ft-campo">
                      <span>Método de pago</span>
                      <select value={filtroMetodo} onChange={(e) => setFiltroMetodo(e.target.value)}>
                        <option value="">Todos</option>
                        <option value="PUE">PUE · una sola exhibición</option>
                        <option value="PPD">PPD · pago diferido</option>
                      </select>
                    </label>
                    <label className="ft-campo">
                      <span>Tipo de comprobante</span>
                      <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                        <option value="">Todos</option>
                        <option value="I">Ingreso (factura)</option>
                        <option value="P">Pago (complemento)</option>
                      </select>
                    </label>
                  </div>
                )}
                <div className="ft-pie">
                  <button type="button" className="ft-avanzados" onClick={() => setAvanzados((v) => !v)} aria-expanded={avanzados}>
                    <span style={{ display: "inline-block", transform: avanzados ? "rotate(180deg)" : "none" }}>⌄</span> Filtros avanzados (opcional)
                  </button>
                  <button
                    type="button"
                    className="ft-btn-buscar"
                    onClick={() => {
                      setVerTodas(true);
                      setPagina(1);
                    }}
                  >
                    <IconoBuscar /> Buscar
                  </button>
                </div>
              </div>
            )}

            {avisoCancelar && (
              <div className="form-card" style={{ marginTop: 8, fontSize: 13 }}>
                {avisoCancelar}
                <button className="tel-borrar-btn" style={{ marginLeft: 8 }} onClick={() => setAvisoCancelar("")}>
                  Cerrar
                </button>
              </div>
            )}

            {modalComplemento && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
                onClick={() => !emitiendoComp && setModalComplemento(null)}
              >
                <div className="form-card" style={{ maxWidth: 480, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                  <p className="contrato-cliente-nombre">Complemento de pago</p>
                  <p style={{ fontSize: 12, color: "#666", margin: "4px 0 10px" }}>
                    Un solo complemento cubre las facturas de abajo. El importe de cada una viene con su saldo; si el cliente pagó menos, cámbialo (queda como parcialidad).
                  </p>
                  {modalComplemento.ids.map((id) => {
                    const f = facturas.find((x) => x.id === id);
                    if (!f) return null;
                    return (
                      <div key={id} style={{ marginBottom: 8 }}>
                        <p className="sub-label">
                          {f.cliente_nombre} · {f.folio} · saldo {"$"}{saldoDe(id).toLocaleString("es-MX")}
                        </p>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={importesComp[id] ?? ""}
                          onChange={(e) => setImportesComp((m) => ({ ...m, [id]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                  <p className="sub-label">Forma de pago</p>
                  <select value={formaPagoComp} onChange={(e) => setFormaPagoComp(e.target.value)}>
                    {FORMAS_PAGO_COMPLEMENTO.map((fp) => (
                      <option key={fp.clave} value={fp.clave}>
                        {fp.texto}
                      </option>
                    ))}
                  </select>
                  <p className="sub-label" style={{ marginTop: 8 }}>Fecha en que el cliente pagó</p>
                  <input type="date" max={hoyMexicoISO()} value={fechaPagoComp} onChange={(e) => setFechaPagoComp(e.target.value)} />
                  <p className="sub-label" style={{ marginTop: 8 }}>Número de operación o referencia (opcional)</p>
                  <input maxLength={100} value={numeroOpComp} onChange={(e) => setNumeroOpComp(e.target.value)} placeholder="Referencia de la transferencia, folio del voucher..." />
                  <p className="sub-label" style={{ marginTop: 8 }}>Notas internas (opcional)</p>
                  <textarea maxLength={500} rows={2} value={notasComp} onChange={(e) => setNotasComp(e.target.value)} placeholder="No aparecen en el CFDI" />
                  <p className="sub-label" style={{ marginTop: 8 }}>Comprobante de pago (opcional, PDF o imagen)</p>
                  <input type="file" accept="application/pdf,image/*" onChange={(e) => setComprobanteComp(e.target.files?.[0] || null)} />
                  {errorComp && <p style={{ fontSize: 12, color: "#A32D2D", marginTop: 8 }}>{errorComp}</p>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 700 }} disabled={emitiendoComp} onClick={emitirComplemento}>
                      {emitiendoComp ? "Emitiendo..." : "Emitir complemento"}
                    </button>
                    <button className="tel-borrar-btn" disabled={emitiendoComp} onClick={() => setModalComplemento(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {pdfVisor && (
              <div
                className="no-imprimir"
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
                onClick={() => setPdfVisor(null)}
              >
                <div className="form-card fac-previa-doc" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" onClick={() => setPdfVisor(null)}>
                    ×
                  </button>
                  <h2 className="fac-facturar-titulo">Factura {pdfVisor.titulo}</h2>
                  <iframe className="fac-previa-pdf" src={pdfVisor.url} title={"Factura " + pdfVisor.titulo} />
                  <div className="fac-facturar-botones">
                    <a className="btn-exportar fac-naranja" href={pdfVisor.descarga}>
                      Descargar PDF
                    </a>
                    <button type="button" className="ft-btn-sec" onClick={() => setPdfVisor(null)}>
                      Cerrar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loteFacturar && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
                onClick={() => !facturando && setLoteFacturar(null)}
              >
                <div className="form-card fac-facturar" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={facturando} onClick={() => setLoteFacturar(null)}>
                    ×
                  </button>
                  <h2 className="fac-facturar-titulo">Facturar</h2>
                  <p className="fac-facturar-sub">Se generan {loteFacturar.length} facturas, una por estado de cuenta</p>
                  <div className="fac-facturar-fila">
                    <label>
                      Cond. pago <span style={{ color: "#A32D2D" }}>*</span>
                    </label>
                    <div>
                      <input type="text" maxLength={100} value={condLote} onChange={(e) => setCondLote(e.target.value)} />
                    </div>
                  </div>
                  <div className="fac-facturar-fila">
                    <label>
                      Método de pago <span style={{ color: "#A32D2D" }}>*</span>
                    </label>
                    <div>
                      <select value={metodoLote} onChange={(e) => setMetodoLote(e.target.value as "PPD" | "PUE")}>
                        <option value="PUE">Pago en una sola exhibición</option>
                        <option value="PPD">Pago en parcialidades o diferido</option>
                      </select>
                    </div>
                  </div>
                  <div className="fac-facturar-fila">
                    <label>
                      Forma de pago <span style={{ color: "#A32D2D" }}>*</span>
                    </label>
                    <div>
                      {metodoLote === "PPD" ? (
                        <select value="99" disabled>
                          <option value="99">Por definir</option>
                        </select>
                      ) : (
                        <select value={formaLote} onChange={(e) => setFormaLote(e.target.value)}>
                          {FORMAS_PAGO_SAT.map((fp) => (
                            <option key={fp.clave} value={fp.clave}>
                              {fp.texto}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <p className="fac-facturar-nota">Para revisar la vista previa, agregar CFDI relacionado o número de cuenta, factura cada estado de cuenta por separado.</p>
                  <div className="fac-facturar-botones">
                    <button type="button" className="btn-exportar fac-naranja" disabled={facturando || !condLote.trim()} onClick={() => facturarCobros(loteFacturar)}>
                      {facturando ? "Timbrando..." : `Timbrar ${loteFacturar.length}`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {modalCancelar && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
                onClick={() => !cancelando && setModalCancelar(null)}
              >
                <div className="form-card" style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                  <p className="contrato-cliente-nombre">Cancelar {tipoCancelar === "complemento" ? "complemento de pago" : modalCancelar.length === 1 ? "factura" : modalCancelar.length + " facturas"} ante el SAT</p>
                  <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 10px" }}>
                    Esta acción no se puede deshacer. Si el cliente tiene que aceptarla, quedará "en proceso" hasta que responda.
                  </p>
                  <p className="sub-label">Motivo</p>
                  <select value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)}>
                    {MOTIVOS_CANCELACION.filter((m) => m.clave !== "01" || modalCancelar.length === 1).map((m) => (
                      <option key={m.clave} value={m.clave}>
                        {m.texto}
                      </option>
                    ))}
                  </select>
                  {motivoCancelar === "01" && (
                    <>
                      <p className="sub-label" style={{ marginTop: 8 }}>Folio de sustitución</p>
                      <input
                        placeholder="Folio de la factura que la sustituye (ej. A-9779)"
                        value={sustitutaUuid}
                        onChange={(e) => setSustitutaUuid(e.target.value)}
                      />
                    </>
                  )}
                  {errorCancelar && <p style={{ fontSize: 12, color: "#A32D2D", marginTop: 8 }}>{errorCancelar}</p>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="tel-borrar-btn" style={{ color: "#A32D2D", fontWeight: 700 }} disabled={cancelando} onClick={confirmarCancelar}>
                      {cancelando ? "Cancelando..." : "Sí, cancelar"}
                    </button>
                    <button className="tel-borrar-btn" disabled={cancelando} onClick={() => setModalCancelar(null)}>
                      No, volver
                    </button>
                  </div>
                </div>
              </div>
            )}

            {modo !== "timbradas" && (
            <>
            {facturas.length === 0 ? (
              <div className="empty-card">Sin facturas registradas en {centro}</div>
            ) : !hayFiltrosActivos && !verTodas ? (
              <div className="empty-card" style={{ padding: "28px 16px" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, color: "#0d1b3e" }}>Busca un cliente para ver sus facturas</p>
                <p style={{ margin: "0 0 12px", fontSize: 13 }}>Escribe su nombre, razón social, RFC o folio arriba, o elige al cliente en la lista.</p>
                <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => setVerTodas(true)}>
                  Ver todas las facturas de {centro} ({facturas.length})
                </button>
              </div>
            ) : (pestana === "timbradas" ? filasTimbradas.length === 0 : facturasFiltradas.length === 0) ? (
              <div className="empty-card">{pestana === "timbradas" ? "Ninguna factura timbrada coincide con los filtros" : "Nada por timbrar con estos filtros"}</div>
            ) : (
              <>
                {verTodas && !hayFiltrosActivos && (
                  <p style={{ margin: "8px 0 0" }}>
                    <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600, padding: 0 }} onClick={() => setVerTodas(false)}>
                      ← Ocultar la lista
                    </button>
                  </p>
                )}
                {resumenCliente && (
                  <div className="form-card fac-resumen">
                    <div className="fac-resumen-quien">
                      <p className="contrato-cliente-nombre">{resumenCliente.nombre}</p>
                      <p className="contrato-detalle">
                        {resumenCliente.email}
                        {resumenCliente.rfc ? " · RFC " + resumenCliente.rfc : ""}
                      </p>
                      <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600, padding: 0 }} href={"/facturas-admin/por-cliente?cliente=" + resumenCliente.id}>
                        Ver su historial por mes →
                      </a>
                    </div>
                    <div className="fac-resumen-cifras">
                      <div>
                        <span>Facturas</span>
                        <b>{resumenCliente.vigentes}</b>
                      </div>
                      <div>
                        <span>Facturado</span>
                        <b>{dinero(resumenCliente.facturado)}</b>
                      </div>
                      <div>
                        <span>Pagado</span>
                        <b style={{ color: "#0F6E56" }}>{dinero(resumenCliente.pagado)}</b>
                      </div>
                      <div>
                        <span>Por cobrar</span>
                        <b style={{ color: resumenCliente.porCobrar > 0 ? "#854F0B" : undefined }}>{dinero(resumenCliente.porCobrar)}</b>
                      </div>
                    </div>
                    {resumenCliente.canceladas > 0 && (
                      <p className="contrato-detalle" style={{ gridColumn: "1 / -1", fontSize: 12, color: "#888" }}>
                        {resumenCliente.canceladas} factura(s) cancelada(s) no suman en estos totales.
                      </p>
                    )}
                  </div>
                )}

                <div className="fac-tabla-wrap">
                  <table className="fac-tabla">
                    <thead>
                      <tr>
                        <th aria-label="Seleccionar"></th>
                        <th>Folio</th>
                        <th>Cliente</th>
                        <th>Concepto</th>
                        <th>Emisión</th>
                        <th>Vence</th>
                        <th className="fac-num">Monto</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturasFiltradas.map((f) => {
                        const badge = ESTATUS_LABEL[f.estado] || { label: f.estado, bg: "#F0F0F0", color: "#555" };
                        const sueltosDelCliente = f.user_id ? pagosSueltosDelCliente(f.user_id) : [];
                        const seleccionable = puedoCancelar && (sePuedeCancelar(f) || sePuedeFacturar(f) || sePuedeComplementar(f));
                        const abierta = facturaExpandidaId === f.id;
                        return (
                          <Fragment key={f.id}>
                            <tr className={f.cancelacion_estatus === "cancelada" ? "fac-fila-cancelada" : undefined}>
                              <td className="fac-col-sel">
                                {seleccionable && (
                                  <input
                                    type="checkbox"
                                    aria-label="Seleccionar"
                                    checked={seleccion.includes(f.id)}
                                    onChange={(e) => setSeleccion((s) => (e.target.checked ? [...s, f.id] : s.filter((i) => i !== f.id)))}
                                  />
                                )}
                              </td>
                              <td className="fac-nowrap">
                                <a href={"/facturas-admin/estados-de-cuenta/" + f.id} style={{ color: "#0d1b3e", textDecoration: "underline" }}>
                                  <b>{f.folio}</b>
                                </a>
                                {f.uuid_cfdi && (
                                  <span className="fac-sub" title={f.uuid_cfdi}>
                                    CFDI{f.metodo_pago ? " " + f.metodo_pago : ""} · {f.serie ? f.serie + (f.folio_fiscal || "") : f.uuid_cfdi.slice(0, 8) + "…"}
                                  </span>
                                )}
                              </td>
                              <td>
                                <b>{f.cliente_fiscal || f.cliente_nombre}</b>
                                {f.cliente_fiscal && f.cliente_fiscal !== f.cliente_nombre && <span className="fac-sub">{f.cliente_nombre}</span>}
                                {f.rfc_receptor && <span className="fac-sub">{f.rfc_receptor}</span>}
                                {!f.user_id && f.rfc_receptor !== "XAXX010101000" && (
                                  <select defaultValue="" disabled={asignando === f.id} onChange={(e) => asignarCliente(f.id, e.target.value)} style={{ marginTop: 4 }}>
                                    <option value="">Asignar cliente...</option>
                                    {clientes.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.nombre} — {c.email}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td>{f.concepto}</td>
                              <td className="fac-nowrap">{f.fecha_emision}</td>
                              <td className="fac-nowrap">{f.fecha_vencimiento}</td>
                              <td className="fac-num fac-nowrap">{dinero(Number(f.monto))}</td>
                              <td>
                                <span className="factura-badge" style={{ background: badge.bg }}>
                                  <span className="factura-badge-text" style={{ color: badge.color }}>
                                    {badge.label}
                                  </span>
                                </span>
                                {f.cancelacion_estatus && CANCELACION_LABEL[f.cancelacion_estatus] && (
                                  <span className="fac-sub" style={{ color: CANCELACION_LABEL[f.cancelacion_estatus].color, fontWeight: 600 }}>
                                    {CANCELACION_LABEL[f.cancelacion_estatus].label}
                                    {f.cancelacion_motivo ? " · motivo " + f.cancelacion_motivo : ""}
                                  </span>
                                )}
                                {f.metodo_pago === "PPD" && f.uuid_cfdi && f.cancelacion_estatus !== "cancelada" && (
                                  <span className="fac-sub" style={{ fontWeight: 600, color: saldoDe(f.id) > 0 ? "#854F0B" : "#0F6E56" }}>
                                    {saldoDe(f.id) > 0 ? "Saldo sin complemento: " + dinero(saldoDe(f.id)) : "✓ Cubierta por complementos"}
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className="fac-acciones">
                                  {f.archivo_url && (
                                    <BotonArchivo url={f.archivo_url} bucket="facturas">
                                      Ver PDF
                                    </BotonArchivo>
                                  )}
                                  <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => toggleFactura(f)}>
                                    {abierta ? "Ocultar pagos" : "Pagos"}
                                  </button>
                                  {puedoCancelar && sePuedeComplementar(f) && (
                                    <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} onClick={() => abrirComplemento([f.id])}>
                                      Complemento
                                    </button>
                                  )}
                                  {puedoCancelar && sePuedeFacturar(f) && (
                                    <a className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} href={"/facturas-admin/estados-de-cuenta/" + f.id + "?facturar=1"}>
                                      Facturar (CFDI)
                                    </a>
                                  )}
                                  {puedoCancelar && sePuedeCancelar(f) && (
                                    <button className="tel-borrar-btn" style={{ color: "#A32D2D", fontWeight: 600 }} onClick={() => abrirCancelar([f.id])}>
                                      Cancelar
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {abierta && (
                              <tr className="fac-fila-detalle">
                                <td></td>
                                <td colSpan={8}>
                                  {cargandoPagos ? (
                                    <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Cargando pagos...</p>
                                  ) : pagosDeFactura.length === 0 ? (
                                    <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>Sin pagos vinculados todavía.</p>
                                  ) : (
                                    pagosDeFactura.map((p) => (
                                      <p className="contrato-detalle" key={p.id}>
                                        {p.concepto || "Pago"} · {dinero(Number(p.monto))} · {p.estado}
                                      </p>
                                    ))
                                  )}

                                  {sueltosDelCliente.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                      <p className="sub-label">Vincular pago suelto de este cliente</p>
                                      {sueltosDelCliente.map((p) => (
                                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", maxWidth: 520 }}>
                                          <span style={{ fontSize: 12, color: "#555" }}>
                                            {p.concepto || "Pago"} · {dinero(Number(p.monto))} · {p.estado}
                                          </span>
                                          <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} disabled={vinculando === p.id} onClick={() => vincularPago(p.id, f.id)}>
                                            Vincular
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            </>
            )}

            {modo === "timbradas" && (
              <div className="ft-card ft-resultados">
                <div className="ft-res-cab">
                  <div className="ft-cab-titulo">
                    <span className="ft-cab-icono">
                      <IconoDocumento />
                    </span>
                    <p className="ft-titulo" style={{ margin: 0 }}>
                      Resultados
                    </p>
                    {(hayFiltrosActivos || verTodas) && <span className="ft-badge">Total de facturas: {filasT.length}</span>}
                  </div>
                  <div className="ft-res-botones no-imprimir">
                    {puedoCancelar && hayEnProceso && (
                      <button type="button" className="ft-btn-sec" disabled={actualizandoEstatus} onClick={() => actualizarEstatusCancelaciones()}>
                        {actualizandoEstatus ? "Consultando..." : "Actualizar estatus"}
                      </button>
                    )}
                    {puedoCancelar && seleccionComplementables.length > 0 && (
                      <button type="button" className="ft-btn-sec" onClick={() => abrirComplemento(seleccionComplementables)}>
                        Emitir complemento de pago ({seleccionComplementables.length})
                      </button>
                    )}
                    {puedoCancelar && seleccionCancelables.length > 0 && (
                      <button type="button" className="ft-btn-sec" style={{ color: "#A32D2D" }} onClick={() => abrirCancelar(seleccionCancelables)}>
                        Cancelar seleccionadas ({seleccionCancelables.length})
                      </button>
                    )}
                    {puedoCancelar && compSel && (
                      <button type="button" className="ft-btn-sec" style={{ color: "#A32D2D" }} onClick={() => abrirCancelarComplemento(compSel)}>
                        Cancelar complemento
                      </button>
                    )}
                    <button type="button" className="ft-btn-sec" disabled={filasT.length === 0} onClick={exportarTimbradasExcel}>
                      <IconoExcel /> Exportar Excel
                    </button>
                    <button type="button" className="ft-btn-sec" disabled={filasT.length === 0 || generandoPdf} onClick={descargarTimbradasPdf}>
                      <IconoPdf /> {generandoPdf ? "Generando..." : "Descargar PDF"}
                    </button>
                    <button type="button" className="ft-btn-sec" disabled={filasT.length === 0} onClick={imprimirTimbradas}>
                      <IconoImprimir /> Imprimir
                    </button>
                  </div>
                </div>

                {facturas.length === 0 && complementos.length === 0 ? (
                  <div className="ft-vacio">Sin facturas timbradas en {centro}</div>
                ) : !hayFiltrosActivos && !verTodas ? (
                  <div className="ft-vacio">
                    <p style={{ margin: "0 0 4px", fontWeight: 600, color: "#0d1b3e" }}>Elige los filtros y pulsa Buscar</p>
                    <p style={{ margin: 0, fontSize: 13 }}>O pulsa Buscar sin filtros para ver todas las de {centro}.</p>
                  </div>
                ) : filasT.length === 0 ? (
                  <div className="ft-vacio">Ninguna factura timbrada coincide con los filtros</div>
                ) : (
                  <>
                    <div className={"ft-tabla-wrap" + (generandoPdf ? " ft-exportando" : "")} ref={tablaTimbradasRef}>
                      {generandoPdf && <p className="ft-titulo-pdf">Facturas timbradas · {centro} · {filasT.length} factura(s)</p>}
                      <table className="ft-tabla">
                        <thead>
                          <tr>
                            <th className="ft-col-sel no-imprimir">
                              <input
                                type="checkbox"
                                aria-label="Elegir todas las de esta página"
                                checked={idsPaginaSeleccionables.length > 0 && idsPaginaSeleccionables.every((id) => seleccion.includes(id))}
                                onChange={(e) =>
                                  setSeleccion((s) => (e.target.checked ? Array.from(new Set([...s, ...idsPaginaSeleccionables])) : s.filter((id) => !idsPaginaSeleccionables.includes(id))))
                                }
                              />
                            </th>
                            {COLUMNAS_TIMBRADAS.map((c) => (
                              <th key={c.clave} className={c.clave === "total" ? "ft-num" : undefined}>
                                <button type="button" className="ft-orden" onClick={() => ordenarPor(c.clave)}>
                                  {c.titulo}
                                  <span className="ft-orden-flecha">{orden.col === c.clave ? (orden.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
                                </button>
                              </th>
                            ))}
                            <th className="no-imprimir" style={{ textAlign: "center" }}>
                              Acciones
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filasVisibles.map((d) => (
                            <tr key={d.key}>
                              <td className="ft-col-sel no-imprimir">
                                {d.facturaId ? (
                                  d.seleccionable && (
                                    <input
                                      type="checkbox"
                                      aria-label="Elegir"
                                      checked={seleccion.includes(d.facturaId)}
                                      onChange={(e) => setSeleccion((s) => (e.target.checked ? [...s, d.facturaId!] : s.filter((i) => i !== d.facturaId)))}
                                    />
                                  )
                                ) : (
                                  d.complementoId &&
                                  d.situacion.tipo !== "roja" && (
                                    <input type="checkbox" aria-label="Elegir complemento" checked={compSel === d.complementoId} onChange={(e) => setCompSel(e.target.checked ? d.complementoId! : null)} />
                                  )
                                )}
                              </td>
                              <td className="ft-nowrap">
                                {d.ver ? (
                                  <a href={d.ver} title="Abrir su estado de cuenta" style={{ color: "#0d1b3e", textDecoration: "underline" }}>
                                    <b>{d.serieFolio}</b>
                                  </a>
                                ) : (
                                  <b>{d.serieFolio}</b>
                                )}
                              </td>
                              <td>{d.cliente}</td>
                              <td className="ft-nowrap">{d.rfc || "—"}</td>
                              <td>{d.concepto}</td>
                              <td className="ft-nowrap">{fechaCorta(d.fecha)}</td>
                              <td>
                                <span className={"ft-chip ft-chip-" + d.situacion.tipo}>{d.situacion.texto}</span>
                              </td>
                              <td className="ft-nowrap">
                                <span className="ft-fuente">
                                  {d.fuente.icono === "enlace" ? <IconoEnlace /> : <IconoArchivo />}
                                  {d.fuente.texto}
                                </span>
                              </td>
                              <td className="ft-num ft-nowrap">{dinero(d.total)}</td>
                              <td className="no-imprimir">
                                <div className="ft-iconos">
                                  {d.pdf ? (
                                    <button type="button" className="ft-icono-btn" title="Vista previa del PDF" aria-label="Vista previa del PDF" onClick={() => setPdfVisor({ url: d.pdf + "&ver=1", descarga: d.pdf!, titulo: d.serieFolio })}>
                                      <IconoOjo />
                                    </button>
                                  ) : (
                                    <span className="ft-icono-off" title={d.simulada ? "Factura simulada: sin PDF del SAT" : "Sin PDF"}>
                                      <IconoOjo />
                                    </span>
                                  )}
                                  {d.pdf ? (
                                    <a href={d.pdf} title="Descargar PDF" aria-label="Descargar PDF">
                                      <IconoDescargar />
                                    </a>
                                  ) : (
                                    <span className="ft-icono-off" title={d.simulada ? "Factura simulada: sin PDF del SAT" : "Sin PDF"}>
                                      <IconoDescargar />
                                    </span>
                                  )}
                                  {d.xml ? (
                                    <a href={d.xml} title="Descargar XML" aria-label="Descargar XML">
                                      <IconoArchivo />
                                    </a>
                                  ) : (
                                    <span className="ft-icono-off" title={d.simulada ? "Factura simulada: sin XML del SAT" : "Sin XML"}>
                                      <IconoArchivo />
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="ft-paginacion no-imprimir">
                      <span>
                        Mostrando {(paginaActual - 1) * POR_PAGINA + 1} - {Math.min(paginaActual * POR_PAGINA, filasT.length)} de {filasT.length} registros
                      </span>
                      <div className="ft-paginas">
                        <button type="button" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)} aria-label="Página anterior">
                          ‹
                        </button>
                        {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                          .filter((n) => n === 1 || n === totalPaginas || Math.abs(n - paginaActual) <= 2)
                          .map((n) => (
                            <button type="button" key={n} className={n === paginaActual ? "activa" : ""} onClick={() => setPagina(n)}>
                              {n}
                            </button>
                          ))}
                        <button type="button" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(paginaActual + 1)} aria-label="Página siguiente">
                          ›
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
}
