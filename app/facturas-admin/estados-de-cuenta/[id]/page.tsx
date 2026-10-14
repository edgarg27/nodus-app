"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { rolPuede } from "@/lib/permisosApi";
import { serieCentro } from "@/lib/centros";
import { FORMAS_PAGO_SAT, PERIODICIDADES, TIPOS_RELACION, REGEX_UUID, separarUuids } from "@/lib/formasPagoSat";
import { EMISOR } from "@/lib/emisor";
import type { PreviaFactura } from "@/lib/facturarCobro";
import { avisosDatosFiscales } from "@/lib/datosFiscales";

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
};
type Pago = { id: string; concepto: string | null; monto: number; estado: string; adicional_tipo: string | null; created_at: string };
type Cliente = { nombre: string; email: string; empresa: string | null; nombre_fiscal: string | null; rfc: string | null; regimen_fiscal: string | null; cp_fiscal: string | null };
type Complemento = { id: string; serie: string | null; folio_fiscal: string | null; fecha_pago: string; monto: number; uuid_cfdi: string | null; cancelacion_estatus: string | null; importe: number };

const ESTADO_PAGO: Record<string, string> = { pendiente: "Pendiente", pagado: "Pagado", cancelado: "Cancelado" };

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
  const [previa, setPrevia] = useState<{ previa: PreviaFactura; avisos: string[] } | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [aviso, setAviso] = useState("");
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
      f.user_id ? supabase.from("profiles").select("nombre, email, empresa, nombre_fiscal, rfc, regimen_fiscal, cp_fiscal").eq("id", f.user_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("complemento_pago_facturas").select("complemento_id, importe").eq("factura_id", id),
    ]);
    setPagos((ps as Pago[]) || []);
    setCliente((cl as Cliente | null) || null);
    const compIds = (filas || []).map((x) => x.complemento_id);
    if (compIds.length > 0) {
      const { data: cs } = await supabase.from("complementos_pago").select("id, serie, folio_fiscal, fecha_pago, monto, uuid_cfdi, cancelacion_estatus").in("id", compIds);
      setComplementos(((cs as Omit<Complemento, "importe">[]) || []).map((c) => ({ ...c, importe: Number((filas || []).find((x) => x.complemento_id === c.id)?.importe || 0) })));
    } else setComplementos([]);
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
  const sePuedeTimbrar = !!factura && !timbrada && !!factura.user_id && factura.estado !== "cancelada";
  const avisos = cliente ? avisosDatosFiscales(cliente) : [];
  const esPublicoGeneral = cliente?.rfc === "XAXX010101000";
  const faltanDatos = !!cliente && !(cliente.rfc && cliente.nombre_fiscal && cliente.regimen_fiscal && cliente.cp_fiscal);

  // Valida lo del cuadro Facturar; devuelve el mensaje de error o "".
  function validarFacturar(): string {
    if (!condiciones.trim()) return "Escribe las condiciones de pago";
    if (metodo === "PUE" && !FORMAS_PAGO_SAT.some((f) => f.clave === formaPago)) return "Elige la forma de pago";
    if (tipoRelacion) {
      const uuids = separarUuids(uuidsRelacion);
      if (uuids.length === 0) return "Escribe el UUID del CFDI relacionado";
      if (uuids.some((u) => !REGEX_UUID.test(u))) return "Algún UUID del CFDI relacionado no es válido (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)";
    }
    return "";
  }

  async function verPrevia() {
    if (!factura) return;
    setErrorTimbrar("");
    setCargandoPrevia(true);
    const res = await fetch("/api/facturas/vista-previa?facturaId=" + factura.id);
    const data = await res.json().catch(() => ({}));
    setCargandoPrevia(false);
    if (!res.ok) return setErrorTimbrar(data.error || "No se pudo armar la vista previa");
    setPrevia({ previa: data.previa, avisos: data.avisos || [] });
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
      body: JSON.stringify({
        facturaIds: [factura.id],
        metodo,
        formaPago: metodo === "PUE" ? formaPago : undefined,
        condicionesPago: condiciones.trim(),
        periodicidad: esPublicoGeneral ? periodicidad : undefined,
        relacion: tipoRelacion ? { tipo: tipoRelacion, uuids: separarUuids(uuidsRelacion) } : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setTimbrando(false);
    const r = (data.resultados || [])[0];
    if (!res.ok || (r && !r.ok)) return setErrorTimbrar(r?.error || data.error || "No se pudo timbrar");
    setModalTimbrar(false);
    setAviso(`✓ Factura timbrada (${metodo}).`);
    cargar();
  }

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
        <a className="rep-back" href="/facturas-admin/estados-de-cuenta">
          ← Estados de cuenta
        </a>
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
                    ☰ Acciones ▾
                  </button>
                  {menu && (
                    <div className="fac-acciones-menu" role="menu" onClick={() => setMenu(false)}>
                      <button type="button" role="menuitem" disabled={!cliente?.email || accionando} onClick={enviar}>
                        ✉ Enviar estado de cuenta
                      </button>
                      <button type="button" role="menuitem" onClick={imprimir}>
                        🖨 Imprimir estado de cuenta
                      </button>
                      <button type="button" role="menuitem" disabled={!editable} title={editable ? "" : "Ya está timbrada o cancelada"} onClick={abrirEditar}>
                        ✎ Editar concepto y fecha de estado de cuenta
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
                      {factura.archivo_url ? (
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
                      {timbrada && (
                        <a role="menuitem" href="/facturas-admin/timbradas">
                          Complemento o cancelación (Facturas timbradas)
                        </a>
                      )}
                      <button type="button" role="menuitem" disabled={!(puedeTimbrar && sePuedeTimbrar)} title={timbrada ? "Ya está timbrada" : !puedeTimbrar ? "Solo cobranza y administración pueden timbrar" : ""} onClick={abrirTimbrar}>
                        🔔 Generar factura electrónica
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
                            ? `Timbrada ${factura.metodo_pago || ""} · ${factura.serie ? factura.serie + "-" + (factura.folio_fiscal || "") : ""}`
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
                  {!timbrada ? (
                    <p style={{ fontSize: 13, color: "#888", padding: 12, margin: 0 }}>Todavía no se ha timbrado. Usa Acciones → Timbrar factura.</p>
                  ) : (
                    <table className="fac-tabla" style={{ minWidth: 640 }}>
                      <thead>
                        <tr>
                          <th>Serie-Folio</th>
                          <th>Tipo</th>
                          <th>Fecha</th>
                          <th className="fac-num">Total</th>
                          <th>UUID</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="fac-nowrap">
                            <b>{factura.serie ? factura.serie + "-" + (factura.folio_fiscal || "") : factura.folio}</b>
                          </td>
                          <td>Ingreso {factura.metodo_pago || ""}</td>
                          <td className="fac-nowrap">{factura.fecha_emision}</td>
                          <td className="fac-num fac-nowrap">{dinero(total)}</td>
                          <td style={{ wordBreak: "break-all", fontSize: 12 }}>{factura.uuid_cfdi}</td>
                          <td>{factura.cancelacion_estatus === "cancelada" ? "Cancelada" : factura.cancelacion_estatus === "en_proceso" ? "Cancelación en proceso" : "Emitida"}</td>
                        </tr>
                        {complementos.map((c) => (
                          <tr key={c.id}>
                            <td className="fac-nowrap">
                              <b>{c.serie ? c.serie + "-" + (c.folio_fiscal || "") : c.folio_fiscal || "—"}</b>
                            </td>
                            <td>Pago (complemento)</td>
                            <td className="fac-nowrap">{c.fecha_pago}</td>
                            <td className="fac-num fac-nowrap">{dinero(c.importe)}</td>
                            <td style={{ wordBreak: "break-all", fontSize: 12 }}>{c.uuid_cfdi}</td>
                            <td>{c.cancelacion_estatus === "cancelada" ? "Cancelado" : "Emitido"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                      <td>{previa.previa.serie ? previa.previa.serie + "-(se asigna al timbrar)" : "(se asigna al timbrar)"}</td>
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
