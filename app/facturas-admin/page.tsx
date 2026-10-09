"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BotonArchivo from "@/app/components/BotonArchivo";
import { exportarExcel } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { TIPOS_COBRO_ADICIONAL, tipoCobroAdicional } from "@/lib/adicionales";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  parcial: { label: "◐ Parcial", bg: "#E8EEF9", color: "#254B8C" },
  pagada: { label: "✓ Pagada", bg: "#E1F5EE", color: "#0F6E56" },
  vencida: { label: "⚠️ Vencida", bg: "#FCEBEB", color: "#A32D2D" },
};

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

type Cliente = { id: string; nombre: string; email: string; empresa: string | null };

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
  fuente?: string | null;
  uuid_cfdi?: string | null;
  cancelacion_estatus?: "en_proceso" | "cancelada" | "rechazada" | null;
  cancelacion_motivo?: string | null;
  metodo_pago?: string | null;
  rfc_receptor?: string | null;
  cliente_nombre?: string;
  cliente_email?: string;
};

type Complemento = {
  id: string;
  user_id: string | null;
  cliente_nombre?: string;
  serie: string | null;
  folio_fiscal: string | null;
  uuid_cfdi: string | null;
  forma_pago: string;
  fecha_pago: string;
  monto: number;
  archivo_url: string | null;
  xml_url: string | null;
  cancelacion_estatus: "en_proceso" | "cancelada" | "rechazada" | null;
};
type FilaComplemento = { complemento_id: string; factura_id: string; importe: number };

type Pago = { id: string; monto: number; concepto: string | null; estado: string; factura_id: string | null; created_at: string; adicional_tipo?: string | null };
type PagoSuelto = Pago & { user_id: string };

