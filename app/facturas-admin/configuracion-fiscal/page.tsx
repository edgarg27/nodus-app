"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rolPuede } from "@/lib/permisosApi";
import {
  CAMPOS_DOMICILIO_FISCAL,
  DOMICILIO_FISCAL_VACIO,
  REGIMENES_FISCALES,
  avisosDatosFiscales,
  domicilioDePerfil,
  normalizarRfc,
  textoDomicilioFiscal,
  usosParaTipo,
  type CampoDomicilioFiscal,
} from "@/lib/datosFiscales";
import Link from "next/link";
import { conceptoDelPeriodo, tieneMes } from "@/lib/conceptoFactura";
import { MAXIMO_CORREOS_EXTRA, correosExtraDe } from "@/lib/correosFactura";
import { correoVisible } from "@/lib/correoFicticio";
import { METODOS_PAGO, textoPagoHabitual } from "@/lib/pagoHabitual";
import { FORMAS_PAGO_SAT } from "@/lib/formasPagoSat";
import { hoyMexicoISO } from "@/lib/fechaMexico";

// Configuración fiscal: los datos fiscales de cada cliente, con los que se timbran sus facturas. La administradora los
// captura en el alta o aquí; Finanzas los revisa y los corrige si vienen con errores o si la empresa los cambió.

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type ClienteFiscal = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  nombre_fiscal: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  cp_fiscal: string | null;
  uso_cfdi: string | null;
  concepto_factura?: string | null;
  correos_factura?: string[] | null;
  metodo_pago_habitual?: string | null;
  forma_pago_habitual?: string | null;
  porContrato?: boolean;
} & Partial<Record<CampoDomicilioFiscal, string | null>>;

