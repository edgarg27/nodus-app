"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { UBICACION_POR_CENTRO, serieCentro } from "@/lib/centros";
import { conceptoParaCliente } from "@/lib/adicionales";
import { useCatalogoServicios } from "@/app/components/useCatalogoServicios";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";
import { DATOS_PUBLICO_GENERAL } from "@/lib/datosFiscales";

// Formulario "Nueva factura": centro → cliente (por razón social) → qué se factura y cuánto →
// cómo se factura (método y forma de pago). Tres acciones: Vista previa, Integrar factura (guarda
// el cobro sin timbrar) y Timbrar (lo emite ante el SAT con Facturapi).

const CENTROS = Object.keys(UBICACION_POR_CENTRO);
const DIAS_PARA_PAGAR = 10;
const EMISOR = { nombre: "NBC COMPANY", rfc: "NBC171012LX7" };

type ClienteForm = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  nombre_fiscal: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  cp_fiscal: string | null;
  uso_cfdi: string | null;
};

type PagoSuelto = { id: string; monto: number; concepto: string | null; estado: string; adicional_tipo: string | null };

const razonSocial = (c: ClienteForm) => c.nombre_fiscal || c.empresa || c.nombre;
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// El primer pago de un contrato se guarda con el concepto "Contrato": es el pago de la mensualidad.
function etiquetaPago(concepto: string | null) {
  const c = conceptoParaCliente(concepto, "Pago");
  return c.trim().toLowerCase() === "contrato" ? "Pago de mensualidad" : c;
}

function sumarDias(iso: string, dias: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
}

function Etiqueta({ texto, obligatorio }: { texto: string; obligatorio?: boolean }) {
  return (
    <p className="sub-label" style={{ marginBottom: 6 }}>
      {texto}
      {obligatorio && <span style={{ color: "#A32D2D" }}> *</span>}
    </p>
  );
}

