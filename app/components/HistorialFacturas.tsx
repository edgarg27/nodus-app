"use client";

import { useMemo, useState } from "react";
import { exportarExcelHojas } from "@/lib/exportExcel";
import { moneda } from "@/lib/periodoReporte";
import { useDatosReporte, useFiltrosReporte } from "./FiltrosReporte";
import type { CentroFacturas, ClienteFacturas, MesFacturas } from "@/app/api/reportes/facturas-historial/route";

type Datos = { centros: CentroFacturas[]; clientes: ClienteFacturas[]; meses: MesFacturas[] };
type Vista = "centro" | "cliente" | "mes";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// "Historial de facturas" (/reportes): facturas timbradas por centro, por cliente y por mes, con lo facturado, lo
// pagado y lo que falta por cobrar. De cada cliente se puede abrir su historial completo en Facturación.
export default function HistorialFacturas({ esGlobal, centroFijo }: { esGlobal: boolean; centroFijo?: string | null }) {
  const f = useFiltrosReporte(esGlobal, centroFijo, "todo");
  const { datos, cargando, error } = useDatosReporte<Datos>("/api/reportes/facturas-historial", f.params());
  const [vista, setVista] = useState<Vista>("centro");
  const [buscar, setBuscar] = useState("");
  // Clic en un centro: la vista por cliente muestra solo los de ese centro.
  const [centroClientes, setCentroClientes] = useState("");

  const clientes = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (datos?.clientes || []).filter(
      (c) => (!centroClientes || c.centro === centroClientes) && (!q || c.cliente.toLowerCase().includes(q))
    );
  }, [datos, buscar, centroClientes]);
  const centros = datos?.centros || [];
  const meses = datos?.meses || [];
  const total = centros.reduce(
    (t, c) => ({ facturas: t.facturas + c.facturas, facturado: t.facturado + c.facturado, pagado: t.pagado + c.pagado, porCobrar: t.porCobrar + c.porCobrar }),
    { facturas: 0, facturado: 0, pagado: 0, porCobrar: 0 }
  );

  function exportar() {
    exportarExcelHojas(`historial-facturas-${f.centro || "todos"}${f.desde ? `-${f.desde}-a-${f.hasta}` : ""}`.replace(/\s+/g, "_"), {
      "Por centro": centros.map((c) => ({
        Centro: c.centro,
        Facturas: c.facturas,
        Facturado: c.facturado,
        Pagado: c.pagado,
        "Por cobrar": c.porCobrar,
        Canceladas: c.canceladas,
      })),
      "Por cliente": (datos?.clientes || []).map((c) => ({
        Cliente: c.cliente,
        Centro: c.centro,
        Facturas: c.facturas,
        Facturado: c.facturado,
        Pagado: c.pagado,
        "Por cobrar": c.porCobrar,
        Canceladas: c.canceladas,
        "Última factura": c.ultima,
      })),
      "Por mes": meses.map((m) => ({ Mes: m.mes, Facturas: m.facturas, Facturado: m.facturado })),
    });
  }

  const verCentro = (c: string) => {
    setCentroClientes(c);
    setVista("cliente");
  };

  return (
    <div className="pm-card">
      <div className="pm-cab">
        <div>
          <p className="pm-titulo">Historial de facturas</p>
          <p className="pm-sub">
            {f.textoPeriodo}
            {f.centro ? ` · ${f.centro}` : esGlobal ? " · Todos los centros" : ""}
          </p>
        </div>
        <button type="button" className="btn-exportar" onClick={exportar} disabled={!datos || centros.length === 0}>
          📥 Excel
        </button>
      </div>
      {f.filtros(true)}

      <div className="pm-vistas" role="tablist">
        {(
          [
            ["centro", "Por centro"],
            ["cliente", "Por cliente"],
            ["mes", "Por mes"],
          ] as [Vista, string][]
        ).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} className={vista === v ? "activa" : ""} onClick={() => setVista(v)}>
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="pm-vacio" style={{ color: "#a32d2d" }}>
          {error}
        </p>
      ) : cargando ? (
        <p className="pm-vacio">Cargando…</p>
      ) : vista === "centro" ? (
        <div className="pm-tabla-wrap">
          <table className="pm-tabla">
            <thead>
              <tr>
                <th>Centro</th>
                <th className="pm-num">Facturas</th>
                <th className="pm-num">Facturado</th>
                <th className="pm-num">Pagado</th>
                <th className="pm-num">Por cobrar</th>
              </tr>
            </thead>
            <tbody>
              {centros.map((c) => (
                <tr key={c.centro} className="pm-fila" onClick={() => verCentro(c.centro)} title="Ver los clientes de este centro">
                  <td>
                    <strong>{c.centro}</strong>
                    {c.canceladas > 0 && <div className="pm-mini">{c.canceladas} cancelada(s)</div>}
                  </td>
                  <td className="pm-num">{c.facturas}</td>
                  <td className="pm-num">
                    <strong>{moneda(c.facturado)}</strong>
                  </td>
                  <td className="pm-num">{moneda(c.pagado)}</td>
                  <td className="pm-num" style={{ color: c.porCobrar > 0 ? "#a3701f" : undefined }}>
                    {moneda(c.porCobrar)}
                  </td>
                </tr>
              ))}
            </tbody>
            {centros.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="pm-num">{total.facturas}</td>
                  <td className="pm-num">{moneda(total.facturado)}</td>
                  <td className="pm-num">{moneda(total.pagado)}</td>
                  <td className="pm-num">{moneda(total.porCobrar)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : vista === "cliente" ? (
        <>
          <div className="pm-filtros">
            <input type="search" placeholder="Buscar cliente…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            {centroClientes && (
              <button type="button" className="tel-borrar-btn" onClick={() => setCentroClientes("")}>
                Solo {centroClientes} · ver todos
              </button>
            )}
          </div>
          {clientes.length === 0 ? (
            <p className="pm-vacio">Sin facturas con estos filtros</p>
          ) : (
            <div className="pm-tabla-wrap">
              <table className="pm-tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="pm-num">Facturas</th>
                    <th className="pm-num">Facturado</th>
                    <th className="pm-num">Pagado</th>
                    <th className="pm-num">Por cobrar</th>
                    <th>Última</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={`${c.id}-${c.centro}`}>
                      <td>
                        <strong>{c.cliente}</strong>
                        <div className="pm-mini">{c.centro}</div>
                      </td>
                      <td className="pm-num">{c.facturas}</td>
                      <td className="pm-num">
                        <strong>{moneda(c.facturado)}</strong>
                      </td>
                      <td className="pm-num">{moneda(c.pagado)}</td>
                      <td className="pm-num" style={{ color: c.porCobrar > 0 ? "#a3701f" : undefined }}>
                        {moneda(c.porCobrar)}
                      </td>
                      <td className="pm-nowrap">{c.ultima}</td>
                      <td className="pm-nowrap">
                        {c.id && (
                          <a className="pm-link" href={`/facturas-admin/por-cliente?cliente=${c.id}`}>
                            Ver facturas ›
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : meses.length === 0 ? (
        <p className="pm-vacio">Sin facturas con estos filtros</p>
      ) : (
        <div className="pm-tabla-wrap">
          <table className="pm-tabla">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="pm-num">Facturas</th>
                <th className="pm-num">Facturado</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <td>
                    <strong>{etiquetaMes(m.mes)}</strong>
                  </td>
                  <td className="pm-num">{m.facturas}</td>
                  <td className="pm-num">
                    <strong>{moneda(m.facturado)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pm-nota">
        Solo facturas timbradas; las canceladas no suman. &quot;Pagado&quot;: facturas marcadas como pagadas. Da clic en un
        centro para ver sus clientes, y en &quot;Ver facturas&quot; para el historial completo del cliente (PDF y XML).
      </p>
    </div>
  );
}
