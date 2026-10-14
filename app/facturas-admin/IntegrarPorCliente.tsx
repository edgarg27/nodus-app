"use client";

import { useEffect, useMemo, useState } from "react";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { UBICACION_POR_CENTRO, serieCentro } from "@/lib/centros";
import { avisosDatosFiscales } from "@/lib/datosFiscales";

// Integrar por cliente (como en ZORA): centro, cliente, contrato, fecha y periodo, qué incluir (recurrentes y
// adicionales) y el concepto. "Previa" trae lo que se le puede cobrar ese mes; se marca lo que va en la factura
// y se integra: queda como estado de cuenta, desde donde se timbra.

const CENTROS = Object.keys(UBICACION_POR_CENTRO);
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

type ClienteForm = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  nombre_fiscal: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  cp_fiscal: string | null;
  porContrato?: boolean;
};
type ContratoOpc = { id: string; folio: string | null; centro: string; estatus: string; renta: number; tipo: string; etiqueta: string };
type Linea = { key: string; tipo: string; contrato: string; descripcion: string; servicio: string; total: number; pagoId?: string; contratoId?: string; centro?: string };

const razonSocial = (c: ClienteForm) => c.nombre_fiscal || c.empresa || c.nombre;
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const redondear = (n: number) => Math.round(n * 100) / 100;

function Etiqueta({ texto, obligatorio }: { texto: string; obligatorio?: boolean }) {
  return (
    <p className="sub-label" style={{ marginBottom: 6 }}>
      {texto}
      {obligatorio && <span style={{ color: "#A32D2D" }}> *</span>}
    </p>
  );
}

