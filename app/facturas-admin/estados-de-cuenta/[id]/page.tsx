"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { rolPuede } from "@/lib/permisosApi";
import { serieCentro } from "@/lib/centros";
import { FORMAS_PAGO_SAT, PERIODICIDADES, TIPOS_RELACION, REGEX_UUID, separarUuids } from "@/lib/formasPagoSat";
import { EMISOR } from "@/lib/emisor";
import { esFacturaSimulada } from "@/lib/facturaSimulada";
import type { PreviaFactura } from "@/lib/facturarCobro";
import { avisosDatosFiscales } from "@/lib/datosFiscales";
import { numeroUsuarioVisible } from "@/lib/numeroUsuario";
import Link from "next/link";

// Estado de cuenta (como en ZORA): lo que se integró para un cliente, sus pagos y su historial. Desde "Acciones" se
// timbra (aquí se elige el método y la forma de pago), se envía o imprime, se edita el concepto y la fecha, se registran
// pagos y se descargan el PDF y el XML (menú Acciones, como en ZORA).

const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const redondear = (n: number) => Math.round(n * 100) / 100;

type Factura = {
  id: string;
  user_id: string | null;
  folio: string;
  concepto: string;
  monto: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string;
  centro: string | null;
  archivo_url: string | null;
  xml_url: string | null;
  uuid_cfdi: string | null;
  serie: string | null;
  folio_fiscal: string | null;
  metodo_pago: string | null;
  cancelacion_estatus: string | null;
  cancelacion_motivo?: string | null;
  forma_pago?: string | null;
  subtotal?: number | null;
  iva?: number | null;
  envios_estado?: number | null;
};
type Pago = { id: string; concepto: string | null; monto: number; estado: string; adicional_tipo: string | null; created_at: string };
type Cliente = { numero_usuario?: string | number | null; nombre: string; email: string; empresa: string | null; nombre_fiscal: string | null; rfc: string | null; regimen_fiscal: string | null; cp_fiscal: string | null };
type Complemento = { id: string; serie: string | null; folio_fiscal: string | null; fecha_pago: string; monto: number; uuid_cfdi: string | null; cancelacion_estatus: string | null; importe: number };

const ESTADO_PAGO: Record<string, string> = { pendiente: "Pendiente", pagado: "Pagado", cancelado: "Cancelado" };

const MOTIVOS_NOMBRE: Record<string, string> = {
  "01": "Comprobante emitido con errores con relación",
  "02": "Comprobante emitido con errores sin relación",
  "03": "No se llevó a cabo la operación",
  "04": "Operación nominativa relacionada en una factura global",
};

function tipoDeLinea(p: Pago) {
  const nombre = etiquetaPagoSuelto(p.concepto);
  if (p.adicional_tipo) return "Adicional";
  if (/dep[oó]sito/i.test(nombre)) return "Depósito";
  if (/mensualidad/i.test(nombre)) return "Mensualidad";
  if (/^(renta|estacionamiento)/i.test(nombre)) return "Recurrentes";
  return "Pago";
}