export default function ConfiguracionFiscalPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [centro, setCentro] = useState("");
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [soloConPendientes, setSoloConPendientes] = useState(false);
  const [editando, setEditando] = useState<ClienteFiscal | null>(null);
  const [form, setForm] = useState({ rfc: "", nombre_fiscal: "", regimen_fiscal: "", cp_fiscal: "", uso_cfdi: "G03", concepto_factura: "", correos_factura: "", ...DOMICILIO_FISCAL_VACIO });
  // Cómo saldría el concepto el mes que entra, para que se vea que el mes cambia solo.
  const hoy = hoyMexicoISO();
  const mesSiguiente = Number(hoy.slice(5, 7)) === 12 ? { mes: 1, anio: Number(hoy.slice(0, 4)) + 1 } : { mes: Number(hoy.slice(5, 7)) + 1, anio: Number(hoy.slice(0, 4)) };
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  // "Pago habitual": cómo paga normalmente el cliente; se propone al integrar por lote, al timbrar y en Cobranza.
  const [editandoPago, setEditandoPago] = useState<ClienteFiscal | null>(null);
  const [formPago, setFormPago] = useState({ metodo: "", forma: "" });
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [errorPago, setErrorPago] = useState("");

  function abrirPago(c: ClienteFiscal) {
    setEditandoPago(c);
    setFormPago({ metodo: c.metodo_pago_habitual || "", forma: c.forma_pago_habitual || "" });
    setErrorPago("");
  }

  async function guardarPago() {
    if (!editandoPago) return;
    setGuardandoPago(true);
    setErrorPago("");
    const res = await fetch("/api/facturas/pago-habitual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editandoPago.id, ...formPago }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardandoPago(false);
    if (!res.ok) return setErrorPago(data.error || "No se pudo guardar");
    setClientes((cs) => cs.map((x) => (x.id === editandoPago.id ? { ...x, ...data.datos } : x)));
    setEditandoPago(null);
  }

  const esGlobal = ROLES_GLOBALES.includes(rol);
  const puedeEditar = rolPuede(rol, "facturaEmitir");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
      setRol(yo?.rol || "");
      setCentro(yo?.centro || CENTROS[0]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar(c: string) {
    setCargando(true);
    const res = await fetch("/api/facturas/clientes?centro=" + encodeURIComponent(c));
    const data = await res.json().catch(() => ({}));
    setClientes((data.clientes as ClienteFiscal[]) || []);
    setCargando(false);
  }

  useEffect(() => {
    if (centro) cargar(centro);
  }, [centro]);

  const estadoDe = (c: ClienteFiscal): { tipo: string; texto: string; detalle?: string } => {
    const completos = !!(c.rfc && c.nombre_fiscal && c.regimen_fiscal && c.cp_fiscal);
    if (!completos) return { tipo: "roja", texto: "Faltan datos" };
    const avisos = avisosDatosFiscales(c);
    if (avisos.length > 0) return { tipo: "ambar", texto: "Revisar", detalle: avisos[0] };
    return { tipo: "verde", texto: "Completos" };
  };

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    return clientes.filter((c) => {
      if (q && !sinAcentos([c.nombre, c.email, c.empresa, c.nombre_fiscal, c.rfc].filter(Boolean).join(" ")).includes(q)) return false;
      if (soloConPendientes && estadoDe(c).tipo === "verde") return false;
      return true;
    });
  }, [clientes, busqueda, soloConPendientes]);

  function abrir(c: ClienteFiscal) {
    setEditando(c);
    setForm({
      rfc: c.rfc || "",
      nombre_fiscal: c.nombre_fiscal || "",
      regimen_fiscal: c.regimen_fiscal || "",
      cp_fiscal: c.cp_fiscal || "",
      uso_cfdi: c.uso_cfdi || "G03",
      concepto_factura: c.concepto_factura || "",
      correos_factura: correosExtraDe(c).join("\n"),
      ...domicilioDePerfil(c),
    });
    setError("");
  }

  const tipoForm = normalizarRfc(form.rfc).length === 12 ? "moral" : "fisica";
  const avisosForm = avisosDatosFiscales({ rfc: form.rfc, nombre_fiscal: form.nombre_fiscal, regimen_fiscal: form.regimen_fiscal });

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    setError("");
    const res = await fetch("/api/facturas/datos-fiscales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editando.id, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) return setError(data.error || "No se pudo guardar");
    setEditando(null);
    setAviso(`✓ Datos fiscales de ${data.datos?.nombre_fiscal || "el cliente"} actualizados. Las próximas facturas salen con estos datos.`);
    cargar(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/facturas-admin">
          ← Facturación
        </Link>
        <p className="rep-title">Configuración fiscal</p>
        <p className="rep-sub">Datos fiscales de los clientes, con los que se timbran sus facturas</p>
      </div>

      <div className="rep-content rep-content-completo">
        <div className="ft-card">
          <div className="ft-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label className="ft-campo">
              <span>Centro</span>
              <select value={centro} disabled={!esGlobal} onChange={(e) => setCentro(e.target.value)}>
                {(esGlobal ? CENTROS : [centro]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="ft-campo">
              <span>Buscar</span>
              <input placeholder="Cliente, razón social o RFC..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
            <label className="ft-campo" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 26 }}>
              <input type="checkbox" style={{ width: "auto", height: "auto" }} checked={soloConPendientes} onChange={(e) => setSoloConPendientes(e.target.checked)} />
              <span>Solo los que faltan o hay que revisar</span>
            </label>
          </div>
          {!puedeEditar && <p style={{ fontSize: 12, color: "#888", margin: "0 20px 14px" }}>Puedes consultar; solo finanzas y administración pueden cambiar los datos.</p>}
        </div>

        {aviso && (
          <div className="form-card" style={{ marginTop: 10, fontSize: 13 }}>
            {aviso}
            <button className="tel-borrar-btn" style={{ marginLeft: 8 }} onClick={() => setAviso("")}>
              Cerrar
            </button>
          </div>
        )}

        <div className="ft-card ft-resultados">
          {cargando ? (
            <div className="ft-vacio">Cargando...</div>
          ) : visibles.length === 0 ? (
            <div className="ft-vacio">Ningún cliente coincide</div>
          ) : (
            <div className="ft-tabla-wrap" style={{ borderTop: "none" }}>
              <table className="ft-tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Razón social</th>
                    <th>RFC</th>
                    <th>Régimen</th>
                    <th>C.P.</th>
                    <th>Domicilio</th>
                    <th>Uso CFDI</th>
                    <th>Pago habitual</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c) => {
                    const e = estadoDe(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <b>{c.nombre}</b>
                          <span className="fac-sub">{c.email}</span>
                          {correosExtraDe(c).length > 0 && <span className="fac-sub">+ {correosExtraDe(c).join(", ")}</span>}
                          {c.porContrato && <span className="fac-sub">Contrato en este centro</span>}
                        </td>
                        <td>
                          {c.nombre_fiscal || "—"}
                          {c.concepto_factura && <span className="fac-sub">Concepto: {c.concepto_factura}</span>}
                        </td>
                        <td className="ft-nowrap">{c.rfc || "—"}</td>
                        <td>{c.regimen_fiscal || "—"}</td>
                        <td className="ft-nowrap">{c.cp_fiscal || "—"}</td>
                        <td>{textoDomicilioFiscal(c) || "—"}</td>
                        <td className="ft-nowrap">{c.uso_cfdi || "—"}</td>
                        <td>
                          {puedeEditar ? (
                            <button type="button" className="ft-btn-sec" style={{ whiteSpace: "normal", textAlign: "left" }} onClick={() => abrirPago(c)}>
                              {textoPagoHabitual(c) || "Elegir"}
                            </button>
                          ) : (
                            textoPagoHabitual(c) || "—"
                          )}
                        </td>
                        <td>
                          <span className={"ft-chip ft-chip-" + e.tipo} title={e.detalle || ""}>
                            {e.texto}
                          </span>
                        </td>
                        <td>
                          {puedeEditar && (
                            <button type="button" className="ft-btn-sec" onClick={() => abrir(c)}>
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editandoPago && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !guardandoPago && setEditandoPago(null)}
        >
          <div className="form-card fac-facturar" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={guardandoPago} onClick={() => setEditandoPago(null)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Pago habitual</h2>
            <p className="fac-facturar-sub">{editandoPago.nombre_fiscal || editandoPago.empresa || editandoPago.nombre}</p>
            <div className="fac-facturar-fila">
              <label>Método de pago</label>
              <div>
                <select value={formPago.metodo} onChange={(e) => setFormPago({ ...formPago, metodo: e.target.value })}>
                  <option value="">Según su estado (pagado PUE · pendiente PPD)</option>
                  {METODOS_PAGO.map((m) => (
                    <option key={m.clave} value={m.clave}>
                      {m.texto}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Forma de pago</label>
              <div>
                <select value={formPago.forma} onChange={(e) => setFormPago({ ...formPago, forma: e.target.value })}>
                  <option value="">Sin definir</option>
                  {FORMAS_PAGO_SAT.filter((f) => f.clave !== "99").map((f) => (
                    <option key={f.clave} value={f.clave}>
                      {f.clave} · {f.texto}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="fac-facturar-nota">Se propone al integrar por lote, al timbrar desde su estado de cuenta y al registrar su pago en Cobranza; ahí se puede cambiar.</p>
            {errorPago && <p style={{ fontSize: 13, color: "#A32D2D", margin: "8px 0 0" }}>{errorPago}</p>}
            <div className="fac-facturar-botones">
              <button type="button" className="btn-exportar fac-naranja" disabled={guardandoPago} onClick={guardarPago}>
                {guardandoPago ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !guardando && setEditando(null)}
        >
          <div className="form-card fac-facturar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={guardando} onClick={() => setEditando(null)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Datos fiscales</h2>
            <p className="fac-facturar-sub">
              {editando.nombre} · {editando.email}
            </p>
            <div className="fac-facturar-fila">
              <label>RFC *</label>
              <div>
                <input type="text" maxLength={13} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} />
                <p className="fac-facturar-nota">{tipoForm === "moral" ? "12 caracteres: persona moral (empresa)" : "13 caracteres: persona física"}</p>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Razón social *</label>
              <div>
                <input type="text" maxLength={200} value={form.nombre_fiscal} onChange={(e) => setForm({ ...form, nombre_fiscal: e.target.value.toUpperCase() })} />
                <p className="fac-facturar-nota">Tal como aparece en la Constancia de Situación Fiscal, sin "S.A. DE C.V.".</p>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Régimen fiscal *</label>
              <div>
                <select value={form.regimen_fiscal} onChange={(e) => setForm({ ...form, regimen_fiscal: e.target.value })}>
                  <option value="">Elige el régimen</option>
                  {REGIMENES_FISCALES.filter((r) => r.aplica.includes(tipoForm)).map((r) => (
                    <option key={r.clave} value={r.clave}>
                      {r.clave} · {r.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>C.P. fiscal *</label>
              <div>
                <input type="text" inputMode="numeric" maxLength={5} value={form.cp_fiscal} onChange={(e) => setForm({ ...form, cp_fiscal: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Uso del CFDI *</label>
              <div>
                <select value={form.uso_cfdi} onChange={(e) => setForm({ ...form, uso_cfdi: e.target.value })}>
                  {usosParaTipo(tipoForm).map((u) => (
                    <option key={u.clave} value={u.clave}>
                      {u.clave} · {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="fac-facturar-seccion">Domicilio fiscal (como en la Constancia)</p>
            {CAMPOS_DOMICILIO_FISCAL.map((c) => (
              <div className="fac-facturar-fila" key={c.campo}>
                <label>{c.label}</label>
                <div>
                  <input
                    type="text"
                    maxLength={200}
                    placeholder={c.placeholder}
                    value={form[c.campo]}
                    onChange={(e) => setForm({ ...form, [c.campo]: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            ))}
            <p className="fac-facturar-seccion">Correos para sus facturas</p>
            <div className="fac-facturar-fila">
              <label>Correos adicionales</label>
              <div>
                <textarea
                  rows={2}
                  placeholder="Opcional: uno por renglón (ej. contabilidad@empresa.com)"
                  value={form.correos_factura}
                  onChange={(e) => setForm({ ...form, correos_factura: e.target.value })}
                />
                <p className="fac-facturar-nota">
                  La factura y el estado de cuenta siempre van a {correoVisible(editando.email) || "su correo"}; además, a estos (hasta {MAXIMO_CORREOS_EXTRA}).
                </p>
              </div>
            </div>
            <p className="fac-facturar-seccion">Concepto de sus facturas</p>
            <div className="fac-facturar-fila">
              <label>Concepto predefinido</label>
              <div>
                <textarea
                  rows={2}
                  maxLength={200}
                  placeholder="Ej. Prestación de servicios de OFICINA 4, Noviembre del 2026"
                  value={form.concepto_factura}
                  onChange={(e) => setForm({ ...form, concepto_factura: e.target.value })}
                />
                <p className="fac-facturar-nota">
                  {!form.concepto_factura.trim()
                    ? "Vacío: se usa el concepto que arma el sistema."
                    : tieneMes(form.concepto_factura)
                      ? `El mes cambia solo en cada factura. El mes que entra: "${conceptoDelPeriodo(form.concepto_factura, mesSiguiente.mes, mesSiguiente.anio)}"`
                      : "No lleva mes: todas sus facturas saldrán con este mismo texto. Si escribes el mes (ej. Noviembre del 2026), cambia solo cada mes."}
                </p>
              </div>
            </div>
            {avisosForm.length > 0 && <p style={{ fontSize: 12, color: "#854F0B", margin: "6px 0 0" }}>{avisosForm[0]}</p>}
            {error && <p style={{ fontSize: 13, color: "#A32D2D", margin: "8px 0 0" }}>{error}</p>}
            <p className="fac-facturar-nota">Aplica a las facturas que se emitan desde ahora. Las ya timbradas no cambian: si estaban mal, se cancelan y se vuelven a emitir.</p>
            <div className="fac-facturar-botones">
              <button type="button" className="btn-exportar fac-naranja" disabled={guardando} onClick={guardar}>
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
