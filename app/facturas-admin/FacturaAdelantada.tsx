"use client";

import { useEffect, useMemo, useState } from "react";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { UBICACION_POR_CENTRO } from "@/lib/centros";

// Factura adelantada: varios meses de renta de un contrato en un solo estado de cuenta (p. ej. el año completo).
// Se integra con /api/facturas/integrar, una línea de renta por mes: cada mes queda apartado en cargos_periodo y el
// cobro diario ya no genera esa renta. La admin elige desde qué mes, cuántos y el total (por si hay descuento).
// Contratos y meses ya facturados: /api/facturas/adelantada.

const CENTROS = Object.keys(UBICACION_POR_CENTRO);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MAX_MESES = 24;

type ClienteForm = { id: string; nombre: string; email: string; empresa: string | null; nombre_fiscal: string | null; rfc: string | null; porContrato?: boolean };
type Contrato = {
  id: string;
  folio: string | null;
  centro: string;
  etiqueta: string;
  renta: number;
  adicionales: { concepto: string; monto: number }[];
  fechaInicio: string | null;
  fechaVencimiento: string | null;
  formaPago: string | null;
};

const razonSocial = (c: ClienteForm) => c.nombre_fiscal || c.empresa || c.nombre;
const sinAcentos = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const redondear = (n: number) => Math.round(n * 100) / 100;