export default function EstadoDeCuentaPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [factura, setFactura] = useState<Factura | null>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [complementos, setComplementos] = useState<Complemento[]>([]);
  const [rol, setRol] = useState("");
  const [pestana, setPestana] = useState<"info" | "pagos" | "historial">("info");
  const [menu, setMenu] = useState(false);
  const [modalTimbrar, setModalTimbrar] = useState(false);
  const [metodo, setMetodo] = useState<"PPD" | "PUE">("PPD");
  const [formaPago, setFormaPago] = useState("03");
  const [timbrando, setTimbrando] = useState(false);
  const [errorTimbrar, setErrorTimbrar] = useState("");
  const [condiciones, setCondiciones] = useState("Contado");
  const [tipoRelacion, setTipoRelacion] = useState("");
  const [uuidsRelacion, setUuidsRelacion] = useState("");
  const [periodicidad, setPeriodicidad] = useState("day");
  const [cuentaPago, setCuentaPago] = useState("");
  // Vista previa: el PDF que genera Facturapi, mostrado con el visor de PDF del navegador.
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  // Respaldo: si Facturapi no responde (suscripción), se muestra una previa dibujada con los mismos datos.
  const [previa, setPrevia] = useState<{ previa: PreviaFactura; avisos: string[] } | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [aviso, setAviso] = useState("");
  // Historial: todos los estados de cuenta del cliente (como "Detalles" de ZORA).
  const [historial, setHistorial] = useState<Factura[]>([]);
  const [pagosHist, setPagosHist] = useState<{ factura_id: string; estado: string; monto: number }[]>([]);
  const [menuFila, setMenuFila] = useState<{ f: Factura; x: number; y: number } | null>(null);
  // Vista previa del PDF de la factura de una fila del historial (opción "Ver").
  const [pdfVisor, setPdfVisor] = useState<{ id: string; titulo: string } | null>(null);
  const [exito, setExito] = useState(false);
  const [cancelar, setCancelar] = useState<Factura | null>(null);
  const [motivoCan, setMotivoCan] = useState("");
  const [folioSust, setFolioSust] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [errorCan, setErrorCan] = useState("");
  const accionInicial = useRef(false);
  const confeti = useMemo(
    () =>
      Array.from({ length: 26 }).map((_, i) => ({
        left: Math.random() * 100,
        dur: 1 + Math.random() * 0.8,
        delay: Math.random() * 0.4,
        color: ["#ff915c", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
      })),
    []
  );
  const [accionando, setAccionando] = useState(false);
  const [modalEditar, setModalEditar] = useState(false);
  const [conceptoEdit, setConceptoEdit] = useState("");
  const [fechaEdit, setFechaEdit] = useState("");
  const [modalPago, setModalPago] = useState(false);
  const [pagosSel, setPagosSel] = useState<string[]>([]);
  const [formaPagoReg, setFormaPagoReg] = useState("03");
  const [errorModal, setErrorModal] = useState("");

  async function cargar() {
    setCargando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: yo } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
      setRol(yo?.rol || "");
    }
    const { data: f } = await supabase.from("facturas").select("*").eq("id", id).maybeSingle();
    if (!f) {
      setError("No se encontró este estado de cuenta");
      setCargando(false);
      return;
    }
    setFactura(f as Factura);
    const [{ data: ps }, { data: cl }, { data: filas }] = await Promise.all([
      supabase.from("pagos").select("id, concepto, monto, estado, adicional_tipo, created_at").eq("factura_id", id).order("created_at", { ascending: true }),
      f.user_id ? supabase.from("profiles").select("numero_usuario, nombre, email, empresa, nombre_fiscal, rfc, regimen_fiscal, cp_fiscal").eq("id", f.user_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("complemento_pago_facturas").select("complemento_id, importe").eq("factura_id", id),
    ]);
    setPagos((ps as Pago[]) || []);
    setCliente((cl as Cliente | null) || null);
    const compIds = (filas || []).map((x) => x.complemento_id);
    if (compIds.length > 0) {
      const { data: cs } = await supabase.from("complementos_pago").select("id, serie, folio_fiscal, fecha_pago, monto, uuid_cfdi, cancelacion_estatus").in("id", compIds);
      setComplementos(((cs as Omit<Complemento, "importe">[]) || []).map((c) => ({ ...c, importe: Number((filas || []).find((x) => x.complemento_id === c.id)?.importe || 0) })));
    } else setComplementos([]);
    if (f.user_id) {
      const { data: hs } = await supabase.from("facturas").select("*").eq("user_id", f.user_id).order("fecha_emision", { ascending: false }).order("created_at", { ascending: false }).limit(100);
      const lista = (hs as Factura[]) || [];
      setHistorial(lista);
      const ids = lista.map((x) => x.id);
      const { data: ph } = ids.length ? await supabase.from("pagos").select("factura_id, estado, monto").in("factura_id", ids) : { data: [] as { factura_id: string; estado: string; monto: number }[] };
      setPagosHist((ph as { factura_id: string; estado: string; monto: number }[]) || []);
    } else {
      setHistorial([f as Factura]);
      setPagosHist([]);
    }
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const lineas = useMemo(() => {
    if (!factura) return [];
    if (pagos.length > 0) {
      return pagos.map((p) => ({ key: p.id, tipo: tipoDeLinea(p), descripcion: etiquetaPagoSuelto(p.concepto), total: Number(p.monto) }));
    }
    return [{ key: "unica", tipo: "Pago", descripcion: factura.concepto, total: Number(factura.monto) }];
  }, [factura, pagos]);

  const puedeTimbrar = rolPuede(rol, "facturaEmitir");
  const timbrada = !!factura?.uuid_cfdi;
  const simulada = esFacturaSimulada(factura?.uuid_cfdi);
  const sePuedeTimbrar = !!factura && !timbrada && !!factura.user_id && factura.estado !== "cancelada";
  const avisos = cliente ? avisosDatosFiscales(cliente) : [];
  const esPublicoGeneral = cliente?.rfc === "XAXX010101000";
  const faltanDatos = !!cliente && !(cliente.rfc && cliente.nombre_fiscal && cliente.regimen_fiscal && cliente.cp_fiscal);

  // Valida lo del cuadro Facturar; devuelve el mensaje de error o "".
  function validarFacturar(): string {
    if (!condiciones.trim()) return "Escribe las condiciones de pago";
    if (metodo === "PUE" && !FORMAS_PAGO_SAT.some((f) => f.clave === formaPago)) return "Elige la forma de pago";
    if (metodo === "PUE" && formaPago === "03" && cuentaPago.trim() && !/^[0-9A-Za-z\- ]{4,30}$/.test(cuentaPago.trim())) return "El número de cuenta solo admite letras, números y guiones (4 a 30 caracteres)";
    if (tipoRelacion) {
      const uuids = separarUuids(uuidsRelacion);
      if (uuids.length === 0) return "Escribe el UUID del CFDI relacionado";
      if (uuids.some((u) => !REGEX_UUID.test(u))) return "Algún UUID del CFDI relacionado no es válido (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
    }
    return "";
  }

  function cuerpoFactura() {
    return {
      metodo,
      formaPago: metodo === "PUE" ? formaPago : undefined,
      condicionesPago: condiciones.trim(),
      cuentaPago: metodo === "PUE" && formaPago === "03" && cuentaPago.trim() ? cuentaPago.trim() : undefined,
      periodicidad: esPublicoGeneral ? periodicidad : undefined,
      relacion: tipoRelacion ? { tipo: tipoRelacion, uuids: separarUuids(uuidsRelacion) } : undefined,
    };
  }

  async function verPrevia() {
    if (!factura) return;
    const e = validarFacturar();
    if (e) return setErrorTimbrar(e);
    setErrorTimbrar("");
    setCargandoPrevia(true);
    const res = await fetch("/api/facturas/vista-previa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaId: factura.id, ...cuerpoFactura() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Sin suscripción en Facturapi no hay PDF: se muestra la previa provisional con los mismos datos.
      if (/suscripci/i.test(data.error || "")) {
        const alt = await fetch("/api/facturas/vista-previa?facturaId=" + factura.id);
        const datosAlt = await alt.json().catch(() => ({}));
        setCargandoPrevia(false);
        if (alt.ok) return setPrevia({ previa: datosAlt.previa, avisos: datosAlt.avisos || [] });
        return setErrorTimbrar(datosAlt.error || data.error);
      }
      setCargandoPrevia(false);
      return setErrorTimbrar(data.error || "No se pudo armar la vista previa");
    }
    const blob = await res.blob();
    setCargandoPrevia(false);
    setPreviaUrl(URL.createObjectURL(blob));
  }

  // Factura simulada: no hay PDF del SAT; se muestra su formato con los mismos datos.
  async function verFormatoSimulado() {
    if (!factura) return;
    setMetodo(factura.metodo_pago === "PUE" ? "PUE" : "PPD");
    setFormaPago(factura.forma_pago || "03");
    const res = await fetch("/api/facturas/vista-previa?facturaId=" + factura.id);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setAviso("✗ " + (data.error || "No se pudo armar el formato"));
    setPrevia({ previa: data.previa, avisos: data.avisos || [] });
  }

  function cerrarPrevia() {
    if (previaUrl) URL.revokeObjectURL(previaUrl);
    setPreviaUrl(null);
  }

  async function timbrar() {
    if (!factura) return;
    const e = validarFacturar();
    if (e) return setErrorTimbrar(e);
    setErrorTimbrar("");
    setTimbrando(true);
    const res = await fetch("/api/facturas/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaIds: [factura.id], ...cuerpoFactura() }),
    });
    const data = await res.json().catch(() => ({}));
    setTimbrando(false);
    const r = (data.resultados || [])[0];
    if (!res.ok || (r && !r.ok)) return setErrorTimbrar(r?.error || data.error || "No se pudo timbrar");
    setModalTimbrar(false);
    setExito(true);
    cargar();
  }

  function abrirCancelar(f: Factura) {
    setCancelar(f);
    setMotivoCan("");
    setFolioSust("");
    setErrorCan("");
  }

  async function confirmarCancelacion() {
    if (!cancelar) return;
    setErrorCan("");
    if (!motivoCan) return setErrorCan("Elige el motivo");
    if (motivoCan === "01" && !folioSust.trim()) return setErrorCan("Escribe el folio de la factura que la sustituye");
    setCancelando(true);
    const res = await fetch("/api/facturas/cancelar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaIds: [cancelar.id], motivo: motivoCan, sustitutaUuid: folioSust.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setCancelando(false);
    const r = (data.resultados || [])[0];
    if (!res.ok || (r && !r.ok)) return setErrorCan(r?.error || data.error || "No se pudo cancelar");
    setCancelar(null);
    setAviso(r?.estatus === "en_proceso" ? "✓ Cancelación enviada al SAT: queda en proceso hasta que el cliente la acepte." : "✓ Factura cancelada.");
    cargar();
  }

  // Datos de una fila del historial.
  function datosFila(h: Factura) {
    const cancelada = h.cancelacion_estatus === "cancelada" || h.estado === "cancelada";
    const totalH = Number(h.monto);
    const subtotalH = h.subtotal != null ? Number(h.subtotal) : redondear(totalH / 1.16);
    const ps = pagosHist.filter((p) => p.factura_id === h.id);
    const saldo = cancelada ? 0 : ps.length > 0 ? redondear(ps.filter((p) => p.estado !== "pagado").reduce((s, p) => s + Number(p.monto), 0)) : h.estado === "pagada" ? 0 : totalH;
    const simuladaH = esFacturaSimulada(h.uuid_cfdi);
    return {
      cancelada,
      total: totalH,
      subtotal: subtotalH,
      iva: h.iva != null ? Number(h.iva) : redondear(totalH - subtotalH),
      saldo,
      pendientes: ps.filter((p) => p.estado !== "pagado").length,
      estatusTimbre: !h.uuid_cfdi ? "Sin timbrar" : cancelada ? "Cancelada" : h.cancelacion_estatus === "en_proceso" ? "Cancelación en proceso" : simuladaH ? "Timbrada (simulada)" : "Timbrada",
      facturaElectronica: h.uuid_cfdi ? (h.serie ? h.serie + "-" : "") + (h.folio_fiscal || "") + (simuladaH ? " (simulada)" : "") : "",
      simulada: simuladaH,
    };
  }

  // Acciones que llegan en la dirección (?imprimir=1, ?pago=1, ?formato=1, ?facturar=1) desde el menú de una fila del historial.
  useEffect(() => {
    if (cargando || !factura || accionInicial.current) return;
    accionInicial.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("imprimir")) setTimeout(() => window.print(), 800);
    else if (params.get("pago") && pagos.some((p) => p.estado !== "pagado")) abrirPago();
    else if (params.get("formato")) verFormatoSimulado();
    else if (params.get("facturar") && puedeTimbrar && sePuedeTimbrar) abrirTimbrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, factura]);

  const pagosPendientes = pagos.filter((p) => p.estado !== "pagado");
  const editable = !!factura && !timbrada && factura.estado !== "cancelada";

  async function llamar(cuerpo: Record<string, unknown>) {
    const res = await fetch("/api/facturas/estado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facturaId: id, ...cuerpo }) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function enviar() {
    if (!factura || !cliente) return;
    if (!confirm(`¿Enviar este estado de cuenta a ${cliente.email}?`)) return;
    setAccionando(true);
    const { ok, data } = await llamar({ accion: "enviar" });
    setAccionando(false);
    setAviso(ok ? `✓ Estado de cuenta enviado a ${data.correo}.` : `✗ ${data.error || "No se pudo enviar"}`);
  }

  function imprimir() {
    setPestana("info");
    setTimeout(() => window.print(), 150);
  }

  function abrirEditar() {
    if (!factura) return;
    setConceptoEdit(factura.concepto);
    setFechaEdit(factura.fecha_emision);
    setErrorModal("");
    setModalEditar(true);
  }

  async function guardarEdicion() {
    setErrorModal("");
    if (!conceptoEdit.trim() || !fechaEdit) return setErrorModal("Escribe el concepto y elige la fecha");
    setAccionando(true);
    const { ok, data } = await llamar({ accion: "editar", concepto: conceptoEdit, fecha: fechaEdit });
    setAccionando(false);
    if (!ok) return setErrorModal(data.error || "No se pudo guardar");
    setModalEditar(false);
    setAviso("✓ Concepto y fecha actualizados.");
    cargar();
  }

  function abrirPago() {
    setPagosSel(pagosPendientes.map((p) => p.id));
    setFormaPagoReg("03");
    setErrorModal("");
    setModalPago(true);
  }

  async function guardarPago() {
    setErrorModal("");
    if (pagosSel.length === 0) return setErrorModal("Elige al menos un pago");
    setAccionando(true);
    const { ok, data } = await llamar({ accion: "pago", pagoIds: pagosSel, formaPago: formaPagoReg });
    setAccionando(false);
    if (!ok) return setErrorModal(data.error || "No se pudo registrar el pago");
    setModalPago(false);
    setAviso(`✓ ${data.registrados} pago(s) registrado(s)${data.complemento ? " y su complemento de pago se emitió" : ""}.`);
    cargar();
  }

  function abrirTimbrar() {
    setMetodo(factura?.estado === "pagada" ? "PUE" : "PPD");
    setFormaPago("03");
    setCondiciones("Contado");
    setCuentaPago("");
    setTipoRelacion("");
    setUuidsRelacion("");
    setPeriodicidad("day");
    setErrorTimbrar("");
    setModalTimbrar(true);
  }

  const total = factura ? Number(factura.monto) : 0;
  const subtotal = redondear(total / 1.16);
  const iva = redondear(total - subtotal);

  return (
    <div className="panel">
      <div className="rep-header no-imprimir">
        <Link className="rep-back" href="/facturas-admin/estados-de-cuenta">
          ← Estados de cuenta
        </Link>
        <p className="rep-title">Estado de cuenta</p>
        <p className="rep-sub">{factura ? factura.folio : "Cargando..."}</p>
      </div>

      <div className="rep-content rep-content-completo">
        {cargando ? (
          <div className="empty-card">Cargando...</div>
        ) : error || !factura ? (
          <div className="empty-card" style={{ color: "#A32D2D" }}>
            {error || "No se encontró este estado de cuenta"}
          </div>
        ) : (
          <>
            <div className="fac-pestanas no-imprimir" role="tablist">
              {([
                ["info", "Información"],
                ["pagos", "Pagos"],
                ["historial", "Historial facturas"],
              ] as const).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={pestana === k} className={pestana === k ? "activa" : ""} onClick={() => setPestana(k)}>
                  {t}
                </button>
              ))}
            </div>

            <div className="form-card" style={{ marginTop: 0, borderTopLeftRadius: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e", fontSize: 18, margin: 0 }}>
                  Estado de cuenta
                </p>
                <div className="no-imprimir" style={{ position: "relative" }}>
                  <button type="button" className="btn-exportar fac-naranja" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
                    Acciones ▾
                  </button>
                  {menu && (
                    <div className="fac-acciones-menu" role="menu" onClick={() => setMenu(false)}>
                      <button type="button" role="menuitem" disabled={!cliente?.email || accionando} onClick={enviar}>
                        Enviar estado de cuenta
                      </button>
                      <button type="button" role="menuitem" onClick={imprimir}>
                        Imprimir estado de cuenta
                      </button>
                      <button type="button" role="menuitem" disabled={!editable} title={editable ? "" : "Ya está timbrada o cancelada"} onClick={abrirEditar}>
                        Editar concepto y fecha de estado de cuenta
                      </button>
                      <a role="menuitem" href="/facturas-admin/integrar-cliente">
                        Crear estado de cuenta
                      </a>
                      <a role="menuitem" href="/facturas-admin/estados-de-cuenta">
                        Consultar estados de cuenta
                      </a>
                      <button type="button" role="menuitem" disabled={pagosPendientes.length === 0 || !rolPuede(rol, "pagosMarcarPagado")} title={pagosPendientes.length === 0 ? "No hay pagos pendientes" : ""} onClick={abrirPago}>
                        Crear pago
                      </button>
                      <a role="menuitem" href={"/facturas-admin/timbradas?cliente=" + (factura.user_id || "") + "&centro=" + encodeURIComponent(factura.centro || "")}>
                        Facturas generadas
                      </a>
                      {simulada ? (
                        <button type="button" role="menuitem" onClick={verFormatoSimulado}>
                          Reimprime (formato simulado)
                        </button>
                      ) : factura.archivo_url ? (
                        <a role="menuitem" href={"/api/facturas/descargar?id=" + factura.id + "&tipo=pdf"}>
                          Reimprime (PDF de la factura)
                        </a>
                      ) : (
                        <button type="button" role="menuitem" disabled title="Todavía no hay factura timbrada">
                          Reimprime (PDF de la factura)
                        </button>
                      )}
                      {factura.xml_url && (
                        <a role="menuitem" href={"/api/facturas/descargar?id=" + factura.id + "&tipo=xml"}>
                          Descargar XML
                        </a>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!timbrada || factura.cancelacion_estatus === "cancelada" || factura.cancelacion_estatus === "en_proceso" || !rolPuede(rol, "facturaCancelar")}
                        title={!timbrada ? "Todavía no está timbrada" : !rolPuede(rol, "facturaCancelar") ? "Solo cobranza y administración pueden cancelar" : ""}
                        onClick={() => abrirCancelar(factura)}
                      >
                        Cancelar timbrado
                      </button>
                      {timbrada && (
                        <a role="menuitem" href="/facturas-admin/timbradas">
                          Complemento de pago (Facturas timbradas)
                        </a>
                      )}
                      <button type="button" role="menuitem" disabled={!(puedeTimbrar && sePuedeTimbrar)} title={timbrada ? "Ya está timbrada" : !puedeTimbrar ? "Solo cobranza y administración pueden timbrar" : ""} onClick={abrirTimbrar}>
                        Generar factura electrónica
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {aviso && (
                <p className="no-imprimir" style={{ fontSize: 13, margin: "10px 0 0" }}>
                  {aviso}
                  <button className="tel-borrar-btn" style={{ marginLeft: 8 }} onClick={() => setAviso("")}>
                    Cerrar
                  </button>
                </p>
              )}

              {pestana === "info" && (
                <>
                  <table className="fac-ficha">
                    <tbody>
                      <tr>
                        <th>Número de factura</th>
                        <td>{factura.folio}</td>
                      </tr>
                      <tr>
                        <th>Centro</th>
                        <td>
                          {factura.centro || "—"}
                          {serieCentro(factura.centro) ? ` · serie ${serieCentro(factura.centro)}` : ""}
                        </td>
                      </tr>
                      <tr>
                        <th>Cliente</th>
                        <td>
                          {cliente ? cliente.nombre_fiscal || cliente.empresa || cliente.nombre : "—"}
                          {cliente?.rfc ? ` · ${cliente.rfc}` : ""}
                        </td>
                      </tr>
                      <tr>
                        <th>Fecha</th>
                        <td>{factura.fecha_emision}</td>
                      </tr>
                      <tr>
                        <th>Vence</th>
                        <td>{factura.fecha_vencimiento}</td>
                      </tr>
                      <tr>
                        <th>Subtotal</th>
                        <td>{dinero(subtotal)}</td>
                      </tr>
                      <tr>
                        <th>IVA</th>
                        <td>{dinero(iva)}</td>
                      </tr>
                      <tr>
                        <th>Total</th>
                        <td>
                          <b>{dinero(total)}</b>
                        </td>
                      </tr>
                      <tr>
                        <th>Moneda</th>
                        <td>MXN</td>
                      </tr>
                      <tr>
                        <th>Concepto</th>
                        <td>{factura.concepto}</td>
                      </tr>
                      <tr>
                        <th>Factura electrónica</th>
                        <td>
                          {timbrada
                            ? `${simulada ? "Timbrada SIMULADA (prueba)" : "Timbrada"} ${factura.metodo_pago || ""} · ${factura.serie ? factura.serie + "-" + (factura.folio_fiscal || "") : ""}`
                            : factura.estado === "cancelada"
                              ? "Cancelada"
                              : "Por timbrar"}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e", fontSize: 18, margin: "22px 0 8px" }}>
                    Ver estados de cuenta
                  </p>
                  <div className="fac-tabla-wrap" style={{ marginTop: 0 }}>
                    <table className="fac-tabla" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Descripción</th>
                          <th className="fac-num">Total a cobrar</th>
                          <th className="fac-num">P/U</th>
                          <th className="fac-num">Subtotal</th>
                          <th className="fac-num">IVA</th>
                          <th className="fac-num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineas.map((l) => {
                          const sub = redondear(l.total / 1.16);
                          return (
                            <tr key={l.key}>
                              <td>{l.tipo}</td>
                              <td>{l.descripcion}</td>
                              <td className="fac-num fac-nowrap">1</td>
                              <td className="fac-num fac-nowrap">{dinero(sub)}</td>
                              <td className="fac-num fac-nowrap">{dinero(sub)}</td>
                              <td className="fac-num fac-nowrap">{dinero(redondear(l.total - sub))}</td>
                              <td className="fac-num fac-nowrap">
                                <b>{dinero(l.total)}</b>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} style={{ textAlign: "right", fontWeight: 600, padding: "10px 12px" }}>
                            Total
                          </td>
                          <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                            <b>{dinero(subtotal)}</b>
                          </td>
                          <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                            <b>{dinero(iva)}</b>
                          </td>
                          <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                            <b>{dinero(total)}</b>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              {pestana === "pagos" && (
                <div className="fac-tabla-wrap" style={{ marginTop: 12 }}>
                  {pagos.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#888", padding: 12, margin: 0 }}>Este estado de cuenta no tiene pagos ligados todavía.</p>
                  ) : (
                    <table className="fac-tabla" style={{ minWidth: 560 }}>
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th>Registrado</th>
                          <th>Estado</th>
                          <th className="fac-num">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagos.map((p) => (
                          <tr key={p.id}>
                            <td>{etiquetaPagoSuelto(p.concepto)}</td>
                            <td className="fac-nowrap">{p.created_at.slice(0, 10)}</td>
                            <td>{ESTADO_PAGO[p.estado] || p.estado}</td>
                            <td className="fac-num fac-nowrap">{dinero(Number(p.monto))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {pestana === "historial" && (
                <div className="fac-tabla-wrap" style={{ marginTop: 12 }}>
                  <table className="fac-tabla" style={{ minWidth: 1500 }}>
                    <thead>
                      <tr>
                        <th>Acciones</th>
                        <th>No. Cliente</th>
                        <th>Estado de cuenta</th>
                        <th>Fecha</th>
                        <th>Centro</th>
                        <th>Nombre</th>
                        <th>Concepto</th>
                        <th className="fac-num">Subtotal</th>
                        <th className="fac-num">IVA</th>
                        <th className="fac-num">Total</th>
                        <th>Estatus</th>
                        <th>Motivo cancelación</th>
                        <th>Envíos</th>
                        <th>Estatus timbre</th>
                        <th className="fac-num">Saldo</th>
                        <th>Factura electrónica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((h) => {
                        const d = datosFila(h);
                        return (
                          <tr key={h.id} className={d.cancelada ? "fac-fila-cancelada" : h.id === factura.id ? "fac-fila-actual" : undefined}>
                            <td>
                              <button
                                type="button"
                                className="fac-fila-acciones"
                                aria-label="Acciones de esta fila"
                                onClick={(e) => {
                                  const b = e.currentTarget.getBoundingClientRect();
                                  setMenuFila({ f: h, x: Math.max(8, Math.min(b.left, window.innerWidth - 300)), y: Math.min(b.bottom + 4, window.innerHeight - 360) });
                                }}
                              >
                                ▾
                              </button>
                            </td>
                            <td className="fac-nowrap">{numeroUsuarioVisible(cliente?.numero_usuario) || "—"}</td>
                            <td className="fac-nowrap">
                              <a href={"/facturas-admin/estados-de-cuenta/" + h.id} style={{ color: "#0d1b3e", textDecoration: "underline" }}>
                                <b>{h.folio}</b>
                              </a>
                            </td>
                            <td className="fac-nowrap">{h.fecha_emision}</td>
                            <td>{h.centro || "—"}</td>
                            <td>{cliente ? cliente.nombre_fiscal || cliente.empresa || cliente.nombre : "—"}</td>
                            <td>{h.concepto}</td>
                            <td className="fac-num fac-nowrap">{dinero(d.subtotal)}</td>
                            <td className="fac-num fac-nowrap">{dinero(d.iva)}</td>
                            <td className="fac-num fac-nowrap">{dinero(d.total)}</td>
                            <td>{d.cancelada ? "Cancelada" : "Activa"}</td>
                            <td>{h.cancelacion_motivo ? MOTIVOS_NOMBRE[h.cancelacion_motivo] || h.cancelacion_motivo : ""}</td>
                            <td className="fac-num">{h.envios_estado ?? 0}</td>
                            <td>{d.estatusTimbre}</td>
                            <td className="fac-num fac-nowrap">{dinero(d.saldo)}</td>
                            <td className="fac-nowrap" style={d.simulada ? { color: "#A32D2D" } : undefined}>
                              {d.facturaElectronica}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={7} style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>
                          Totales (sin canceladas)
                        </td>
                        <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                          <b>{dinero(redondear(historial.filter((h) => !datosFila(h).cancelada).reduce((s, h) => s + datosFila(h).subtotal, 0)))}</b>
                        </td>
                        <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                          <b>{dinero(redondear(historial.filter((h) => !datosFila(h).cancelada).reduce((s, h) => s + datosFila(h).iva, 0)))}</b>
                        </td>
                        <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                          <b>{dinero(redondear(historial.filter((h) => !datosFila(h).cancelada).reduce((s, h) => s + datosFila(h).total, 0)))}</b>
                        </td>
                        <td colSpan={4}></td>
                        <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                          <b>{dinero(redondear(historial.reduce((s, h) => s + datosFila(h).saldo, 0)))}</b>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                  {complementos.length > 0 && (
                    <p style={{ fontSize: 12, color: "#667", padding: "8px 12px", margin: 0 }}>
                      Complementos de pago de este estado de cuenta: {complementos.map((c) => (c.serie ? c.serie + "-" : "") + (c.folio_fiscal || "") + (c.cancelacion_estatus === "cancelada" ? " (cancelado)" : "")).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {modalTimbrar && factura && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !timbrando && setModalTimbrar(false)}
        >
          <div className="form-card fac-facturar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={timbrando} onClick={() => setModalTimbrar(false)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Facturar</h2>
            <p className="fac-facturar-sub">
              Se genera factura a {(cliente ? cliente.nombre_fiscal || cliente.empresa || cliente.nombre : "").toUpperCase()} · {dinero(total)}
            </p>
                <div className="fac-facturar-fila">
                  <label>
                    Cond. pago <span style={{ color: "#A32D2D" }}>*</span>
                  </label>
                  <div>
                    <input type="text" maxLength={100} value={condiciones} onChange={(e) => setCondiciones(e.target.value)} />
                  </div>
                </div>
                <div className="fac-facturar-fila">
                  <label>
                    Método de pago <span style={{ color: "#A32D2D" }}>*</span>
                  </label>
                  <div>
                    <select
                      value={metodo}
                      onChange={(e) => {
                        const m = e.target.value as "PUE" | "PPD";
                        setMetodo(m);
                        if (m === "PUE" && formaPago === "99") setFormaPago("03");
                      }}
                    >
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
                    {metodo === "PPD" ? (
                      <select value="99" disabled>
                        <option value="99">Por definir</option>
                      </select>
                    ) : (
                      <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                        {FORMAS_PAGO_SAT.map((f) => (
                          <option key={f.clave} value={f.clave}>
                            {f.texto}
                          </option>
                        ))}
                      </select>
                    )}
                    {metodo === "PPD" && <p className="fac-facturar-nota">Con pago diferido la forma queda "Por definir"; cuando el cliente pague se emite su complemento de pago.</p>}
                  </div>
                </div>
            {metodo === "PUE" && formaPago === "03" && (
              <div className="fac-facturar-fila">
                <label>No. cuenta</label>
                <div>
                  <input type="text" maxLength={30} placeholder="Cuenta o CLABE con la que pagó" value={cuentaPago} onChange={(e) => setCuentaPago(e.target.value)} />
                  <p className="fac-facturar-nota">Se imprime en la factura como "No. cuenta de pago".</p>
                </div>
              </div>
            )}
            {esPublicoGeneral && (
                <div className="fac-facturar-fila">
                  <label>
                    Periodicidad
                  </label>
                  <div>
                    <select value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)}>
                      {PERIODICIDADES.map((p) => (
                        <option key={p.clave} value={p.clave}>
                          {p.texto}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
            )}

            <p className="fac-facturar-seccion">Información adicional de CFDI RELACIONADO</p>
                <div className="fac-facturar-fila">
                  <label>
                    Tipo relación
                  </label>
                  <div>
                    <select value={tipoRelacion} onChange={(e) => setTipoRelacion(e.target.value)}>
                      <option value=""></option>
                      {TIPOS_RELACION.map((t) => (
                        <option key={t.clave} value={t.clave}>
                          {t.texto}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="fac-facturar-fila">
                  <label>
                    CFDI relacionado
                  </label>
                  <div>
                    <textarea rows={3} disabled={!tipoRelacion} placeholder="UUID de la factura relacionada (uno por renglón)" value={uuidsRelacion} onChange={(e) => setUuidsRelacion(e.target.value)} />
                  </div>
                </div>
            {(faltanDatos || avisos.length > 0) && (
              <p style={{ fontSize: 12, color: "#A32D2D", margin: "10px 0 0" }}>
                {faltanDatos ? "Al cliente le faltan datos fiscales (RFC, razón social, régimen o código postal): no se podrá timbrar." : avisos[0]}
              </p>
            )}
            {errorTimbrar && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{errorTimbrar}</p>}
            <div className="fac-facturar-botones">
              <button type="button" className="fac-facturar-previa" disabled={timbrando || cargandoPrevia} onClick={verPrevia}>
                {cargandoPrevia ? "Armando..." : "Vista previa"}
              </button>
              <button type="button" className="btn-exportar fac-naranja" disabled={timbrando || faltanDatos} onClick={timbrar}>
                {timbrando ? "Timbrando..." : "Timbrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previaUrl && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={cerrarPrevia}
        >
          <div className="form-card fac-previa-doc" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" onClick={cerrarPrevia}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Previa</h2>
            <iframe className="fac-previa-pdf" src={previaUrl} title="Vista previa de la factura" />
            <p style={{ fontSize: 11, color: "#888", margin: "8px 0 0", textAlign: "center" }}>Vista previa sin valor fiscal: el folio, el UUID y los sellos se generan al timbrar.</p>
          </div>
        </div>
      )}

      {previa && factura && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflow: "auto" }}
          onClick={() => setPrevia(null)}
        >
          <div className="form-card fac-previa-doc" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" onClick={() => setPrevia(null)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Previa</h2>
            <p style={{ fontSize: 12, color: "#854F0B", background: "#FAEEDA", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px", textAlign: "center" }}>
              {simulada
                ? "Factura SIMULADA de prueba: no tiene valor fiscal. Es el formato con los mismos datos; el PDF real lo genera Facturapi cuando se active."
                : "Vista previa provisional: Facturapi no está disponible (suscripción), así que se arma aquí con los mismos datos. El PDF real se verá cuando se active."}
            </p>
            <div className="fac-previa-hoja">
              <div className="fac-previa-cab">
                <div className="fac-previa-logo">
                  NODUS
                  <small>FLEX CENTER</small>
                </div>
                <table className="fac-previa-datos">
                  <tbody>
                    <tr>
                      <th>Factura</th>
                      <td>{simulada ? (factura.serie || "") + "-" + (factura.folio_fiscal || "") + " (simulado)" : previa.previa.serie ? previa.previa.serie + "-(se asigna al timbrar)" : "(se asigna al timbrar)"}</td>
                    </tr>
                    <tr>
                      <th>Método de pago</th>
                      <td>{metodo === "PUE" ? "PUE-Pago en una sola exhibición" : "PPD-Pago en parcialidades o diferido"}</td>
                    </tr>
                    <tr>
                      <th>Tipo de comprobante</th>
                      <td>I-Ingreso</td>
                    </tr>
                    <tr>
                      <th>Forma de pago</th>
                      <td>{metodo === "PPD" ? "99-Por definir" : formaPago + "-" + (FORMAS_PAGO_SAT.find((f) => f.clave === formaPago)?.texto || "")}</td>
                    </tr>
                    {metodo === "PUE" && formaPago === "03" && cuentaPago.trim() && (
                      <tr>
                        <th>Num. Cta. Pago</th>
                        <td>{cuentaPago.trim()}</td>
                      </tr>
                    )}
                    <tr>
                      <th>Condiciones de pago</th>
                      <td>{condiciones}</td>
                    </tr>
                    <tr>
                      <th>Lugar de expedición</th>
                      <td>{EMISOR.cp}</td>
                    </tr>
                    <tr>
                      <th>Fecha factura</th>
                      <td>{factura.fecha_emision}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="fac-previa-centro">Centro: {previa.previa.centro ? "NODUS " + previa.previa.centro.toUpperCase() : "—"}</p>

              <p className="fac-previa-banda">Emisor</p>
              <p className="fac-previa-linea">
                <b>Razón social:</b> {EMISOR.razonSocial} &nbsp;·&nbsp; <b>RFC:</b> {EMISOR.rfc}
              </p>
              <p className="fac-previa-linea">
                <b>Dirección:</b> {EMISOR.direccion}, Col. {EMISOR.colonia}, CP {EMISOR.cp}, {EMISOR.ciudad}, {EMISOR.estado}, {EMISOR.pais}
              </p>
              <p className="fac-previa-linea">
                <b>Régimen:</b> {EMISOR.regimen}
              </p>

              <p className="fac-previa-banda">Receptor</p>
              <p className="fac-previa-linea">
                <b>Razón social:</b> {previa.previa.receptor.nombre || "—"} &nbsp;·&nbsp; <b>RFC:</b> {previa.previa.receptor.rfc || "—"}
              </p>
              <p className="fac-previa-linea">
                <b>CP:</b> {previa.previa.receptor.cp || "—"} &nbsp;·&nbsp; <b>Régimen:</b> {previa.previa.receptor.regimen || "—"} &nbsp;·&nbsp; <b>Uso CFDI:</b> {previa.previa.receptor.uso}
              </p>

              <table className="fac-previa-tabla">
                <thead>
                  <tr>
                    <th>Cant.</th>
                    <th>U.M.</th>
                    <th>C.Producto</th>
                    <th>Descripción</th>
                    <th className="fac-num">P.Unitario</th>
                    <th className="fac-num">Imp.Total</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.previa.lineas.map((l, i) => (
                    <tr key={i}>
                      <td>{l.cantidad}</td>
                      <td>{l.unidad}</td>
                      <td>{l.claveProd}</td>
                      <td>{l.descripcion}</td>
                      <td className="fac-num">{l.precioUnitario.toFixed(2)}</td>
                      <td className="fac-num">{l.importe.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="fac-previa-totales">
                <tbody>
                  <tr>
                    <th>Sub-Total:</th>
                    <td>{dinero(previa.previa.subtotal)}</td>
                  </tr>
                  <tr>
                    <th>IVA (16%):</th>
                    <td>{dinero(previa.previa.iva)}</td>
                  </tr>
                  <tr>
                    <th>Total:</th>
                    <td>
                      <b>{dinero(previa.previa.total)}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
              {tipoRelacion && (
                <p className="fac-previa-linea">
                  <b>CFDI relacionado:</b> {TIPOS_RELACION.find((t) => t.clave === tipoRelacion)?.texto} · {separarUuids(uuidsRelacion).join(", ") || "—"}
                </p>
              )}
              {previa.avisos.length > 0 && <p style={{ fontSize: 12, color: "#A32D2D", margin: "8px 0 0" }}>{previa.avisos[0]}</p>}
              <p style={{ fontSize: 11, color: "#888", margin: "10px 0 0" }}>Vista previa sin valor fiscal: el folio, el UUID y los sellos se generan al timbrar.</p>
            </div>
            <div className="fac-facturar-botones">
              <button type="button" className="fac-facturar-previa" onClick={() => setPrevia(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {menuFila && (() => {
        const h = menuFila.f;
        const d = datosFila(h);
        const base = "/facturas-admin/estados-de-cuenta/" + h.id;
        const puedeCancelarH = !!h.uuid_cfdi && !d.cancelada && h.cancelacion_estatus !== "en_proceso" && rolPuede(rol, "facturaCancelar");
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 1190 }} onClick={() => setMenuFila(null)} />
            <div className="fac-acciones-menu no-imprimir" role="menu" style={{ position: "fixed", left: menuFila.x, top: menuFila.y, right: "auto", zIndex: 1200 }} onClick={() => setMenuFila(null)}>
              {h.archivo_url ? (
                <button type="button" role="menuitem" onClick={() => setPdfVisor({ id: h.id, titulo: d.facturaElectronica || h.folio })}>
                  Ver
                </button>
              ) : d.simulada ? (
                <a role="menuitem" href={base + "?formato=1"}>
                  Ver
                </a>
              ) : (
                <a role="menuitem" href={base} title="Todavía no tiene factura timbrada: abre el estado de cuenta">
                  Ver
                </a>
              )}
              {h.id === factura.id ? (
                <button type="button" role="menuitem" onClick={imprimir}>
                  Imprimir
                </button>
              ) : (
                <a role="menuitem" href={base + "?imprimir=1"}>
                  Imprimir
                </a>
              )}
              {d.pendientes > 0 && !d.cancelada && rolPuede(rol, "pagosMarcarPagado") ? (
                <a role="menuitem" href={base + "?pago=1"}>
                  Generar pago
                </a>
              ) : (
                <button type="button" role="menuitem" disabled title="No hay pagos pendientes">
                  Generar pago
                </button>
              )}
              {h.archivo_url ? (
                <a role="menuitem" href={"/api/facturas/descargar?id=" + h.id + "&tipo=pdf"}>
                  Descarga PDF
                </a>
              ) : (
                <button type="button" role="menuitem" disabled title="Sin PDF">
                  Descarga PDF
                </button>
              )}
              {h.xml_url ? (
                <a role="menuitem" href={"/api/facturas/descargar?id=" + h.id + "&tipo=xml"}>
                  Descarga XML
                </a>
              ) : (
                <button type="button" role="menuitem" disabled title="Sin XML">
                  Descarga XML
                </button>
              )}
              <button type="button" role="menuitem" disabled={!puedeCancelarH} title={!h.uuid_cfdi ? "Todavía no está timbrada" : !rolPuede(rol, "facturaCancelar") ? "Solo cobranza y administración pueden cancelar" : ""} onClick={() => abrirCancelar(h)}>
                Cancelar timbrado
              </button>
              <button type="button" role="menuitem" disabled title="Disponible cuando Facturapi esté activo">
                Refacturar cancelando la anterior
              </button>
              {d.simulada ? (
                <a role="menuitem" href={base + "?formato=1"}>
                  Reimprime (formato simulado)
                </a>
              ) : h.archivo_url ? (
                <a role="menuitem" href={"/api/facturas/descargar?id=" + h.id + "&tipo=pdf"}>
                  Reimprime
                </a>
              ) : (
                <button type="button" role="menuitem" disabled title="Todavía no hay factura timbrada">
                  Reimprime
                </button>
              )}
              <a role="menuitem" href={"/facturas-admin/timbradas?cliente=" + (h.user_id || "") + "&centro=" + encodeURIComponent(h.centro || "")}>
                Facturas generadas
              </a>
            </div>
          </>
        );
      })()}

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
            <iframe className="fac-previa-pdf" src={"/api/facturas/descargar?id=" + pdfVisor.id + "&tipo=pdf&ver=1"} title={"Factura " + pdfVisor.titulo} />
            <div className="fac-facturar-botones">
              <a className="btn-exportar fac-naranja" href={"/api/facturas/descargar?id=" + pdfVisor.id + "&tipo=pdf"}>
                Descargar PDF
              </a>
              <button type="button" className="ft-btn-sec" onClick={() => setPdfVisor(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelar && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !cancelando && setCancelar(null)}
        >
          <div className="form-card fac-facturar" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={cancelando} onClick={() => setCancelar(null)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Cancelar factura</h2>
            <p className="fac-facturar-sub">
              {cancelar.serie ? cancelar.serie + "-" : ""}
              {cancelar.folio_fiscal || cancelar.folio} · {dinero(Number(cancelar.monto))}
            </p>
            <div className="fac-facturar-fila">
              <label>Motivo</label>
              <div>
                <select value={motivoCan} onChange={(e) => setMotivoCan(e.target.value)}>
                  <option value=""></option>
                  <option value="01">{MOTIVOS_NOMBRE["01"]}</option>
                  <option value="02">{MOTIVOS_NOMBRE["02"]}</option>
                  <option value="03">{MOTIVOS_NOMBRE["03"]}</option>
                  <option value="04">{MOTIVOS_NOMBRE["04"]}</option>
                </select>
              </div>
            </div>
            {motivoCan === "01" && (
              <div className="fac-facturar-fila">
                <label>Folio de sustitución</label>
                <div>
                  <input type="text" placeholder="Folio de la factura que la sustituye (ej. A-9779)" value={folioSust} onChange={(e) => setFolioSust(e.target.value)} />
                  <p className="fac-facturar-nota">La factura nueva que la reemplaza: escribe su serie y folio (o su UUID).</p>
                </div>
              </div>
            )}
            <p style={{ fontSize: 12, color: "#A32D2D", margin: "6px 0 0" }}>Esta acción no se puede deshacer. Si el cliente tiene que aceptarla, queda "en proceso" hasta que responda.</p>
            {errorCan && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{errorCan}</p>}
            <div className="fac-facturar-botones">
              <button type="button" className="btn-exportar fac-naranja" disabled={cancelando || !motivoCan} onClick={confirmarCancelacion}>
                {cancelando ? "Cancelando..." : "Cancelar factura"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exito && (
        <div className="modal-overlay no-imprimir" onClick={() => setExito(false)}>
          <div className="invitado-exito-card" onClick={(e) => e.stopPropagation()}>
            <div className="invitado-confetti">
              {confeti.map((c, i) => (
                <span key={i} className="invitado-confetti-pieza" style={{ left: c.left + "%", animationDuration: c.dur + "s", animationDelay: c.delay + "s", background: c.color }} />
              ))}
            </div>
            <div className="invitado-exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="invitado-exito-titulo">¡Factura generada con éxito!</p>
            <p className="invitado-exito-mensaje">
              {factura?.serie ? factura.serie + "-" : ""}
              {factura?.folio_fiscal || factura?.folio}
              {simulada ? " · SIMULADA de prueba, sin valor fiscal" : ""}
            </p>
            <button
              className="invitado-exito-btn"
              onClick={() => {
                setExito(false);
                setPestana("historial");
              }}
            >
              Ir a factura generada
            </button>
          </div>
        </div>
      )}

      {modalEditar && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !accionando && setModalEditar(false)}
        >
          <div className="form-card" style={{ maxWidth: 460, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p className="contrato-cliente-nombre">Editar concepto y fecha</p>
            <p className="sub-label" style={{ marginTop: 10 }}>
              Concepto
            </p>
            <textarea rows={3} maxLength={200} value={conceptoEdit} onChange={(e) => setConceptoEdit(e.target.value)} />
            <p className="sub-label" style={{ marginTop: 8 }}>
              Fecha (vence 10 días después)
            </p>
            <input type="date" value={fechaEdit} onChange={(e) => setFechaEdit(e.target.value)} />
            {errorModal && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn-exportar fac-naranja" disabled={accionando} onClick={guardarEdicion}>
                {accionando ? "Guardando..." : "Guardar"}
              </button>
              <button className="tel-borrar-btn" disabled={accionando} onClick={() => setModalEditar(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalPago && (
        <div
          className="no-imprimir"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !accionando && setModalPago(false)}
        >
          <div className="form-card" style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <p className="contrato-cliente-nombre">Crear pago</p>
            <p style={{ fontSize: 12, color: "#666", margin: "4px 0 10px" }}>
              Marca como pagado lo que el cliente ya liquidó. {timbrada && factura?.metodo_pago === "PPD" ? "Como la factura es a pago diferido, se emite el complemento de pago de cada uno." : "No emite factura: se timbra después desde Acciones."}
            </p>
            {pagosPendientes.map((p) => (
              <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0" }}>
                <input type="checkbox" checked={pagosSel.includes(p.id)} onChange={(e) => setPagosSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                {etiquetaPagoSuelto(p.concepto)} · {dinero(Number(p.monto))}
              </label>
            ))}
            <p className="sub-label" style={{ marginTop: 10 }}>
              ¿Cómo pagó?
            </p>
            <select value={formaPagoReg} onChange={(e) => setFormaPagoReg(e.target.value)}>
              <option value="01">Efectivo</option>
              <option value="03">Transferencia electrónica</option>
              <option value="04">Tarjeta de crédito</option>
            </select>
            {errorModal && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{errorModal}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn-exportar fac-naranja" disabled={accionando} onClick={guardarPago}>
                {accionando ? "Registrando..." : "Registrar pago"}
              </button>
              <button className="tel-borrar-btn" disabled={accionando} onClick={() => setModalPago(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