export default function IntegrarPorCliente({ centroInicial, onIntegrada }: { centroInicial: string; onIntegrada: (id: string) => void }) {
  const hoy = hoyMexicoISO();
  const [centro, setCentro] = useState(CENTROS.includes(centroInicial) ? centroInicial : CENTROS[0]);
  const [clientes, setClientes] = useState<ClienteForm[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [clienteId, setClienteId] = useState("");

  const [estatus, setEstatus] = useState<"vigente" | "todos">("vigente");
  const [contratos, setContratos] = useState<ContratoOpc[]>([]);
  const [contratoId, setContratoId] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)));
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [concepto, setConcepto] = useState("");
  const [conceptoTocado, setConceptoTocado] = useState(false);

  const [lineas, setLineas] = useState<Linea[] | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [rentaYa, setRentaYa] = useState<{ folio: string; estado: string; timbrada: boolean } | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);

  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  // Evita integrar dos veces si se pulsa de nuevo mientras se abre el estado de cuenta.
  const [cobroIntegrado, setCobroIntegrado] = useState<string | null>(null);

  const cliente = clientes.find((c) => c.id === clienteId) || null;
  // El concepto se arma con los servicios que van en la factura (como en ZORA: "Prestación de servicios de sala de juntas septiembre 2026").
  const elegidasParaConcepto = (lineas || []).filter((l) => marcadas.includes(l.key));
  const nombresServicio = Array.from(new Set(elegidasParaConcepto.map((l) => l.servicio).filter(Boolean)));
  const periodo = `${MESES[mes - 1].toLowerCase()} ${anio}`;
  const conceptoSugerido =
    nombresServicio.length === 0
      ? `Prestación de servicios ${periodo}`
      : nombresServicio.length <= 3
        ? `Prestación de servicios de ${nombresServicio.length > 1 ? nombresServicio.slice(0, -1).join(", ") + " y " + nombresServicio[nombresServicio.length - 1] : nombresServicio[0]} ${periodo}`
        : `Prestación de servicios varios ${periodo}`;

  useEffect(() => {
    if (!conceptoTocado) setConcepto(conceptoSugerido);
  }, [conceptoSugerido, conceptoTocado]);

  // Clientes del centro elegido.
  useEffect(() => {
    let vivo = true;
    setCargandoClientes(true);
    setClienteId("");
    fetch("/api/facturas/clientes?centro=" + encodeURIComponent(centro))
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        setClientes((d.clientes as ClienteForm[]) || []);
        setCargandoClientes(false);
      })
      .catch(() => {
        if (vivo) setCargandoClientes(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  // Contratos del cliente (según el estatus elegido); cualquier cambio invalida la previa.
  useEffect(() => {
    setLineas(null);
    setMarcadas([]);
    setRentaYa(null);
    setCobroIntegrado(null);
    setContratos([]);
    setContratoId("");
    if (!clienteId) return;
    let vivo = true;
    fetch(`/api/facturas/previa?userId=${clienteId}&estatus=${estatus}`)
      .then((r) => r.json())
      .then((d) => {
        if (vivo) setContratos(d.contratos || []);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [clienteId, estatus]);

  const opciones = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    if (!q) return [];
    return clientes.filter((c) => sinAcentos([c.nombre_fiscal, c.empresa, c.nombre, c.email, c.rfc].filter(Boolean).join(" ")).includes(q)).slice(0, 8);
  }, [clientes, busqueda]);

  async function previa() {
    setError("");
    if (!clienteId) return setError("Elige primero al cliente");
    setCargandoPrevia(true);
    setCobroIntegrado(null);
    const params = new URLSearchParams({
      accion: "previa",
      userId: clienteId,
      estatus,
      mes: String(mes),
      anio: String(anio),
    });
    if (contratoId) params.set("contratoId", contratoId);
    const res = await fetch("/api/facturas/previa?" + params.toString());
    const data = await res.json().catch(() => ({}));
    setCargandoPrevia(false);
    if (!res.ok) return setError(data.error || "No se pudo traer lo que se le cobra");
    const nuevas: Linea[] = data.lineas || [];
    setLineas(nuevas);
    setRentaYa(data.rentaYaIntegrada || null);
    setConceptoTocado(false);
    // Si la renta del mes ya está integrada, no se marca otra vez (evita cobrarla doble).
    setMarcadas(nuevas.filter((l) => !(data.rentaYaIntegrada && (l.tipo === "Renta" || l.tipo === "Adicional mensual"))).map((l) => l.key));
  }

  const elegidas = (lineas || []).filter((l) => marcadas.includes(l.key));
  // Centro de la factura: el del contrato (un cliente puede tener contratos en varios centros).
  const centrosDeLasLineas = Array.from(new Set(elegidas.map((l) => l.centro).filter(Boolean))) as string[];
  const centroFactura = centrosDeLasLineas.length === 1 ? centrosDeLasLineas[0] : centro;
  const total = redondear(elegidas.reduce((s, l) => s + l.total, 0));
  const faltanDatosFiscales = !!cliente && !(cliente.rfc && cliente.nombre_fiscal && cliente.regimen_fiscal && cliente.cp_fiscal);
  const avisosFiscales = cliente ? avisosDatosFiscales(cliente) : [];

  function validar(): string {
    if (!clienteId) return "Elige el cliente";
    if (!concepto.trim()) return "Escribe el concepto";
    if (!fecha) return "Elige la fecha";
    if (elegidas.length === 0) return "Marca al menos una línea para facturar";
    if (centrosDeLasLineas.length > 1) return "Las líneas marcadas son de contratos de distintos centros: elige un solo contrato para facturar";
    return "";
  }

  async function integrarCobro(): Promise<string | null> {
    if (cobroIntegrado) return cobroIntegrado;
    const res = await fetch("/api/facturas/integrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: clienteId,
        concepto: concepto.trim(),
        fecha,
        centro: centroFactura,
        lineas: elegidas.map((l) => (l.pagoId ? { pagoId: l.pagoId } : { descripcion: l.descripcion, monto: l.total })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      setError(data.error || "No se pudo integrar la factura");
      return null;
    }
    setCobroIntegrado(data.id);
    return data.id;
  }

  async function integrar() {
    setError("");
    const e = validar();
    if (e) return setError(e);
    setTrabajando(true);
    const id = await integrarCobro();
    if (id) onIntegrada(id);
    else setTrabajando(false);
  }

  return (
    <div>
      <form className="form-card form-factura-ancho" onSubmit={(e) => e.preventDefault()}>
        <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e", gridColumn: "1 / -1" }}>
          Datos de la integración <span style={{ fontWeight: 400, color: "#888" }}>· los campos con * son obligatorios</span>
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
          <Etiqueta texto="Cliente (busca por razón social, nombre o RFC)" obligatorio />
          {cliente ? (
            <div className="adicional-cliente-elegido">
              <span>{razonSocial(cliente)}</span>
              <button type="button" className="tel-borrar-btn" onClick={() => setClienteId("")}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder={cargandoClientes ? "Cargando clientes…" : `Busca en ${centro}`}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              {busqueda.trim() && (
                <div className="adicional-resultados">
                  {opciones.length === 0 ? (
                    <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Nada coincide en {centro}</p>
                  ) : (
                    opciones.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        className="adicional-resultado"
                        onClick={() => {
                          setBusqueda("");
                          setClienteId(c.id);
                        }}
                      >
                        {razonSocial(c)}
                        {c.rfc ? ` · ${c.rfc}` : ""}
                        {c.porContrato ? " · contrato en este centro" : ""}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <Etiqueta texto="Contratos en estatus" />
          <select value={estatus} onChange={(e) => setEstatus(e.target.value as "vigente" | "todos")}>
            <option value="vigente">Vigente</option>
            <option value="todos">Todos (incluye terminados)</option>
          </select>
        </div>

        <div>
          <Etiqueta texto="Contrato" />
          <select value={contratoId} onChange={(e) => setContratoId(e.target.value)} disabled={!clienteId}>
            <option value="">-Todos-</option>
            {contratos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.etiqueta}
                {c.renta > 0 ? ` · ${dinero(c.renta)}/mes` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Etiqueta texto="Fecha" obligatorio />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        <div>
          <Etiqueta texto="Mes" />
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Etiqueta texto="Año" />
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[Number(hoy.slice(0, 4)) - 1, Number(hoy.slice(0, 4)), Number(hoy.slice(0, 4)) + 1].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div style={{ gridColumn: "span 2" }}>
          <Etiqueta texto="Concepto" obligatorio />
          <textarea
            rows={2}
            maxLength={200}
            value={concepto}
            onChange={(e) => {
              setConcepto(e.target.value);
              setConceptoTocado(true);
            }}
          />
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center" }}>
          <button type="button" className="btn-exportar fac-naranja" disabled={!clienteId || cargandoPrevia} onClick={previa}>
            {cargandoPrevia ? "Consultando..." : "Previa"}
          </button>
        </div>
        {!clienteId && <p style={{ gridColumn: "1 / -1", fontSize: 12, color: "#888", margin: 0, textAlign: "center" }}>Elige al cliente para ver lo que se le cobra.</p>}
        {error && !lineas && <p style={{ gridColumn: "1 / -1", fontSize: 13, color: "#A32D2D", margin: 0 }}>{error}</p>}
      </form>

      {lineas && (
        <div className="form-card" style={{ marginTop: 12 }}>
          <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e" }}>
            Lo que se le cobra a {cliente ? razonSocial(cliente) : "el cliente"} · serie {serieCentro(centroFactura) || "—"}
          </p>
          {rentaYa && (
            <p style={{ fontSize: 13, color: "#854F0B", background: "#FAEEDA", borderRadius: 8, padding: "8px 10px", margin: "8px 0" }}>
              La renta de {MESES[mes - 1]} ya está integrada ({rentaYa.folio}, {rentaYa.timbrada ? "ya timbrada" : "por timbrar"}). Búscala en Estados de cuenta; por eso la renta y los
              adicionales mensuales vienen sin marcar.
            </p>
          )}
          {lineas.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888" }}>No se encontró nada que cobrarle con estos filtros (sin renta de contrato vigente ni pagos sueltos).</p>
          ) : (
            <div className="fac-tabla-wrap" style={{ marginTop: 8 }}>
              <table className="fac-tabla" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th aria-label="Incluir"></th>
                    <th>Contrato</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th className="fac-num">P/U</th>
                    <th>Moneda</th>
                    <th className="fac-num">Subtotal</th>
                    <th className="fac-num">IVA</th>
                    <th className="fac-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => {
                    const sub = redondear(l.total / 1.16);
                    return (
                      <tr key={l.key} style={marcadas.includes(l.key) ? undefined : { opacity: 0.55 }}>
                        <td className="fac-col-sel">
                          <input
                            type="checkbox"
                            aria-label="Incluir en la factura"
                            checked={marcadas.includes(l.key)}
                            onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, l.key] : m.filter((k) => k !== l.key)))}
                          />
                        </td>
                        <td>{l.contrato}</td>
                        <td>{l.tipo}</td>
                        <td>{l.descripcion}</td>
                        <td className="fac-num fac-nowrap">{dinero(sub)}</td>
                        <td>MXN</td>
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
                    <td colSpan={6} style={{ textAlign: "right", fontWeight: 600, padding: "10px 12px" }}>
                      {elegidas.length} línea(s) en la factura
                    </td>
                    <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                      {dinero(redondear(elegidas.reduce((s, l) => s + redondear(l.total / 1.16), 0)))}
                    </td>
                    <td className="fac-num fac-nowrap" style={{ padding: "10px 12px" }}>
                      {dinero(redondear(total - elegidas.reduce((s, l) => s + redondear(l.total / 1.16), 0)))}
                    </td>
                    <td className="fac-num fac-nowrap" style={{ padding: "10px 12px", fontSize: 15 }}>
                      <b>{dinero(total)}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {(faltanDatosFiscales || avisosFiscales.length > 0) && (
            <p style={{ fontSize: 12, color: "#A32D2D", margin: "10px 0 0" }}>
              {faltanDatosFiscales ? "Al cliente le faltan datos fiscales (RFC, razón social, régimen o código postal): no se podrá timbrar hasta capturarlos." : avisosFiscales[0]}
            </p>
          )}

          {lineas.length > 0 && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <button type="button" className="btn-exportar fac-naranja" disabled={trabajando || elegidas.length === 0} onClick={integrar}>
                {trabajando ? "Integrando..." : "Integrar factura"}
              </button>
              <span style={{ fontSize: 12, color: "#888" }}>Después de integrar se abre el estado de cuenta; ahí se timbra y se elige el método de pago.</span>
            </div>
          )}
          {error && <p style={{ fontSize: 13, color: "#A32D2D", margin: "10px 0 0" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