export default function FormularioNuevaFactura({
  centroInicial,
  onCancelar,
  onListo,
}: {
  centroInicial: string;
  onCancelar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const supabase = createClient();
  const { servicios } = useCatalogoServicios();
  // Si la persona ya escribió el concepto o el monto, elegir un servicio no los pisa.
  const conceptoTocado = useRef(false);
  const montoTocado = useRef(false);
  const [centro, setCentro] = useState(CENTROS.includes(centroInicial) ? centroInicial : CENTROS[0]);
  const [clientes, setClientes] = useState<ClienteForm[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [publicoGeneral, setPublicoGeneral] = useState(false);

  const [pagosSueltos, setPagosSueltos] = useState<PagoSuelto[]>([]);
  const [pagosSel, setPagosSel] = useState<string[]>([]);

  const [tipo, setTipo] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [fechaEmision, setFechaEmision] = useState(hoyMexicoISO());
  const [metodo, setMetodo] = useState<"PUE" | "PPD">("PPD");
  const [formaPago, setFormaPago] = useState("03");
  const [yaPagada, setYaPagada] = useState(true);

  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState<"" | "integrar" | "timbrar">("");
  const [vistaPrevia, setVistaPrevia] = useState(false);
  // Si el cobro ya se integró pero falló el timbrado, un reintento solo timbra (no lo duplica).
  const [cobroIntegrado, setCobroIntegrado] = useState<string | null>(null);

  const serie = serieCentro(centro);
  const cliente = clientes.find((c) => c.id === clienteId) || null;
  const metodoEfectivo = publicoGeneral ? "PUE" : metodo;
  const montoNum = Number(monto);

  // Clientes del centro elegido.
  useEffect(() => {
    let vivo = true;
    setCargandoClientes(true);
    setClienteId("");
    setPublicoGeneral(false);
    setPagosSel([]);
    setCobroIntegrado(null);
    supabase
      .from("profiles")
      .select("id, nombre, email, empresa, nombre_fiscal, rfc, regimen_fiscal, cp_fiscal, uso_cfdi")
      .eq("rol", "cliente")
      .eq("centro", centro)
      .order("nombre")
      .then(({ data }) => {
        if (!vivo) return;
        setClientes((data as ClienteForm[]) || []);
        setCargandoClientes(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  // Pagos sueltos del cliente elegido (depósito, mensualidad…): se pueden ligar a esta factura.
  useEffect(() => {
    setPagosSel([]);
    setPagosSueltos([]);
    if (!clienteId) return;
    let vivo = true;
    supabase
      .from("pagos")
      .select("id, monto, concepto, estado, adicional_tipo")
      .eq("user_id", clienteId)
      .is("factura_id", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (vivo) setPagosSueltos((data as PagoSuelto[]) || []);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  const opciones = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    if (!q) return [];
    const pg = sinAcentos("Público en general").includes(q) || sinAcentos("publico general mostrador").includes(q);
    const cl = clientes
      .filter((c) => sinAcentos([c.nombre_fiscal, c.empresa, c.nombre, c.email, c.rfc].filter(Boolean).join(" ")).includes(q))
      .slice(0, 8);
    return [...(pg ? [{ tipo: "pg" as const, id: "pg", etiqueta: "Público en general" }] : []), ...cl.map((c) => ({ tipo: "cliente" as const, id: c.id, etiqueta: razonSocial(c) }))];
  }, [clientes, busqueda]);

  function alternarPago(id: string) {
    const nuevo = pagosSel.includes(id) ? pagosSel.filter((x) => x !== id) : [...pagosSel, id];
    setPagosSel(nuevo);
    // Al marcar pagos sueltos se rellenan el concepto, el monto y el tipo con lo que suman.
    const elegidos = pagosSueltos.filter((p) => nuevo.includes(p.id));
    if (elegidos.length === 0) return;
    setConcepto(elegidos.map((p) => etiquetaPago(p.concepto)).join(" + ").slice(0, 120));
    setMonto(String(Math.round(elegidos.reduce((s, p) => s + Number(p.monto), 0) * 100) / 100));
    conceptoTocado.current = false;
    montoTocado.current = false;
    const conTipo = elegidos.find((p) => p.adicional_tipo && servicios.some((s) => s.clave === p.adicional_tipo));
    if (conTipo) setTipo(conTipo.adicional_tipo as string);
  }

  // Al elegir un servicio se sugieren su concepto y su precio del catálogo.
  function elegirServicio(clave: string) {
    setTipo(clave);
    const s = servicios.find((x) => x.clave === clave);
    if (!s) return;
    if (!conceptoTocado.current && s.concepto) setConcepto(s.concepto);
    if (!montoTocado.current && s.precio != null) setMonto(String(s.precio));
  }

  function validar(): string {
    if (!publicoGeneral && !clienteId) return "Elige el cliente (o público en general)";
    if (!concepto.trim()) return "Escribe el concepto";
    if (!(montoNum > 0)) return "Escribe el monto";
    if (!publicoGeneral && !fechaEmision) return "Elige la fecha de emisión";
    if (metodoEfectivo === "PUE" && !FORMAS_PAGO_COMPLEMENTO.some((f) => f.clave === formaPago)) return "Elige la forma de pago";
    return "";
  }

  // Guarda el cobro (sin timbrar). Devuelve su id.
  async function integrarCobro(): Promise<string | null> {
    if (cobroIntegrado) return cobroIntegrado;
    const folio = `${serie || "FAC"}-${Date.now().toString().slice(-6)}`;
    const pagada = metodoEfectivo === "PUE" && yaPagada && pagosSel.length === 0;
    const { data, error: errInsert } = await supabase
      .from("facturas")
      .insert({
        user_id: clienteId,
        folio,
        concepto: concepto.trim(),
        monto: montoNum,
        fecha_emision: fechaEmision,
        fecha_vencimiento: sumarDias(fechaEmision, DIAS_PARA_PAGAR),
        estado: pagada ? "pagada" : "pendiente",
        centro,
        ...(tipo ? { adicional_tipo: tipo } : {}),
      })
      .select("id")
      .single();
    if (errInsert || !data) {
      setError("No se pudo guardar la factura. Intenta de nuevo.");
      return null;
    }
    if (pagosSel.length > 0) {
      await fetch("/api/pagos/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoIds: pagosSel, facturaId: data.id }),
      });
    }
    setCobroIntegrado(data.id);
    return data.id;
  }

  async function integrar() {
    setError("");
    const e = validar();
    if (e) return setError(e);
    if (publicoGeneral) return setError("Una venta a público en general se emite al momento: usa Timbrar");
    setTrabajando("integrar");
    const id = await integrarCobro();
    setTrabajando("");
    if (id) onListo(`Factura integrada para ${cliente ? razonSocial(cliente) : "el cliente"}. Puedes timbrarla desde la lista.`);
  }

  async function timbrar() {
    setError("");
    const e = validar();
    if (e) return setError(e);
    setTrabajando("timbrar");
    try {
      if (publicoGeneral) {
        const res = await fetch("/api/facturas/publico-general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ centro, concepto: concepto.trim(), monto: montoNum, formaPago, adicionalTipo: tipo || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setError(data.error || "No se pudo timbrar");
        return onListo(`Factura ${data.folio} timbrada a público en general (${centro}).`);
      }
      const id = await integrarCobro();
      if (!id) return;
      const res = await fetch("/api/facturas/facturar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturaIds: [id], metodo: metodoEfectivo, formaPago: metodoEfectivo === "PUE" ? formaPago : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      const r = (data.resultados || [])[0];
      if (!res.ok || (r && !r.ok)) {
        return setError(`La factura quedó integrada, pero no se pudo timbrar: ${r?.error || data.error || "error desconocido"}. Corrígelo y pulsa Timbrar otra vez.`);
      }
      onListo(`Factura timbrada (${metodoEfectivo}) para ${cliente ? razonSocial(cliente) : "el cliente"}.`);
    } finally {
      setTrabajando("");
    }
  }

  // ---- Vista previa ----
  const subtotal = montoNum > 0 ? Math.round((montoNum / 1.16) * 100) / 100 : 0;
  const iva = montoNum > 0 ? Math.round((montoNum - subtotal) * 100) / 100 : 0;
  const tipoInfo = servicios.find((s) => s.clave === tipo) || null;
  const faltanDatosFiscales = !publicoGeneral && !!cliente && !(cliente.rfc && cliente.nombre_fiscal && cliente.regimen_fiscal && cliente.cp_fiscal);
  const forma = FORMAS_PAGO_COMPLEMENTO.find((f) => f.clave === formaPago);

  function abrirVistaPrevia() {
    setError("");
    const e = validar();
    if (e) return setError(e);
    setVistaPrevia(true);
  }

  return (
    <form className="form-card form-factura-ancho" onSubmit={(e) => e.preventDefault()}>
      <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e", gridColumn: "1 / -1" }}>
        Nueva factura <span style={{ fontWeight: 400, color: "#888" }}>· los campos con * son obligatorios</span>
      </p>

      <div>
        <Etiqueta texto="Centro" obligatorio />
        <select value={centro} onChange={(e) => setCentro(e.target.value)}>
          {CENTROS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div style={{ gridColumn: "span 2" }}>
        <Etiqueta texto="Cliente (razón social a quien se factura)" obligatorio />
        {publicoGeneral ? (
          <div className="adicional-cliente-elegido">
            <span>{DATOS_PUBLICO_GENERAL.nombre_fiscal} · {centro}</span>
            <button type="button" className="tel-borrar-btn" onClick={() => setPublicoGeneral(false)}>
              Cambiar
            </button>
          </div>
        ) : cliente ? (
          <div className="adicional-cliente-elegido">
            <span>{razonSocial(cliente)}</span>
            <button
              type="button"
              className="tel-borrar-btn"
              onClick={() => {
                setClienteId("");
                setCobroIntegrado(null);
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder={cargandoClientes ? "Cargando clientes…" : `Busca por razón social o RFC en ${centro}; escribe "público en general" para una venta de mostrador`}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda.trim() && (
              <div className="adicional-resultados">
                {opciones.length === 0 ? (
                  <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Nada coincide en {centro}</p>
                ) : (
                  opciones.map((o) => (
                    <button
                      type="button"
                      key={o.tipo + o.id}
                      className="adicional-resultado"
                      onClick={() => {
                        setBusqueda("");
                        setCobroIntegrado(null);
                        if (o.tipo === "pg") {
                          setPublicoGeneral(true);
                          setClienteId("");
                          setMetodo("PUE");
                        } else {
                          setClienteId(o.id);
                        }
                      }}
                    >
                      {o.etiqueta}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <Etiqueta texto="Serie" />
        <input type="text" value={serie || "Sin serie (la de Facturapi)"} readOnly style={{ color: "#555" }} />
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>Según el centro. El folio se asigna al timbrar.</p>
      </div>

      {clienteId && pagosSueltos.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Etiqueta texto="Pagos de este cliente por facturar (al marcarlos se llenan el concepto y el monto)" />
          {pagosSueltos.map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, color: "#333" }}>
              <input type="checkbox" checked={pagosSel.includes(p.id)} onChange={() => alternarPago(p.id)} />
              {etiquetaPago(p.concepto)} · {dinero(Number(p.monto))} · {p.estado}
            </label>
          ))}
        </div>
      )}

      <div>
        <Etiqueta texto="Tipo de servicio" />
        <select value={tipo} onChange={(e) => elegirServicio(e.target.value)}>
          <option value="">Renta del espacio</option>
          {servicios.map((t) => (
            <option key={t.clave} value={t.clave}>
              {t.etiqueta}
            </option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>De aquí sale la clave del SAT.</p>
      </div>

      <div style={{ gridColumn: "span 2" }}>
        <Etiqueta texto="Concepto" obligatorio />
        <input
          type="text"
          placeholder="Ej. Renta de oficina de octubre"
          maxLength={120}
          value={concepto}
          onChange={(e) => {
            conceptoTocado.current = true;
            setConcepto(e.target.value);
          }}
        />
      </div>

      <div>
        <Etiqueta texto="Monto (con IVA)" obligatorio />
        <input
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          value={monto}
          onChange={(e) => {
            montoTocado.current = true;
            setMonto(e.target.value.replace(/[^0-9.]/g, ""));
          }}
        />
      </div>

      {!publicoGeneral && (
        <div>
          <Etiqueta texto="Fecha de emisión" obligatorio />
          <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
          <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>Vence a los {DIAS_PARA_PAGAR} días.</p>
        </div>
      )}

      <div>
        <Etiqueta texto="Método de pago" obligatorio />
        {publicoGeneral ? (
          <input type="text" value="PUE · pago en una sola exhibición" readOnly style={{ color: "#555" }} />
        ) : (
          <select value={metodo} onChange={(e) => setMetodo(e.target.value as "PUE" | "PPD")}>
            <option value="PPD">PPD · pago diferido (el cliente paga después)</option>
            <option value="PUE">PUE · pago en una sola exhibición (ya se pagó)</option>
          </select>
        )}
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
          {metodoEfectivo === "PPD" ? "Al pagar se emite su complemento de pago." : "PUE significa que se paga en el momento; si el cliente aún no paga, usa PPD."}
        </p>
      </div>

      {metodoEfectivo === "PUE" && (
        <div>
          <Etiqueta texto="Forma de pago" obligatorio />
          <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
            {FORMAS_PAGO_COMPLEMENTO.map((f) => (
              <option key={f.clave} value={f.clave}>
                {f.texto}
              </option>
            ))}
          </select>
          {!publicoGeneral && pagosSel.length === 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#333" }}>
              <input type="checkbox" checked={yaPagada} onChange={(e) => setYaPagada(e.target.checked)} />
              El cliente ya pagó (el cobro queda pagado)
            </label>
          )}
        </div>
      )}

      {publicoGeneral && (
        <p style={{ fontSize: 12, color: "#666", margin: 0, gridColumn: "1 / -1" }}>
          Se timbra ahora mismo, ya pagada, con el RFC genérico de público en general. Esa factura no es deducible para quien compra.
        </p>
      )}

      {error && <p style={{ color: "#A32D2D", fontSize: 13, gridColumn: "1 / -1", margin: 0 }}>{error}</p>}

      <div className="fac-acciones" style={{ gridColumn: "1 / -1" }}>
        <button type="button" className="fac-btn fac-btn-sec" disabled={!!trabajando} onClick={abrirVistaPrevia}>
          Vista previa
        </button>
        {!publicoGeneral && (
          <button type="button" className="fac-btn fac-btn-naranja" disabled={!!trabajando} onClick={integrar}>
            {trabajando === "integrar" ? "Integrando..." : "Integrar factura"}
          </button>
        )}
        <button type="button" className="fac-btn fac-btn-verde" disabled={!!trabajando} onClick={timbrar}>
          {trabajando === "timbrar" ? "Timbrando..." : "Timbrar"}
        </button>
        <button type="button" className="fac-btn fac-btn-texto" disabled={!!trabajando} onClick={onCancelar}>
          Cancelar
        </button>
      </div>

      {vistaPrevia && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setVistaPrevia(false)}
        >
          <div className="form-card" style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto", display: "flex" }} onClick={(e) => e.stopPropagation()}>
            <p className="contrato-cliente-nombre">Vista previa de la factura</p>
            <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Así se emitiría. El folio y la fecha se asignan al timbrar.</p>

            <div className="prev-bloque">
              <p className="prev-titulo">Emisor</p>
              <p className="prev-dato">{EMISOR.nombre} · {EMISOR.rfc}</p>
              <p className="prev-dato">Serie {serie || "(la de Facturapi)"} · Centro {centro}</p>
            </div>

            <div className="prev-bloque">
              <p className="prev-titulo">Receptor</p>
              {publicoGeneral ? (
                <p className="prev-dato">{DATOS_PUBLICO_GENERAL.nombre_fiscal} · {DATOS_PUBLICO_GENERAL.rfc} · Régimen {DATOS_PUBLICO_GENERAL.regimen_fiscal} · Uso {DATOS_PUBLICO_GENERAL.uso_cfdi}</p>
              ) : cliente ? (
                <>
                  <p className="prev-dato">{cliente.nombre_fiscal || "—"} · {cliente.rfc || "—"}</p>
                  <p className="prev-dato">Régimen {cliente.regimen_fiscal || "—"} · C.P. {cliente.cp_fiscal || "—"} · Uso {cliente.uso_cfdi || "G03"}</p>
                </>
              ) : null}
              {faltanDatosFiscales && <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>Faltan datos fiscales de este cliente: se puede integrar, pero no timbrar hasta completarlos.</p>}
            </div>

            <div className="prev-bloque">
              <p className="prev-titulo">Concepto</p>
              <p className="prev-dato">{concepto}</p>
              <p className="prev-dato">
                {tipoInfo ? `${tipoInfo.etiqueta} · clave SAT ${tipoInfo.satProdServ} · unidad ${tipoInfo.satUnidad}` : "Renta del espacio · clave SAT 80161504 (Coworking) u 80131502 (oficina privada), según su contrato"}
              </p>
            </div>

            <div className="prev-bloque">
              <p className="prev-titulo">Importes</p>
              <p className="prev-dato">Subtotal {dinero(subtotal)} · IVA 16% {dinero(iva)}</p>
              <p className="prev-dato" style={{ fontWeight: 700 }}>Total {dinero(montoNum)}</p>
              <p className="prev-dato">
                {metodoEfectivo === "PUE" ? `PUE · ${forma ? forma.texto : formaPago}` : "PPD · forma de pago 99 (por definir); la real va en el complemento de pago"}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="fac-btn fac-btn-verde" disabled={!!trabajando} onClick={() => { setVistaPrevia(false); timbrar(); }}>
                Timbrar
              </button>
              <button type="button" className="fac-btn fac-btn-texto" onClick={() => setVistaPrevia(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
