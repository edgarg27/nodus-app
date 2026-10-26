"use client";

import { useEffect, useMemo, useState } from "react";
import { exportarExcel } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import type { FilaMedio } from "@/app/api/reportes/prospectos-medio/route";

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
type Periodo = "mes" | "mes_pasado" | "3m" | "6m" | "anio" | "otro";

const moneda = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function rango(periodo: Periodo, hoy: string, desde: string, hasta: string) {
  const [a, m] = hoy.split("-").map(Number);
  const iso = (y: number, mes: number, d: number) => new Date(Date.UTC(y, mes - 1, d)).toISOString().slice(0, 10);
  if (periodo === "mes") return { desde: iso(a, m, 1), hasta: hoy };
  if (periodo === "mes_pasado") return { desde: iso(a, m - 1, 1), hasta: iso(a, m, 0) };
  if (periodo === "3m") return { desde: iso(a, m - 2, 1), hasta: hoy };
  if (periodo === "6m") return { desde: iso(a, m - 5, 1), hasta: hoy };
  if (periodo === "anio") return { desde: `${a}-01-01`, hasta: hoy };
  return { desde, hasta };
}

// "Prospectos y ventas por medio de contacto": cuántos prospectos llegaron por cada medio (bot, página web,
// teléfono…), cuántos se volvieron clientes, cuántos contratos se cerraron, su renta mensual y lo ya cobrado.
// Se usa en Reportes y en el Panel de Dirección. Los datos los arma /api/reportes/prospectos-medio.
export default function ProspectosPorMedio({ esGlobal, centroFijo }: { esGlobal: boolean; centroFijo?: string | null }) {
  const hoy = hoyMexicoISO();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [desdeOtro, setDesdeOtro] = useState(hoy.slice(0, 8) + "01");
  const [hastaOtro, setHastaOtro] = useState(hoy);
  const [centro, setCentro] = useState(esGlobal ? "" : centroFijo || "");
  const [filas, setFilas] = useState<FilaMedio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const { desde, hasta } = rango(periodo, hoy, desdeOtro, hastaOtro);

  useEffect(() => {
    if (!desde || !hasta) return;
    setCargando(true);
    setError("");
    const params = new URLSearchParams({ desde, hasta, ...(centro ? { centro } : {}) });
    fetch(`/api/reportes/prospectos-medio?${params}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (ok) setFilas(d.filas || []);
        else setError(d.error || "No se pudo cargar el reporte");
      })
      .catch(() => setError("No se pudo conectar"))
      .finally(() => setCargando(false));
  }, [desde, hasta, centro]);

  const totales = useMemo(
    () =>
      filas.reduce(
        (t, f) => ({
          prospectos: t.prospectos + f.prospectos,
          convertidos: t.convertidos + f.convertidos,
          contratos: t.contratos + f.contratos,
          rentaMensual: t.rentaMensual + f.rentaMensual,
          cobrado: t.cobrado + f.cobrado,
        }),
        { prospectos: 0, convertidos: 0, contratos: 0, rentaMensual: 0, cobrado: 0 }
      ),
    [filas]
  );
  const maxProspectos = Math.max(1, ...filas.map((f) => f.prospectos));

  function exportar() {
    exportarExcel(
      `prospectos-por-medio-${centro || "todos"}-${desde}-a-${hasta}`.replace(/\s+/g, "_"),
      filas.map((f) => ({
        Medio: f.medio,
        "Prospectos que llegaron": f.prospectos,
        "Se hicieron clientes": f.convertidos,
        "Conversión %": pct(f.convertidos, f.prospectos),
        "Contratos cerrados": f.contratos,
        "Renta mensual vendida": f.rentaMensual,
        "Cobrado en el periodo": f.cobrado,
      }))
    );
  }

  return (
    <div className="pm-card">
      <div className="pm-cab">
        <div>
          <p className="pm-titulo">Prospectos y ventas por medio de contacto</p>
          <p className="pm-sub">
            Del {desde} al {hasta}
            {centro ? ` · ${centro}` : esGlobal ? " · Todos los centros" : ""}
          </p>
        </div>
        <button type="button" className="btn-exportar" onClick={exportar} disabled={filas.length === 0}>
          📥 Excel
        </button>
      </div>

      <div className="pm-filtros">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="mes">Este mes</option>
          <option value="mes_pasado">Mes pasado</option>
          <option value="3m">Últimos 3 meses</option>
          <option value="6m">Últimos 6 meses</option>
          <option value="anio">Este año</option>
          <option value="otro">Otras fechas…</option>
        </select>
        {periodo === "otro" && (
          <>
            <input type="date" value={desdeOtro} max={hastaOtro} onChange={(e) => setDesdeOtro(e.target.value)} />
            <input type="date" value={hastaOtro} min={desdeOtro} max={hoy} onChange={(e) => setHastaOtro(e.target.value)} />
          </>
        )}
        {esGlobal && (
          <select value={centro} onChange={(e) => setCentro(e.target.value)}>
            <option value="">Todos los centros</option>
            {CENTROS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {error ? (
        <p className="pm-vacio" style={{ color: "#a32d2d" }}>
          {error}
        </p>
      ) : cargando ? (
        <p className="pm-vacio">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="pm-vacio">Sin prospectos ni ventas en este periodo</p>
      ) : (
        <div className="pm-tabla-wrap">
          <table className="pm-tabla">
            <thead>
              <tr>
                <th>Medio</th>
                <th className="pm-num">Prospectos</th>
                <th className="pm-num">Clientes</th>
                <th className="pm-num">Conversión</th>
                <th className="pm-num">Contratos</th>
                <th className="pm-num">Renta mensual vendida</th>
                <th className="pm-num">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.medio}>
                  <td>
                    <strong>{f.medio}</strong>
                    <div className="pm-barra">
                      <span style={{ width: `${(f.prospectos / maxProspectos) * 100}%` }} />
                    </div>
                  </td>
                  <td className="pm-num">{f.prospectos}</td>
                  <td className="pm-num">{f.convertidos}</td>
                  <td className="pm-num">{f.prospectos ? `${pct(f.convertidos, f.prospectos)}%` : "—"}</td>
                  <td className="pm-num">{f.contratos}</td>
                  <td className="pm-num">
                    <strong>{moneda(f.rentaMensual)}</strong>
                  </td>
                  <td className="pm-num">{moneda(f.cobrado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="pm-num">{totales.prospectos}</td>
                <td className="pm-num">{totales.convertidos}</td>
                <td className="pm-num">{totales.prospectos ? `${pct(totales.convertidos, totales.prospectos)}%` : "—"}</td>
                <td className="pm-num">{totales.contratos}</td>
                <td className="pm-num">{moneda(totales.rentaMensual)}</td>
                <td className="pm-num">{moneda(totales.cobrado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="pm-nota">
        Prospectos: los que se registraron en el periodo. Contratos: aprobados con inicio en el periodo; su medio es el de
        la cotización (o el del prospecto). "Redes sociales" son registros de antes de que se usara el bot.
      </p>
    </div>
  );
}
