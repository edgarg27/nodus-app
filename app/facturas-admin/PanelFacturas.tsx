"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BotonArchivo from "@/app/components/BotonArchivo";
import { exportarExcel } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";

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
  { clave: "02", texto: "02 · Comprobante emitido con errores sin relación" },
  { clave: "01", texto: "01 · Comprobante emitido con errores con relación (lleva factura sustituta)" },
  { clave: "03", texto: "03 · No se llevó a cabo la operación" },
  { clave: "04", texto: "04 · Operación nominativa en una factura global" },
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
function sePuedeFacturar(f: { user_id?: string | null; uuid_cfdi?: string | null; estado: string }) {
  return !!f.user_id && !f.uuid_cfdi && f.estado !== "pagada" && f.estado !== "cancelada";
}

type Cliente = { id: string; nombre: string; email: string; empresa: string | null; nombre_fiscal?: string | null };

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
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    const { data: clis } = await supabase
      .from("profiles")
      .select("id, nombre, email, empresa, nombre_fiscal")
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
      if (filtroFuente && (f.fuente || "manual") !== filtroFuente) return false;
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
      if (filtroEstado || filtroFuente || soloSinCliente) return false;
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
  async function facturarCobros(ids: string[]) {
    if (ids.length === 0) return;
    const aviso =
      ids.length === 1
        ? "¿Emitir la factura (CFDI) de este cobro? Se timbra ante el SAT a pago diferido (PPD); cuando el cliente pague habrá que emitir su complemento de pago."
        : `¿Emitir las ${ids.length} facturas (CFDI) seleccionadas? Se timbran ante el SAT a pago diferido (PPD); cuando los clientes paguen habrá que emitir sus complementos de pago.`;
    if (!confirm(aviso)) return;
    setFacturando(true);
    const res = await fetch("/api/facturas/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaIds: ids }),
    });
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
          {modo === "timbradas" ? " · CFDI emitidos y complementos de pago" : " · lo integrado que falta por timbrar"}
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
                  <button className="btn-exportar" disabled={facturando} onClick={() => facturarCobros(seleccionFacturables)}>
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
                    <option value="cfdi_import">Importación CFDI</option>
                    <option value="facturapi_auto">Emitida con Facturapi</option>
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
                      <p className="sub-label" style={{ marginTop: 8 }}>UUID de la factura que la sustituye</p>
                      <input
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
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

                {pestana === "timbradas" ? (
                  <div className="fac-tabla-wrap">
                    <table className="fac-tabla">
                      <thead>
                        <tr>
                          <th aria-label="Seleccionar"></th>
                          <th>Serie-Folio</th>
                          <th>Cliente</th>
                          <th>Concepto</th>
                          <th>Fecha</th>
                          <th className="fac-num">Subtotal</th>
                          <th className="fac-num">Total</th>
                          <th>Tipo</th>
                          <th>Estado</th>
                          <th>UUID</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasTimbradas.map((fila) => {
                          if (fila.tipo === "P") {
                            const c = fila.c;
                            const etiqueta = c.cancelacion_estatus ? CANCELACION_LABEL[c.cancelacion_estatus] : null;
                            const cubre = filasComplemento.filter((r) => r.complemento_id === c.id);
                            return (
                              <tr key={"c" + c.id} className={c.cancelacion_estatus === "cancelada" ? "fac-fila-cancelada" : undefined}>
                                <td></td>
                                <td className="fac-nowrap">
                                  <b>{c.serie ? c.serie + "-" + (c.folio_fiscal || "") : c.folio_fiscal || "—"}</b>
                                </td>
                                <td>
                                  <b>{c.cliente_fiscal || c.cliente_nombre}</b>
                                  {c.cliente_fiscal && c.cliente_fiscal !== c.cliente_nombre && <span className="fac-sub">{c.cliente_nombre}</span>}
                                </td>
                                <td>
                                  Complemento de pago · cubre {cubre.length} factura(s)
                                  {c.numero_operacion && <span className="fac-sub">Operación: {c.numero_operacion}</span>}
                                  {c.notas && <span className="fac-sub">Notas: {c.notas}</span>}
                                </td>
                                <td className="fac-nowrap">{c.fecha_pago}</td>
                                <td className="fac-num">—</td>
                                <td className="fac-num fac-nowrap">{dinero(Number(c.monto))}</td>
                                <td>
                                  Pago
                                  <span className="fac-sub">forma {c.forma_pago}</span>
                                </td>
                                <td>
                                  {etiqueta ? (
                                    <span className="fac-sub" style={{ color: etiqueta.color, fontWeight: 600, marginTop: 0 }}>
                                      {etiqueta.label}
                                    </span>
                                  ) : (
                                    <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                                      <span className="factura-badge-text" style={{ color: "#0F6E56" }}>
                                        Emitido
                                      </span>
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <span className="fac-sub" style={{ marginTop: 0 }} title={c.uuid_cfdi || ""}>
                                    {c.uuid_cfdi ? c.uuid_cfdi.slice(0, 8) + "…" : "—"}
                                  </span>
                                </td>
                                <td>
                                  <div className="fac-acciones">
                                    {c.archivo_url && (
                                      <a className="ver-pdf-btn" href={"/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=pdf"}>
                                        PDF
                                      </a>
                                    )}
                                    {c.xml_url && (
                                      <a className="ver-pdf-btn" href={"/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=xml"}>
                                        XML
                                      </a>
                                    )}
                                    {c.comprobante_url && (
                                      <BotonArchivo url={c.comprobante_url} bucket="facturas">
                                        Comprobante
                                      </BotonArchivo>
                                    )}
                                    {puedoCancelar && (!c.cancelacion_estatus || c.cancelacion_estatus === "rechazada") && (
                                      <button className="tel-borrar-btn" style={{ color: "#A32D2D", fontWeight: 600 }} onClick={() => abrirCancelarComplemento(c.id)}>
                                        Cancelar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          const f = fila.f;
                          const badge = ESTATUS_LABEL[f.estado] || { label: f.estado, bg: "#F0F0F0", color: "#555" };
                          const sueltosDelCliente = f.user_id ? pagosSueltosDelCliente(f.user_id) : [];
                          const seleccionable = puedoCancelar && (sePuedeCancelar(f) || sePuedeComplementar(f));
                          const abierta = facturaExpandidaId === f.id;
                          return (
                            <Fragment key={"f" + f.id}>
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
                                  <b>{f.serie ? f.serie + "-" + (f.folio_fiscal || "") : f.folio}</b>
                                  {f.serie && <span className="fac-sub">{f.folio}</span>}
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
                                <td className="fac-num fac-nowrap">{f.subtotal != null ? dinero(Number(f.subtotal)) : "—"}</td>
                                <td className="fac-num fac-nowrap">{dinero(Number(f.monto))}</td>
                                <td>
                                  Ingreso
                                  {f.metodo_pago && <span className="fac-sub">{f.metodo_pago}</span>}
                                </td>
                                <td>
                                  {f.cancelacion_estatus && CANCELACION_LABEL[f.cancelacion_estatus] ? (
                                    <span className="fac-sub" style={{ color: CANCELACION_LABEL[f.cancelacion_estatus].color, fontWeight: 600, marginTop: 0 }}>
                                      {CANCELACION_LABEL[f.cancelacion_estatus].label}
                                      {f.cancelacion_motivo ? " · motivo " + f.cancelacion_motivo : ""}
                                    </span>
                                  ) : (
                                    <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                                      <span className="factura-badge-text" style={{ color: "#0F6E56" }}>
                                        Emitida
                                      </span>
                                    </span>
                                  )}
                                  <span className="fac-sub">
                                    <span className="factura-badge" style={{ background: badge.bg }}>
                                      <span className="factura-badge-text" style={{ color: badge.color }}>
                                        {badge.label}
                                      </span>
                                    </span>
                                  </span>
                                  {f.metodo_pago === "PPD" && f.cancelacion_estatus !== "cancelada" && (
                                    <span className="fac-sub" style={{ fontWeight: 600, color: saldoDe(f.id) > 0 ? "#854F0B" : "#0F6E56" }}>
                                      {saldoDe(f.id) > 0 ? "Saldo sin complemento: " + dinero(saldoDe(f.id)) : "✓ Cubierta por complementos"}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <span className="fac-sub" style={{ marginTop: 0 }} title={f.uuid_cfdi || ""}>
                                    {f.uuid_cfdi ? f.uuid_cfdi.slice(0, 8) + "…" : "—"}
                                  </span>
                                </td>
                                <td>
                                  <div className="fac-acciones">
                                    {f.archivo_url && (
                                      <BotonArchivo url={f.archivo_url} bucket="facturas">
                                        PDF
                                      </BotonArchivo>
                                    )}
                                    {f.xml_url && (
                                      <a className="ver-pdf-btn" href={"/api/facturas/descargar?id=" + f.id + "&tipo=xml"}>
                                        XML
                                      </a>
                                    )}
                                    <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => toggleFactura(f)}>
                                      {abierta ? "Ocultar pagos" : "Pagos"}
                                    </button>
                                    {puedoCancelar && sePuedeComplementar(f) && (
                                      <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} onClick={() => abrirComplemento([f.id])}>
                                        Complemento
                                      </button>
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
                                  <td colSpan={10}>
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
                ) : (
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
                                <b>{f.folio}</b>
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
                                    <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} disabled={facturando} onClick={() => facturarCobros([f.id])}>
                                      Facturar (CFDI)
                                    </button>
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
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
