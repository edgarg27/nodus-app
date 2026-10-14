"use client";

import { useEffect, useMemo, useState } from "react";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const TIPOS = ["Coworking", "Oficina Privada", "Working Desk"];
const POR_LLAMADA = 10;

const dinero = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Fila = {
  id: string;
  folio: string;
  concepto: string;
  monto: number;
  fechaEmision: string;
  cliente: string;
  correo: string;
  rfc: string;
  tipos: string[];
  completo: boolean;
  avisos: string[];
};

export default function IntegrarLotePage() {
  const hoy = new Date();
  const [centro, setCentro] = useState("");
  const [esGlobal, setEsGlobal] = useState(false);
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [tipo, setTipo] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [puedeTimbrar, setPuedeTimbrar] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [metodo, setMetodo] = useState<"PPD" | "PUE">("PPD");
  const [formaPago, setFormaPago] = useState("03");
  const [timbrando, setTimbrando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [resultado, setResultado] = useState("");

  async function cargar(c: string) {
    setCargando(true);
    setError("");
    const params = new URLSearchParams({ mes: String(mes), anio: String(anio) });
    if (c) params.set("centro", c);
    if (tipo) params.set("tipo", tipo);
    const res = await fetch("/api/facturas/lote?" + params.toString());
    const data = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) {
      setError(data.error || "No se pudo cargar la lista");
      setFilas([]);
      return;
    }
    setFilas(data.filas || []);
    setPuedeTimbrar(!!data.puedeTimbrar);
    setEsGlobal(!!data.esGlobal);
    if (!c && data.centro) setCentro(data.centro);
    setSeleccion([]);
  }

  useEffect(() => {
    cargar(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, mes, anio, tipo]);

  // "Elegir todos" deja fuera a los que tienen un aviso en sus datos fiscales (se pueden marcar a mano).
  const timbrables = useMemo(() => filas.filter((f) => f.completo && f.avisos.length === 0), [filas]);
  const todasMarcadas = timbrables.length > 0 && timbrables.every((f) => seleccion.includes(f.id));
  const totalSel = filas.filter((f) => seleccion.includes(f.id)).reduce((s, f) => s + f.monto, 0);

  async function timbrar() {
    if (seleccion.length === 0) return;
    if (
      !confirm(
        `¿Timbrar ${seleccion.length} factura(s) (${dinero(totalSel)})? ` +
          (metodo === "PPD"
            ? "Se emiten a pago diferido (PPD); cuando el cliente pague habrá que emitir su complemento de pago."
            : "Se emiten como pago en una sola exhibición (PUE).")
      )
    )
      return;
    setTimbrando(true);
    setResultado("");
    let hechas = 0;
    const fallos: string[] = [];
    for (let i = 0; i < seleccion.length; i += POR_LLAMADA) {
      const lote = seleccion.slice(i, i + POR_LLAMADA);
      setProgreso(`Timbrando ${Math.min(i + lote.length, seleccion.length)} de ${seleccion.length}...`);
      const res = await fetch("/api/facturas/facturar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturaIds: lote, metodo, formaPago: metodo === "PUE" ? formaPago : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      const resultados: { id: string; folio?: string; ok: boolean; error?: string }[] = data.resultados || [];
      if (resultados.length === 0) {
        fallos.push(data.error || "No se pudo timbrar este grupo");
        continue;
      }
      for (const r of resultados) {
        if (r.ok) hechas++;
        else fallos.push((r.folio || filas.find((f) => f.id === r.id)?.folio || "") + " — " + (r.error || "error"));
      }
    }
    setProgreso("");
    setTimbrando(false);
    setResultado(
      (hechas > 0 ? `✓ ${hechas} factura(s) timbrada(s). ` : "") +
        (fallos.length > 0 ? `✗ ${fallos.length} no se pudo(ieron): ` + fallos.slice(0, 5).join(" · ") + (fallos.length > 5 ? " …" : "") : "")
    );
    cargar(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Facturación
        </a>
        <p className="rep-title">Integrar por lote</p>
        <p className="rep-sub">{centro || "Cargando..."} · cobros del mes que faltan por facturar</p>
      </div>

      <div className="rep-content rep-content-completo">
        <div className="form-card">
          <div className="tel-form-grid">
            {esGlobal && (
              <div>
                <p className="sub-label">Centro</p>
                <select value={centro} onChange={(e) => setCentro(e.target.value)}>
                  {CENTROS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <p className="sub-label">Mes</p>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Año</p>
              <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
                {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Tipo de servicio</p>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Todos</option>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>
            Aquí salen los cobros que ya generó el sistema (renta del mes y adicionales) y que todavía no tienen factura. Los clientes con datos fiscales
            incompletos no se pueden timbrar hasta capturarlos.
          </p>
        </div>

        {resultado && (
          <div className="form-card" style={{ marginTop: 8, fontSize: 13 }}>
            {resultado}
            <button className="tel-borrar-btn" style={{ marginLeft: 8 }} onClick={() => setResultado("")}>
              Cerrar
            </button>
          </div>
        )}

        {cargando ? (
          <div className="empty-card">Cargando...</div>
        ) : error ? (
          <div className="empty-card" style={{ color: "#A32D2D" }}>
            {error}
          </div>
        ) : filas.length === 0 ? (
          <div className="empty-card">No hay cobros por facturar con estos filtros</div>
        ) : (
          <>
            <div className="fac-tabla-wrap">
              <table className="fac-tabla">
                <thead>
                  <tr>
                    <th className="fac-col-sel">
                      <input
                        type="checkbox"
                        aria-label="Elegir todos"
                        disabled={!puedeTimbrar || timbrables.length === 0}
                        checked={todasMarcadas}
                        onChange={(e) => setSeleccion(e.target.checked ? timbrables.map((f) => f.id) : [])}
                      />
                    </th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Concepto</th>
                    <th>Fecha</th>
                    <th className="fac-num">Total</th>
                    <th>Datos fiscales</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <td className="fac-col-sel">
                        {puedeTimbrar && f.completo && (
                          <input
                            type="checkbox"
                            aria-label="Elegir"
                            checked={seleccion.includes(f.id)}
                            onChange={(e) => setSeleccion((s) => (e.target.checked ? [...s, f.id] : s.filter((i) => i !== f.id)))}
                          />
                        )}
                      </td>
                      <td>
                        <b>{f.cliente}</b>
                        {f.rfc && <span className="fac-sub">{f.rfc}</span>}
                        <span className="fac-sub">{f.correo}</span>
                      </td>
                      <td>{f.tipos.length > 0 ? f.tipos.join(", ") : <span className="fac-sub" style={{ marginTop: 0 }}>Sin contrato vigente</span>}</td>
                      <td>
                        {f.concepto}
                        <span className="fac-sub">{f.folio}</span>
                      </td>
                      <td className="fac-nowrap">{f.fechaEmision}</td>
                      <td className="fac-num fac-nowrap">{dinero(f.monto)}</td>
                      <td>
                        {f.completo && f.avisos.length === 0 ? (
                          <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                            <span className="factura-badge-text" style={{ color: "#0F6E56" }}>
                              ✓ Completos
                            </span>
                          </span>
                        ) : (
                          <span className="fac-sub" style={{ marginTop: 0, color: "#A32D2D", fontWeight: 600 }}>
                            {f.completo ? f.avisos[0] : "Faltan datos fiscales"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-card" style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <p className="sub-label">Resumen</p>
                <p style={{ margin: 0, fontSize: 14 }}>
                  {filas.length} cobro(s) · {dinero(filas.reduce((s, f) => s + f.monto, 0))} · elegidos: <b>{seleccion.length}</b> ({dinero(totalSel)})
                </p>
              </div>
              {puedeTimbrar ? (
                <>
                  <div>
                    <p className="sub-label">Método de pago</p>
                    <select value={metodo} onChange={(e) => setMetodo(e.target.value as "PPD" | "PUE")}>
                      <option value="PPD">PPD · pago diferido (se paga después)</option>
                      <option value="PUE">PUE · pago en una sola exhibición (ya se pagó)</option>
                    </select>
                  </div>
                  {metodo === "PUE" && (
                    <div>
                      <p className="sub-label">Forma de pago</p>
                      <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                        {FORMAS_PAGO_COMPLEMENTO.map((fp) => (
                          <option key={fp.clave} value={fp.clave}>
                            {fp.texto}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button className="btn-exportar" disabled={timbrando || seleccion.length === 0} onClick={timbrar}>
                    {timbrando ? progreso || "Timbrando..." : `Timbrar elegidos (${seleccion.length})`}
                  </button>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "#888" }}>Solo cobranza y administración pueden timbrar. Aquí puedes consultar la lista.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
