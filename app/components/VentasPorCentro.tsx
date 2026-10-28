"use client";

import { useMemo } from "react";
import { exportarExcel } from "@/lib/exportExcel";
import { moneda } from "@/lib/periodoReporte";
import { useDatosReporte, useFiltrosReporte } from "./FiltrosReporte";
import type { FilaCentro } from "@/app/api/reportes/ventas-centro/route";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// "Ventas por centro" (/reportes): prospectos, cotizaciones, contratos cerrados, renta mensual vendida, cobrado y
// facturado de cada centro en el periodo. Datos de /api/reportes/ventas-centro.
export default function VentasPorCentro({ esGlobal, centroFijo }: { esGlobal: boolean; centroFijo?: string | null }) {
  const f = useFiltrosReporte(esGlobal, centroFijo);
  const { datos, cargando, error } = useDatosReporte<{ filas: FilaCentro[] }>("/api/reportes/ventas-centro", f.params());
  const filas = useMemo(() => datos?.filas || [], [datos]);
  const total = useMemo(
    () =>
      filas.reduce(
        (t, x) => ({
          prospectos: t.prospectos + x.prospectos,
          convertidos: t.convertidos + x.convertidos,
          cotizaciones: t.cotizaciones + x.cotizaciones,
          contratos: t.contratos + x.contratos,
          rentaMensual: t.rentaMensual + x.rentaMensual,
          cobrado: t.cobrado + x.cobrado,
          facturado: t.facturado + x.facturado,
        }),
        { prospectos: 0, convertidos: 0, cotizaciones: 0, contratos: 0, rentaMensual: 0, cobrado: 0, facturado: 0 }
      ),
    [filas]
  );
  const maxRenta = Math.max(1, ...filas.map((x) => x.rentaMensual));

  function exportar() {
    exportarExcel(
      `ventas-por-centro-${f.centro || "todos"}-${f.desde}-a-${f.hasta}`.replace(/\s+/g, "_"),
      filas.map((x) => ({
        Centro: x.centro,
        Prospectos: x.prospectos,
        "Se hicieron clientes": x.convertidos,
        "Conversión %": pct(x.convertidos, x.prospectos),
        Cotizaciones: x.cotizaciones,
        "Contratos cerrados": x.contratos,
        "Renta mensual vendida": x.rentaMensual,
        Cobrado: x.cobrado,
        Facturado: x.facturado,
      }))
    );
  }

  return (
    <div className="pm-card">
      <div className="pm-cab">
        <div>
          <p className="pm-titulo">Ventas por centro</p>
          <p className="pm-sub">
            {f.textoPeriodo}
            {f.centro ? ` · ${f.centro}` : esGlobal ? " · Todos los centros" : ""}
          </p>
        </div>
        <button type="button" className="btn-exportar" onClick={exportar} disabled={filas.length === 0}>
          📥 Excel
        </button>
      </div>
      {f.filtros()}
      {error ? (
        <p className="pm-vacio" style={{ color: "#a32d2d" }}>
          {error}
        </p>
      ) : cargando ? (
        <p className="pm-vacio">Cargando…</p>
      ) : (
        <div className="pm-tabla-wrap">
          <table className="pm-tabla">
            <thead>
              <tr>
                <th>Centro</th>
                <th className="pm-num">Prospectos</th>
                <th className="pm-num">Clientes</th>
                <th className="pm-num">Cotizaciones</th>
                <th className="pm-num">Contratos</th>
                <th className="pm-num">Renta mensual vendida</th>
                <th className="pm-num">Cobrado</th>
                <th className="pm-num">Facturado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((x) => (
                <tr key={x.centro}>
                  <td>
                    <strong>{x.centro}</strong>
                    <div className="pm-barra">
                      <span style={{ width: `${(x.rentaMensual / maxRenta) * 100}%` }} />
                    </div>
                  </td>
                  <td className="pm-num">{x.prospectos}</td>
                  <td className="pm-num">
                    {x.convertidos}
                    {x.prospectos > 0 && <div className="pm-mini">{pct(x.convertidos, x.prospectos)}%</div>}
                  </td>
                  <td className="pm-num">{x.cotizaciones}</td>
                  <td className="pm-num">{x.contratos}</td>
                  <td className="pm-num">
                    <strong>{moneda(x.rentaMensual)}</strong>
                  </td>
                  <td className="pm-num">{moneda(x.cobrado)}</td>
                  <td className="pm-num">{moneda(x.facturado)}</td>
                </tr>
              ))}
            </tbody>
            {filas.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="pm-num">{total.prospectos}</td>
                  <td className="pm-num">{total.convertidos}</td>
                  <td className="pm-num">{total.cotizaciones}</td>
                  <td className="pm-num">{total.contratos}</td>
                  <td className="pm-num">{moneda(total.rentaMensual)}</td>
                  <td className="pm-num">{moneda(total.cobrado)}</td>
                  <td className="pm-num">{moneda(total.facturado)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="pm-nota">
        Prospectos y cotizaciones: los registrados en el periodo. Contratos: aprobados con inicio en el periodo. Cobrado:
        pagos marcados como pagados en el periodo. Facturado: facturas timbradas (sin canceladas) emitidas en el periodo.
      </p>
    </div>
  );
}