export default function FacturasAdminPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pagosSueltos, setPagosSueltos] = useState<PagoSuelto[]>([]);

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
      .select("id, nombre, email, empresa")
      .eq("rol", "cliente")
      .eq("centro", c)
      .order("nombre");
    setClientes(clis || []);

    const clienteIds = (clis || []).map((cl) => cl.id);
    const nombrePorId: Record<string, string> = {};
    const emailPorId: Record<string, string> = {};
    (clis || []).forEach((cl) => {
      nombrePorId[cl.id] = cl.nombre;
      emailPorId[cl.id] = cl.email;
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
        cliente_nombre: f.user_id ? nombrePorId[f.user_id] || "Cliente" : "Cliente no identificado",
        cliente_email: f.user_id ? emailPorId[f.user_id] || "" : "",
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
      .select("id, user_id, serie, folio_fiscal, uuid_cfdi, forma_pago, fecha_pago, monto, archivo_url, xml_url, cancelacion_estatus")
      .eq("centro", c)
      .order("created_at", { ascending: false })
      .limit(300);
    const compIds = (comps || []).map((x) => x.id);
    const { data: filasComp } = compIds.length
      ? await supabase.from("complemento_pago_facturas").select("complemento_id, factura_id, importe").in("complemento_id", compIds)
      : { data: [] as FilaComplemento[] };
    setComplementos(((comps as Complemento[]) || []).map((x) => ({ ...x, cliente_nombre: x.user_id ? nombrePorId[x.user_id] || "Cliente" : "Cliente" })));
    setFilasComplemento((filasComp as FilaComplemento[]) || []);
    setLoading(false);
  }

  // ---- Formulario Nueva factura ----
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    cliente_id: "",
    folio: "",
    concepto: "",
    monto: "",
    fecha_emision: new Date().toISOString().split("T")[0],
    fecha_vencimiento: "",
    estado: "pendiente",
    adicional_tipo: "",
  });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [pagosAVincular, setPagosAVincular] = useState<Set<string>>(new Set());

  function togglePagoAVincular(id: string) {
    setPagosAVincular((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function crearFactura(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.cliente_id || !form.concepto.trim() || !form.monto || !form.fecha_vencimiento) {
      setError("Completa cliente, concepto, monto y fecha de vencimiento");
      return;
    }
    if (!centro) return;
    setGuardando(true);

    let archivoUrl: string | null = null;
    if (archivo) {
      const fileName = `${form.cliente_id}-${Date.now()}.${archivo.name.split(".").pop() || "pdf"}`;
      const { error: uploadError } = await supabase.storage
        .from("facturas")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (uploadError) {
        setError("No se pudo subir el PDF: " + uploadError.message);
        setGuardando(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("facturas").getPublicUrl(fileName);
      archivoUrl = urlData.publicUrl;
    }

    const folio = form.folio.trim() || `FAC-MAN-${Date.now().toString().slice(-6)}`;

    const { data: nuevaFactura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        user_id: form.cliente_id,
        folio,
        concepto: form.concepto.trim(),
        monto: Number(form.monto),
        fecha_emision: form.fecha_emision,
        fecha_vencimiento: form.fecha_vencimiento,
        estado: form.estado,
        centro,
        archivo_url: archivoUrl,
        // Clave del SAT con la que se facturará (vacío = renta de espacio).
        ...(form.adicional_tipo ? { adicional_tipo: form.adicional_tipo } : {}),
      })
      .select("id")
      .single();

    if (insertError || !nuevaFactura) {
      setGuardando(false);
      setError("No se pudo guardar la factura. Intenta de nuevo.");
      return;
    }

    if (pagosAVincular.size > 0) {
      await fetch("/api/pagos/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoIds: Array.from(pagosAVincular), facturaId: nuevaFactura.id }),
      });
    }

    setGuardando(false);
    setForm({
      cliente_id: "",
      folio: "",
      concepto: "",
      monto: "",
      fecha_emision: new Date().toISOString().split("T")[0],
      fecha_vencimiento: "",
      estado: "pendiente",
      adicional_tipo: "",
    });
    setArchivo(null);
    setPagosAVincular(new Set());
    setMostrarForm(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTodo(centro);
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

  const hayFiltrosActivos =
    !!busqueda || !!filtroEstado || !!filtroFuente || !!filtroDesde || !!filtroHasta || soloSinCliente;

  function limpiarFiltros() {
    setBusqueda("");
    setFiltroEstado("");
    setFiltroFuente("");
    setFiltroDesde("");
    setFiltroHasta("");
    setSoloSinCliente(false);
  }

  const facturasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return facturas.filter((f) => {
      if (q) {
        const enTexto = [f.folio, f.concepto, f.uuid_cfdi, f.rfc_receptor, f.cliente_nombre, f.cliente_email]
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
      if (soloSinCliente && f.user_id) return false;
      return true;
    });
  }, [facturas, busqueda, filtroEstado, filtroFuente, filtroDesde, filtroHasta, soloSinCliente]);

  // ---- Complementos de pago (facturas a pago diferido) ----
  const [complementos, setComplementos] = useState<Complemento[]>([]);
  const [filasComplemento, setFilasComplemento] = useState<FilaComplemento[]>([]);
  const [tipoCancelar, setTipoCancelar] = useState<"factura" | "complemento">("factura");
  const [modalComplemento, setModalComplemento] = useState<{ userId: string; ids: string[] } | null>(null);
  const [formaPagoComp, setFormaPagoComp] = useState("03");
  const [fechaPagoComp, setFechaPagoComp] = useState("");
  const [importesComp, setImportesComp] = useState<Record<string, string>>({});
  const [emitiendoComp, setEmitiendoComp] = useState(false);
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
    const res = await fetch("/api/complementos/emitir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: modalComplemento.userId, items, formaPago: formaPagoComp, fecha: fechaPagoComp }),
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

  // Cobros sueltos pendientes (adicionales, depósitos…): se les crea su cobro con factura y se timbra.
  const [seleccionPagos, setSeleccionPagos] = useState<string[]>([]);
  async function facturarPagosSueltos(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm("¿Emitir la factura (CFDI) de " + (ids.length === 1 ? "este cobro" : ids.length + " cobros") + "? Se timbra a pago diferido (PPD); al pagarse se emite su complemento de pago.")) return;
    setFacturando(true);
    const res = await fetch("/api/facturas/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoIds: ids }),
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
    setSeleccionPagos((s) => s.filter((i) => !resultados.some((r) => r.id === i && r.ok)));
    setAvisoCancelar(
      (hechas > 0 ? "✓ " + hechas + " factura(s) emitida(s). " : "") +
        (fallidas.length > 0 ? "✗ " + fallidas.length + " no se pudo(ieron): " + fallidas.slice(0, 3).map((r) => (r.folio || "") + " — " + r.error).join(" · ") : "")
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

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Facturas</p>
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

      <div className="rep-content">
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
                🧾 Facturas ({hayFiltrosActivos ? `${facturasFiltradas.length} de ${facturas.length}` : facturas.length})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {puedoCancelar && hayEnProceso && (
                  <button className="btn-exportar" disabled={actualizandoEstatus} onClick={() => actualizarEstatusCancelaciones()}>
                    {actualizandoEstatus ? "Consultando..." : "🔄 Actualizar estatus"}
                  </button>
                )}
                {puedoCancelar && seleccionFacturables.length > 0 && (
                  <button className="btn-exportar" disabled={facturando} onClick={() => facturarCobros(seleccionFacturables)}>
                    {facturando ? "Facturando..." : `🧾 Facturar seleccionados (${seleccionFacturables.length})`}
                  </button>
                )}
                {puedoCancelar && seleccionComplementables.length > 0 && (
                  <button className="btn-exportar" onClick={() => abrirComplemento(seleccionComplementables)}>
                    💵 Emitir complemento de pago ({seleccionComplementables.length})
                  </button>
                )}
                {puedoCancelar && seleccionCancelables.length > 0 && (
                  <button className="btn-exportar" style={{ color: "#A32D2D" }} onClick={() => abrirCancelar(seleccionCancelables)}>
                    ✕ Cancelar seleccionadas ({seleccionCancelables.length})
                  </button>
                )}
                <a className="btn-exportar" href="/facturas-admin/por-cliente">
                  👤 Por cliente
                </a>
                <a className="btn-exportar" href="/facturas-admin/importar">
                  📄 Importar CFDI
                </a>
                <button
                  className="btn-exportar"
                  onClick={() =>
                    exportarExcel(
                      `facturas-${centro}`,
                      facturasFiltradas.map((f) => ({
                        Cliente: f.cliente_nombre || "",
                        Correo: f.cliente_email || "",
                        Folio: f.folio,
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
                  📥 Excel
                </button>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarForm((v) => !v)}
                >
                  {mostrarForm ? "Cancelar" : "+ Nueva factura"}
                </button>
              </div>
            </div>

            <div className="form-card" style={{ marginTop: 8 }}>
              <div className="tel-form-grid">
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

            {mostrarForm && (
              <form className="form-card" onSubmit={crearFactura}>
                <p className="sub-label">Cliente</p>
                <select
                  value={form.cliente_id}
                  onChange={(e) => {
                    setForm({ ...form, cliente_id: e.target.value });
                    setPagosAVincular(new Set());
                  }}
                >
                  <option value="">Selecciona un cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.empresa ? `(${c.empresa})` : ""} — {c.email}
                    </option>
                  ))}
                </select>

                {form.cliente_id && pagosSueltosDelCliente(form.cliente_id).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <p className="sub-label">Vincular pagos sueltos de este cliente (opcional)</p>
                    {pagosSueltosDelCliente(form.cliente_id).map((p) => (
                      <label
                        key={p.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, color: "#333" }}
                      >
                        <input
                          type="checkbox"
                          checked={pagosAVincular.has(p.id)}
                          onChange={() => togglePagoAVincular(p.id)}
                        />
                        {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                      </label>
                    ))}
                  </div>
                )}

                <div className="tel-form-grid">
                  <div>
                    <p className="sub-label">Folio (opcional, se autogenera)</p>
                    <input value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} />
                  </div>
                  <div>
                    <p className="sub-label">Monto</p>
                    <input
                      type="number"
                      step="0.01"
                      value={form.monto}
                      onChange={(e) => setForm({ ...form, monto: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Fecha de emisión</p>
                    <input
                      type="date"
                      value={form.fecha_emision}
                      onChange={(e) => setForm({ ...form, fecha_emision: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Fecha de vencimiento</p>
                    <input
                      type="date"
                      value={form.fecha_vencimiento}
                      onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                    />
                  </div>
                </div>

                <p className="sub-label">Concepto</p>
                <input value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} />

                <p className="sub-label">Tipo de servicio (clave del SAT para facturar)</p>
                <select value={form.adicional_tipo} onChange={(e) => setForm({ ...form, adicional_tipo: e.target.value })}>
                  <option value="">Renta de espacio (por omisión)</option>
                  {TIPOS_COBRO_ADICIONAL.map((t) => (
                    <option key={t.clave} value={t.clave}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>

                <p className="sub-label">Subir factura (PDF, opcional)</p>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />

                {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

                <button
                  className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
                  type="submit"
                  disabled={guardando}
                >
                  <span className="btn-enviar-icon-wrapper">
                    <svg
                      className="btn-enviar-icon"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path fill="none" d="M0 0h24v24H0z"></path>
                      <path
                        fill="currentColor"
                        d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                      ></path>
                    </svg>
                  </span>
                  <span className="btn-enviar-check-wrapper">
                    <svg
                      className="btn-enviar-check"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>¡Listo!</span>
                  </span>
                  <span className="btn-enviar-text">+ Guardar factura</span>
                </button>
              </form>
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

            {puedoCancelar && pagosSueltos.some((p) => p.estado === "pendiente") && (
              <details className="form-card" style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  Cobros sueltos por facturar ({pagosSueltos.filter((p) => p.estado === "pendiente").length})
                </summary>
                <p style={{ fontSize: 12, color: "#666", margin: "6px 0" }}>
                  Adicionales, depósitos y demás cobros pendientes que todavía no tienen factura. Se pueden facturar antes de que se paguen.
                </p>
                {seleccionPagos.length > 0 && (
                  <button className="btn-exportar" disabled={facturando} onClick={() => facturarPagosSueltos(seleccionPagos)}>
                    {facturando ? "Facturando..." : "🧾 Facturar seleccionados (" + seleccionPagos.length + ")"}
                  </button>
                )}
                {pagosSueltos
                  .filter((p) => p.estado === "pendiente")
                  .map((p) => {
                    const cli = clientes.find((c) => c.id === p.user_id);
                    const tipo = tipoCobroAdicional(p.adicional_tipo);
                    return (
                      <div key={p.id} style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar cobro"
                          checked={seleccionPagos.includes(p.id)}
                          onChange={(e) => setSeleccionPagos((s) => (e.target.checked ? [...s, p.id] : s.filter((i) => i !== p.id)))}
                        />
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <p className="contrato-detalle">
                            <strong>{cli?.nombre || "Cliente"}</strong> · {p.concepto || "Cobro"}
                          </p>
                          <p className="contrato-detalle" style={{ fontSize: 12, color: "#666" }}>
                            {"$"}{Number(p.monto).toLocaleString("es-MX")}
                            {tipo ? " · " + tipo.etiqueta : ""}
                          </p>
                        </div>
                        <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} disabled={facturando} onClick={() => facturarPagosSueltos([p.id])}>
                          🧾 Facturar (CFDI)
                        </button>
                      </div>
                    );
                  })}
              </details>
            )}

            {complementos.length > 0 && (
              <details className="form-card" style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Complementos de pago emitidos ({complementos.length})</summary>
                {complementos.map((c) => {
                  const cubre = filasComplemento.filter((r) => r.complemento_id === c.id);
                  const etiqueta = c.cancelacion_estatus ? CANCELACION_LABEL[c.cancelacion_estatus] : null;
                  return (
                    <div key={c.id} style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8 }}>
                      <p className="contrato-detalle">
                        <strong>{c.cliente_nombre}</strong> · {c.serie || ""}
                        {c.folio_fiscal || ""} · {c.fecha_pago} · {"$"}{Number(c.monto).toLocaleString("es-MX")} · forma {c.forma_pago}
                      </p>
                      <p className="contrato-detalle" style={{ fontSize: 11, color: "#888" }}>
                        Cubre {cubre.length} factura(s) · {c.uuid_cfdi}
                      </p>
                      {etiqueta && (
                        <p className="contrato-detalle" style={{ display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 8, background: etiqueta.bg, color: etiqueta.color }}>
                          {etiqueta.label}
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {c.archivo_url && (
                          <a className="ver-pdf-btn" href={"/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=pdf"}>
                            ⬇ PDF
                          </a>
                        )}
                        {c.xml_url && (
                          <a className="ver-pdf-btn" href={"/api/facturas/descargar?origen=complemento&id=" + c.id + "&tipo=xml"}>
                            ⬇ XML
                          </a>
                        )}
                        {puedoCancelar && (!c.cancelacion_estatus || c.cancelacion_estatus === "rechazada") && (
                          <button className="tel-borrar-btn" style={{ color: "#A32D2D", fontWeight: 600 }} onClick={() => abrirCancelarComplemento(c.id)}>
                            ✕ Cancelar complemento
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </details>
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
            ) : facturasFiltradas.length === 0 ? (
              <div className="empty-card">Ninguna factura coincide con los filtros</div>
            ) : (
              facturasFiltradas.map((f) => {
                const badge = ESTATUS_LABEL[f.estado] || { label: f.estado, bg: "#F0F0F0", color: "#555" };
                const sueltosDelCliente = f.user_id ? pagosSueltosDelCliente(f.user_id) : [];
                return (
                  <div className="contrato-card-admin" key={f.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {f.cliente_nombre} · {f.folio}
                        </p>
                        <p className="contrato-detalle">{f.cliente_email}</p>
                        <p className="contrato-detalle">{f.concepto}</p>
                        <p className="contrato-detalle">
                          ${Number(f.monto).toLocaleString("es-MX")} · vence {f.fecha_vencimiento}
                        </p>
                        {f.uuid_cfdi && (
                          <p className="contrato-detalle" style={{ fontSize: 11, color: "#888" }}>
                            🧾 CFDI{f.metodo_pago ? " " + f.metodo_pago : ""} · {f.rfc_receptor} · {f.uuid_cfdi}
                          </p>
                        )}
                        {f.metodo_pago === "PPD" && f.uuid_cfdi && f.cancelacion_estatus !== "cancelada" && (
                          <p className="contrato-detalle" style={{ fontSize: 12, fontWeight: 600, color: saldoDe(f.id) > 0 ? "#854F0B" : "#0F6E56" }}>
                            {saldoDe(f.id) > 0
                              ? "Saldo sin complemento: $" + saldoDe(f.id).toLocaleString("es-MX") + " de $" + Number(f.monto).toLocaleString("es-MX")
                              : "✓ Cubierta por complementos de pago"}
                          </p>
                        )}
                        {f.cancelacion_estatus && CANCELACION_LABEL[f.cancelacion_estatus] && (
                          <p
                            className="contrato-detalle"
                            style={{ display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 8, background: CANCELACION_LABEL[f.cancelacion_estatus].bg, color: CANCELACION_LABEL[f.cancelacion_estatus].color }}
                          >
                            {CANCELACION_LABEL[f.cancelacion_estatus].label}
                            {f.cancelacion_motivo ? " · motivo " + f.cancelacion_motivo : ""}
                          </p>
                        )}
                        {!f.user_id && (
                          <div style={{ marginTop: 6 }}>
                            <p style={{ fontSize: 12, color: "#A32D2D", margin: "0 0 4px" }}>⚠️ Cliente no identificado</p>
                            <select
                              defaultValue=""
                              disabled={asignando === f.id}
                              onChange={(e) => asignarCliente(f.id, e.target.value)}
                            >
                              <option value="">Asignar cliente...</option>
                              {clientes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre} — {c.email}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {f.archivo_url && (
                          <BotonArchivo url={f.archivo_url} bucket="facturas">
                            📥 Ver PDF
                          </BotonArchivo>
                        )}
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {puedoCancelar && (sePuedeCancelar(f) || sePuedeFacturar(f) || sePuedeComplementar(f)) && (
                        <input
                          type="checkbox"
                          aria-label="Seleccionar"
                          checked={seleccion.includes(f.id)}
                          onChange={(e) => setSeleccion((s) => (e.target.checked ? [...s, f.id] : s.filter((i) => i !== f.id)))}
                        />
                      )}
                      <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => toggleFactura(f)}>
                        {facturaExpandidaId === f.id ? "Ocultar pagos" : "Ver pagos vinculados"}
                      </button>
                      {f.user_id && (
                        <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} href={"/facturas-admin/por-cliente?cliente=" + f.user_id}>
                          📅 Historial del cliente
                        </a>
                      )}
                      {puedoCancelar && sePuedeComplementar(f) && (
                        <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} onClick={() => abrirComplemento([f.id])}>
                          💵 Complemento de pago
                        </button>
                      )}
                      {puedoCancelar && sePuedeFacturar(f) && (
                        <button className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} disabled={facturando} onClick={() => facturarCobros([f.id])}>
                          🧾 Facturar (CFDI)
                        </button>
                      )}
                      {puedoCancelar && sePuedeCancelar(f) && (
                        <button className="tel-borrar-btn" style={{ color: "#A32D2D", fontWeight: 600 }} onClick={() => abrirCancelar([f.id])}>
                          ✕ Cancelar factura
                        </button>
                      )}
                    </div>

                    {facturaExpandidaId === f.id && (
                      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
                        {cargandoPagos ? (
                          <p style={{ fontSize: 12, color: "#888" }}>Cargando pagos...</p>
                        ) : pagosDeFactura.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#aaa" }}>Sin pagos vinculados todavía.</p>
                        ) : (
                          pagosDeFactura.map((p) => (
                            <p className="contrato-detalle" key={p.id}>
                              {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                            </p>
                          ))
                        )}

                        {sueltosDelCliente.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <p className="sub-label">Vincular pago suelto de este cliente</p>
                            {sueltosDelCliente.map((p) => (
                              <div
                                key={p.id}
                                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}
                              >
                                <span style={{ fontSize: 12, color: "#555" }}>
                                  {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                                </span>
                                <button
                                  className="tel-borrar-btn"
                                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                                  disabled={vinculando === p.id}
                                  onClick={() => vincularPago(p.id, f.id)}
                                >
                                  Vincular
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