// 'YYYY-MM-01' sumando meses.
function sumarMeses(periodo: string, n: number) {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
const nombrePeriodo = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Etiqueta({ texto, obligatorio }: { texto: string; obligatorio?: boolean }) {
  return (
    <p className="sub-label" style={{ marginBottom: 6 }}>
      {texto}
      {obligatorio && <span style={{ color: "#A32D2D" }}> *</span>}
    </p>
  );
}

export default function FacturaAdelantada({
  centroInicial,
  puedeElegirCentro,
  onIntegrada,
}: {
  centroInicial: string;
  puedeElegirCentro: boolean;
  onIntegrada: (id: string) => void;
}) {
  const hoy = hoyMexicoISO();
  const mesActual = hoy.slice(0, 7) + "-01";

  const [centro, setCentro] = useState(CENTROS.includes(centroInicial) ? centroInicial : CENTROS[0]);
  const [clientes, setClientes] = useState<ClienteForm[]>([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [contratoId, setContratoId] = useState("");
  const [ocupados, setOcupados] = useState<{ periodo: string; folio: string }[]>([]);
  const [cargandoMeses, setCargandoMeses] = useState(false);

  const [fecha, setFecha] = useState(hoy);
  const [desde, setDesde] = useState(mesActual);
  const [meses, setMeses] = useState(12);
  const [total, setTotal] = useState("");
  const [totalTocado, setTotalTocado] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [conceptoTocado, setConceptoTocado] = useState(false);

  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  // Clientes del centro.
  useEffect(() => {
    let vivo = true;
    setCargandoClientes(true);
    setClienteId("");
    fetch("/api/facturas/clientes?centro=" + encodeURIComponent(centro))
      .then((r) => r.json())
      .then((d) => {
        if (vivo) {
          setClientes((d.clientes as ClienteForm[]) || []);
          setCargandoClientes(false);
        }
      })
      .catch(() => vivo && setCargandoClientes(false));
    return () => {
      vivo = false;
    };
  }, [centro]);

  // Contratos vigentes del cliente.
  useEffect(() => {
    setContratos([]);
    setContratoId("");
    setOcupados([]);
    if (!clienteId) return;
    let vivo = true;
    fetch(`/api/facturas/adelantada?userId=${clienteId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        const lista: Contrato[] = d.contratos || [];
        setContratos(lista);
        const elegibles = lista.filter((c) => c.formaPago !== "adelantado" && c.renta > 0);
        if (elegibles.length === 1) setContratoId(elegibles[0].id);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  // Meses ya facturados del contrato elegido; arranca en el primer mes libre.
  useEffect(() => {
    setOcupados([]);
    setTotalTocado(false);
    setConceptoTocado(false);
    if (!clienteId || !contratoId) return;
    let vivo = true;
    setCargandoMeses(true);
    fetch(`/api/facturas/adelantada?userId=${clienteId}&contratoId=${contratoId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        const oc: { periodo: string; folio: string }[] = d.ocupados || [];
        setOcupados(oc);
        let p = mesActual;
        for (let i = 0; i < MAX_MESES && oc.some((o) => o.periodo === p); i++) p = sumarMeses(p, 1);
        setDesde(p);
        setCargandoMeses(false);
      })
      .catch(() => vivo && setCargandoMeses(false));
    return () => {
      vivo = false;
    };
  }, [clienteId, contratoId, mesActual]);

  const cliente = clientes.find((c) => c.id === clienteId) || null;
  const contrato = contratos.find((c) => c.id === contratoId) || null;
  const opciones = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    if (!q) return [];
    return clientes.filter((c) => sinAcentos([c.nombre_fiscal, c.empresa, c.nombre, c.email, c.rfc].filter(Boolean).join(" ")).includes(q)).slice(0, 8);
  }, [clientes, busqueda]);

  const mensual = contrato ? redondear(contrato.renta + contrato.adicionales.reduce((s, a) => s + a.monto, 0)) : 0;
  // Último mes que cubre el contrato (el de su fecha de fin).
  const ultimoDelContrato = contrato?.fechaVencimiento ? contrato.fechaVencimiento.slice(0, 7) + "-01" : null;
  const periodos = useMemo(() => Array.from({ length: Math.max(0, meses) }, (_, i) => sumarMeses(desde, i)), [desde, meses]);
  const hasta = periodos[periodos.length - 1] || desde;
  const choques = periodos.filter((p) => ocupados.some((o) => o.periodo === p));
  const pasaDelFin = !!ultimoDelContrato && hasta > ultimoDelContrato;
  const sugerido = redondear(mensual * meses);
  const totalNum = totalTocado ? Number(total) : sugerido;
  const descuento = redondear(sugerido - totalNum);

  // Concepto sugerido (se puede editar).
  useEffect(() => {
    if (conceptoTocado || !contrato) return;
    setConcepto(`Renta adelantada de ${nombrePeriodo(desde)} a ${nombrePeriodo(hasta)} (${meses} ${meses === 1 ? "mes" : "meses"}) · ${contrato.etiqueta}`);
  }, [contrato, desde, hasta, meses, conceptoTocado]);

  // Meses para elegir el inicio: desde el actual, 24 hacia adelante.
  const opcionesDesde = Array.from({ length: MAX_MESES }, (_, i) => sumarMeses(mesActual, i));

  // Lo que va en cada mes: el total repartido parejo (el último absorbe los centavos).
  const lineas = useMemo(() => {
    if (!(totalNum > 0) || periodos.length === 0) return [];
    const base = Math.floor((totalNum / periodos.length) * 100) / 100;
    return periodos.map((p, i) => ({
      periodo: p,
      monto: i === periodos.length - 1 ? redondear(totalNum - base * (periodos.length - 1)) : base,
    }));
  }, [periodos, totalNum]);

  function validar(): string {
    if (!clienteId) return "Elige el cliente";
    if (!contrato) return "Elige el contrato";
    if (contrato.formaPago === "adelantado") return "Ese contrato ya se cobró completo por adelantado";
    if (!(meses >= 1 && meses <= MAX_MESES)) return `Elige de 1 a ${MAX_MESES} meses`;
    if (choques.length) return `${mayuscula(nombrePeriodo(choques[0]))} ya está en el estado de cuenta ${ocupados.find((o) => o.periodo === choques[0])?.folio}: empieza después o cubre menos meses`;
    if (pasaDelFin) return `El contrato termina en ${nombrePeriodo(ultimoDelContrato!)}: cubre menos meses`;
    if (!(totalNum > 0)) return "El total debe ser mayor a cero";
    if (!concepto.trim()) return "Escribe el concepto";
    if (!fecha) return "Elige la fecha";
    return "";
  }

  async function integrar() {
    setError("");
    const e = validar();
    if (e) return setError(e);
    setTrabajando(true);
    const extras = contrato!.adicionales.length ? ` (incluye ${contrato!.adicionales.map((a) => a.concepto).join(", ")})` : "";
    const res = await fetch("/api/facturas/integrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: clienteId,
        concepto: concepto.trim(),
        fecha,
        centro: contrato!.centro,
        lineas: lineas.map((l) => ({
          descripcion: `Renta ${nombrePeriodo(l.periodo)}${extras}`,
          monto: l.monto,
          rentaContratoId: contrato!.id,
          rentaPeriodo: l.periodo,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      setTrabajando(false);
      return setError(data.error || "No se pudo integrar la factura adelantada");
    }
    onIntegrada(data.id);
  }

  return (
    <div>
      <form className="form-card form-factura-ancho adelantada-form" onSubmit={(e) => e.preventDefault()}>
        <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e", gridColumn: "1 / -1" }}>
          Factura adelantada <span style={{ fontWeight: 400, color: "#888" }}>· varios meses de renta en un solo estado de cuenta; esos meses ya no se generan cada mes</span>
        </p>

        <div>
          <Etiqueta texto="Centro" obligatorio />
          <select value={centro} onChange={(e) => setCentro(e.target.value)} disabled={!puedeElegirCentro} title={puedeElegirCentro ? "" : "Solo facturas en tu centro"}>
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
              <input type="text" placeholder={cargandoClientes ? "Cargando clientes…" : `Busca en ${centro}`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
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

        <div style={{ gridColumn: "span 2" }}>
          <Etiqueta texto="Contrato (vigente)" obligatorio />
          <select value={contratoId} onChange={(e) => setContratoId(e.target.value)} disabled={!clienteId}>
            <option value="">{clienteId && contratos.length === 0 ? "Sin contratos vigentes" : "Elige…"}</option>
            {contratos.map((c) => (
              <option key={c.id} value={c.id} disabled={c.formaPago === "adelantado" || c.renta <= 0}>
                {c.etiqueta}
                {c.renta > 0 ? ` · ${dinero(c.renta)}/mes` : ""}
                {c.formaPago === "adelantado" ? " · ya pagado por adelantado" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Etiqueta texto="Fecha de emisión" obligatorio />
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        <div>
          <Etiqueta texto="Desde el mes" obligatorio />
          <select value={desde} onChange={(e) => setDesde(e.target.value)} disabled={!contrato || cargandoMeses}>
            {opcionesDesde.map((p) => {
              const oc = ocupados.find((o) => o.periodo === p);
              return (
                <option key={p} value={p}>
                  {mayuscula(nombrePeriodo(p))}
                  {oc ? ` · ya facturado (${oc.folio})` : ""}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <Etiqueta texto="¿Cuántos meses?" obligatorio />
          <input type="number" min={1} max={MAX_MESES} value={meses} onChange={(e) => setMeses(Math.max(0, Math.min(MAX_MESES, Number(e.target.value) || 0)))} disabled={!contrato} />
        </div>

        <div>
          <Etiqueta texto="Total de la factura (con IVA)" obligatorio />
          <input
            type="number"
            min={0}
            step="0.01"
            value={totalTocado ? total : sugerido || ""}
            onChange={(e) => {
              setTotalTocado(true);
              setTotal(e.target.value);
            }}
            disabled={!contrato}
          />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <Etiqueta texto="Concepto" obligatorio />
          <input
            type="text"
            value={concepto}
            onChange={(e) => {
              setConceptoTocado(true);
              setConcepto(e.target.value);
            }}
            disabled={!contrato}
          />
        </div>

        {contrato && (
          <div className="adelantada-resumen" style={{ gridColumn: "1 / -1" }}>
            <div className="adelantada-cifras">
              <div>
                <span>Al mes</span>
                <b>{dinero(mensual)}</b>
                <small>
                  Renta {dinero(contrato.renta)}
                  {contrato.adicionales.map((a) => ` + ${a.concepto} ${dinero(a.monto)}`).join("")}
                </small>
              </div>
              <div>
                <span>Cubre</span>
                <b>
                  {meses} {meses === 1 ? "mes" : "meses"}
                </b>
                <small>
                  {mayuscula(nombrePeriodo(desde))} a {nombrePeriodo(hasta)}
                </small>
              </div>
              <div>
                <span>Precio completo</span>
                <b>{dinero(sugerido)}</b>
                <small>{mensual > 0 ? `${dinero(mensual)} × ${meses}` : ""}</small>
              </div>
              <div className={descuento > 0 ? "adelantada-descuento" : ""}>
                <span>Total a facturar</span>
                <b>{dinero(totalNum > 0 ? totalNum : 0)}</b>
                <small>
                  {descuento > 0 ? `Descuento ${dinero(descuento)} (${Math.round((descuento / sugerido) * 1000) / 10}%)` : descuento < 0 ? `${dinero(-descuento)} más que el precio completo` : "Sin descuento"}
                  {totalTocado && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="pp-link"
                        onClick={() => {
                          setTotalTocado(false);
                          setTotal("");
                        }}
                      >
                        usar precio completo
                      </button>
                    </>
                  )}
                </small>
              </div>
            </div>
            {choques.length > 0 && (
              <p className="adelantada-aviso">
                ⚠️ {choques.map((p) => mayuscula(nombrePeriodo(p))).join(", ")} ya {choques.length === 1 ? "tiene" : "tienen"} estado de cuenta. Empieza después o cubre menos meses.
              </p>
            )}
            {pasaDelFin && <p className="adelantada-aviso">⚠️ El contrato termina en {nombrePeriodo(ultimoDelContrato!)}; esta factura se pasa de esa fecha.</p>}
            {contrato.fechaVencimiento && !pasaDelFin && (
              <p style={{ margin: 0, fontSize: 12.5, color: "#7a8399" }}>El contrato termina en {nombrePeriodo(ultimoDelContrato!)}.</p>
            )}
            <p style={{ margin: 0, fontSize: 12.5, color: "#5b6478" }}>
              Se crea un estado de cuenta con una línea por mes ({lineas[0] ? dinero(lineas[0].monto) : "—"} c/u). Esos meses quedan cubiertos: el cobro mensual ya no
              les genera renta. Después se timbra desde el estado de cuenta, como cualquier otro.
            </p>
          </div>
        )}

        {error && (
          <p style={{ color: "#A32D2D", fontSize: 13, margin: 0, gridColumn: "1 / -1" }}>
            {error}
          </p>
        )}
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn-enviar" style={{ width: "auto", padding: "10px 22px", margin: 0 }} onClick={integrar} disabled={trabajando || !contrato}>
            {trabajando ? "Integrando…" : "Integrar factura adelantada"}
          </button>
        </div>
      </form>
    </div>
  );
}
