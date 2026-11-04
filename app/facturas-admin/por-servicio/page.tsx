"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { exportarExcelHojas } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";

// Facturado por servicio: cuánto se timbró en el mes de cada tipo de servicio (Oficina privada, Coworking, Working
// desk, Oficina virtual) y de qué conceptos. Los datos salen de /api/facturas/por-servicio.

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

type Resumen = { tipo: string; etiqueta: string; facturas: number; subtotal: number; iva: number; total: number; conceptos: { concepto: string; total: number }[] };
type Detalle = { id: string; folio: string; fecha: string; centro: string; cliente: string; tipo: string; tipoEtiqueta: string; conceptos: string; subtotal: number; iva: number; total: number };
type Datos = { mes: string; resumen: Resumen[]; totales: { facturas: number; subtotal: number; iva: number; total: number }; detalle: Detalle[] };

export default function FacturadoPorServicioPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [centro, setCentro] = useState("");
  const [mes, setMes] = useState(hoyMexicoISO().slice(0, 7));
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const esGlobal = ROLES_GLOBALES.includes(rol);

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

  useEffect(() => {
    if (!rol || !mes) return;
    setCargando(true);
    setError("");
    fetch(`/api/facturas/por-servicio?mes=${mes}&centro=${encodeURIComponent(centro)}`, { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) setError(d.error || "No se pudo cargar");
        setDatos(ok ? d : null);
        setCargando(false);
      })
      .catch(() => {
        setError("No se pudo conectar");
        setCargando(false);
      });
  }, [rol, mes, centro]);

  function exportar() {
    if (!datos) return;
    exportarExcelHojas(`facturado-por-servicio-${centro || "todos"}-${mes}`, {
      "Por servicio": datos.resumen.map((r) => ({ Servicio: r.etiqueta, Facturas: r.facturas, Subtotal: r.subtotal, IVA: r.iva, Total: r.total })),
      "Por concepto": datos.resumen.flatMap((r) => r.conceptos.map((c) => ({ Servicio: r.etiqueta, Concepto: c.concepto, "Total con IVA": c.total }))),
      Facturas: datos.detalle.map((d) => ({ Folio: d.folio, Fecha: d.fecha, Centro: d.centro, Cliente: d.cliente, Servicio: d.tipoEtiqueta, Conceptos: d.conceptos, Subtotal: d.subtotal, IVA: d.iva, Total: d.total })),
    });
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/facturas-admin">
          ← Facturación
        </Link>
        <p className="rep-title">Facturado por servicio</p>
        <p className="rep-sub">Lo timbrado en el mes por tipo de servicio del cliente (sin canceladas ni complementos de pago)</p>
      </div>

      <div className="rep-content rep-content-completo">
        <div className="ft-card">
          <div className="ft-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label className="ft-campo">
              <span>Centro</span>
              <select value={centro} disabled={!esGlobal} onChange={(e) => setCentro(e.target.value)}>
                {esGlobal && <option value="">Todos los centros</option>}
                {(esGlobal ? CENTROS : [centro]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="ft-campo">
              <span>Mes</span>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </label>
            <div className="ft-campo" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ft-btn-sec" disabled={!datos || datos.detalle.length === 0} onClick={exportar}>
                Exportar a Excel
              </button>
            </div>
          </div>
        </div>

        <div className="ft-card ft-resultados">
          {cargando ? (
            <div className="ft-vacio">Cargando...</div>
          ) : error ? (
            <div className="ft-vacio" style={{ color: "#A32D2D" }}>
              {error}
            </div>
          ) : !datos || datos.detalle.length === 0 ? (
            <div className="ft-vacio">No hay facturas timbradas en ese mes</div>
          ) : (
            <>
              <div className="ft-tabla-wrap" style={{ borderTop: "none" }}>
                <table className="ft-tabla">
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th>Concepto</th>
                      <th className="fac-num">Facturas</th>
                      <th className="fac-num">Subtotal</th>
                      <th className="fac-num">IVA</th>
                      <th className="fac-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.resumen.map((r) => (
                      <Fragment key={r.tipo}>
                        <tr>
                          <td>
                            <b>{r.etiqueta}</b>
                          </td>
                          <td />
                          <td className="fac-num">{r.facturas}</td>
                          <td className="fac-num">{dinero(r.subtotal)}</td>
                          <td className="fac-num">{dinero(r.iva)}</td>
                          <td className="fac-num">
                            <b>{dinero(r.total)}</b>
                          </td>
                        </tr>
                        {r.conceptos.map((c) => (
                          <tr key={r.tipo + c.concepto}>
                            <td />
                            <td style={{ color: "#555" }}>{c.concepto}</td>
                            <td />
                            <td />
                            <td />
                            <td className="fac-num" style={{ color: "#555" }}>
                              {dinero(c.total)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr>
                      <td>
                        <b>Total</b>
                      </td>
                      <td />
                      <td className="fac-num">
                        <b>{datos.totales.facturas}</b>
                      </td>
                      <td className="fac-num">
                        <b>{dinero(datos.totales.subtotal)}</b>
                      </td>
                      <td className="fac-num">
                        <b>{dinero(datos.totales.iva)}</b>
                      </td>
                      <td className="fac-num">
                        <b>{dinero(datos.totales.total)}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {datos.resumen.some((r) => r.tipo === "sin_tipo") && (
                <p style={{ fontSize: 12, color: "#854F0B", margin: "10px 20px" }}>
                  &quot;Sin tipo&quot;: clientes cuyo contrato no tiene tipo de servicio (sin oficina asignada). Elígelo en Contratos → editar contrato.
                </p>
              )}

              <p className="panel-section-label" style={{ margin: "18px 20px 6px" }}>
                Facturas del mes ({datos.detalle.length})
              </p>
              <div className="ft-tabla-wrap">
                <table className="ft-tabla">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Servicio</th>
                      <th>Conceptos</th>
                      <th className="fac-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.detalle.map((d) => (
                      <tr key={d.id}>
                        <td className="ft-nowrap">
                          <a href={"/facturas-admin/estados-de-cuenta/" + d.id} style={{ color: "#0d1b3e", textDecoration: "underline" }}>
                            {d.folio}
                          </a>
                        </td>
                        <td className="ft-nowrap">{d.fecha}</td>
                        <td>{d.cliente}</td>
                        <td>{d.tipoEtiqueta}</td>
                        <td>{d.conceptos}</td>
                        <td className="fac-num">{dinero(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
