"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { rolPuede } from "@/lib/permisosApi";
import { serieCentro } from "@/lib/centros";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";
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
  const faltanDatos = !!cliente && !(cliente.rfc && cliente.nombre_fiscal && cliente.regimen_fiscal && cliente.cp_fiscal);

  async function timbrar() {
    if (!factura) return;
    setErrorTimbrar("");
    if (metodo === "PUE" && !FORMAS_PAGO_COMPLEMENTO.some((f) => f.clave === formaPago)) return setErrorTimbrar("Elige la forma de pago");
    setTimbrando(true);
    const res = await fetch("/api/facturas/facturar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facturaIds: [factura.id], metodo, formaPago: metodo === "PUE" ? formaPago : undefined }),
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
                  <button type="button" className="btn-exportar" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
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
          <div className="form-card" style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <p className="contrato-cliente-nombre">Timbrar factura {factura.folio}</p>
            <p style={{ fontSize: 13, color: "#555", margin: "4px 0 10px" }}>
              {cliente ? cliente.nombre_fiscal || cliente.empresa || cliente.nombre : ""} · {dinero(total)}
            </p>
            <p className="sub-label">Método de pago</p>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as "PUE" | "PPD")}>
              <option value="PPD">PPD · pago diferido (se paga después)</option>
              <option value="PUE">PUE · pago en una sola exhibición (ya se pagó)</option>
            </select>
            {metodo === "PUE" && (
              <>
                <p className="sub-label" style={{ marginTop: 8 }}>
                  Forma de pago
                </p>
                <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                  {FORMAS_PAGO_COMPLEMENTO.map((f) => (
                    <option key={f.clave} value={f.clave}>
                      {f.texto}
                    </option>
                  ))}
                </select>
              </>
            )}
            {(faltanDatos || avisos.length > 0) && (
              <p style={{ fontSize: 12, color: "#A32D2D", margin: "10px 0 0" }}>
                {faltanDatos ? "Al cliente le faltan datos fiscales (RFC, razón social, régimen o código postal): no se podrá timbrar." : avisos[0]}
              </p>
            )}
            {errorTimbrar && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{errorTimbrar}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn-exportar" disabled={timbrando || faltanDatos} onClick={timbrar}>
                {timbrando ? "Timbrando..." : "Timbrar"}
              </button>
              <button className="tel-borrar-btn" disabled={timbrando} onClick={() => setModalTimbrar(false)}>
                Cancelar
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
              <button className="btn-exportar" disabled={accionando} onClick={guardarEdicion}>
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
              <button className="btn-exportar" disabled={accionando} onClick={guardarPago}>
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
