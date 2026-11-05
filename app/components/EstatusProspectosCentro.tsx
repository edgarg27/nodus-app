"use client";

import { useEffect, useMemo, useState } from "react";
import { exportarExcelHojas } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";
import { rango, type Periodo } from "@/lib/periodoReporte";
import type { FilaCentroEstatus, ProspectoEstatus } from "@/app/api/reportes/prospectos-estatus/route";

// Mismos colores que los estados de la pantalla de Prospectos.
const ESTADOS: { clave: keyof Omit<FilaCentroEstatus, "centro" | "total">; label: string; bg: string; color: string }[] = [
  { clave: "nuevo", label: "Nuevo", bg: "#E6F1FB", color: "#185FA5" },
  { clave: "contactado", label: "Contactado", bg: "#FAEEDA", color: "#854F0B" },
  { clave: "en_seguimiento", label: "En seguimiento", bg: "#FFF3E8", color: "#F07E3A" },
  { clave: "convertido", label: "Convertido", bg: "#E1F5EE", color: "#0F6E56" },
  { clave: "perdido", label: "Perdido", bg: "#FCEBEB", color: "#A32D2D" },
];
const estadoDe = (clave: string) => ESTADOS.find((e) => e.clave === clave) || ESTADOS[0];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// "Estatus de prospectos por centro": cuántos prospectos hay en cada estado (nuevo, contactado, en seguimiento,
// convertido, perdido) por centro, y la lista de cuáles son. Clic en un número para ver solo esos.
// Los datos los arma /api/reportes/prospectos-estatus.
export default function EstatusProspectosCentro({ esGlobal, centroFijo }: { esGlobal: boolean; centroFijo?: string | null }) {
  const hoy = hoyMexicoISO();
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [desdeOtro, setDesdeOtro] = useState(hoy.slice(0, 8) + "01");
  const [hastaOtro, setHastaOtro] = useState(hoy);
  const [centro, setCentro] = useState(esGlobal ? "" : centroFijo || "");
  const [filas, setFilas] = useState<FilaCentroEstatus[]>([]);
  const [prospectos, setProspectos] = useState<ProspectoEstatus[]>([]);
  // Filtro de la lista al dar clic en la tabla ("" = todos).
  const [filtroCentro, setFiltroCentro] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const { desde, hasta } = rango(periodo, hoy, desdeOtro, hastaOtro);

  useEffect(() => {
    if (periodo !== "todo" && (!desde || !hasta)) return;
    setCargando(true);
    setError("");
    const params = new URLSearchParams({ ...(desde ? { desde, hasta } : {}), ...(centro ? { centro } : {}) });
    fetch(`/api/reportes/prospectos-estatus?${params}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (ok) {
          setFilas(d.filas || []);
          setProspectos(d.prospectos || []);
          setFiltroCentro("");
          setFiltroEstado("");
        } else setError(d.error || "No se pudo cargar el reporte");
      })
      .catch(() => setError("No se pudo conectar"))
      .finally(() => setCargando(false));
  }, [periodo, desde, hasta, centro]);

  const totales = useMemo(() => {
    const t: Record<string, number> = { total: 0 };
    ESTADOS.forEach((e) => (t[e.clave] = 0));
    filas.forEach((f) => {
      t.total += f.total;
      ESTADOS.forEach((e) => (t[e.clave] += f[e.clave]));
    });
    return t;
  }, [filas]);

  const visibles = prospectos.filter((p) => (!filtroCentro || p.centro === filtroCentro) && (!filtroEstado || p.estado === filtroEstado));
  const elegir = (c: string, e: string) => {
    const mismo = filtroCentro === c && filtroEstado === e;
    setFiltroCentro(mismo ? "" : c);
    setFiltroEstado(mismo ? "" : e);
  };
  const variosCentros = esGlobal && !centro;
  const textoFiltro = [filtroCentro, filtroEstado && estadoDe(filtroEstado).label].filter(Boolean).join(" · ");

  function exportar() {
    exportarExcelHojas(`estatus-prospectos-${centro || "todos"}-${desde || "historial"}${hasta ? "-a-" + hasta : ""}`.replace(/\s+/g, "_"), {
      "Por centro": filas.map((f) => ({
        Centro: f.centro,
        ...Object.fromEntries(ESTADOS.map((e) => [e.label, f[e.clave]])),
        Total: f.total,
        "Conversión %": pct(f.convertido, f.total),
      })),
      Prospectos: prospectos.map((p) => ({
        Fecha: p.fecha,
        Centro: p.centro,
        Prospecto: p.nombre,
        Empresa: p.empresa || "",
        Interés: p.interes || "",
        Medio: p.medio,
        Estatus: estadoDe(p.estado).label,
        "Motivo (perdido)": p.motivoPerdido || "",
        "Lo registró": p.registro,
      })),
    });
  }

  const celda = (c: string, e: string, n: number) => (
    <td
      key={e || "total"}
      className={"pm-num pe-celda" + (filtroCentro === c && filtroEstado === e ? " activa" : "") + (n ? "" : " cero")}
      onClick={() => n && elegir(c, e)}
      title={n ? "Ver cuáles son" : undefined}
    >
      {n}
    </td>
  );

  return (
    <div className="pm-card">
      <div className="pm-cab">
        <div>
          <p className="pm-titulo">Estatus de prospectos por centro</p>
          <p className="pm-sub">
            {periodo === "todo" ? "Todo el historial" : `Registrados del ${desde} al ${hasta}`}
            {centro ? ` · ${centro}` : esGlobal ? " · Todos los centros" : ""}
          </p>
        </div>
        <button type="button" className="btn-exportar" onClick={exportar} disabled={prospectos.length === 0}>
          📥 Excel
        </button>
      </div>

      <div className="pm-filtros">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="todo">Todo el historial</option>
          <option value="mes">Registrados este mes</option>
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
            {CENTROS_REPORTE.map((c) => (
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
      ) : (
        <>
          <div className="pm-tabla-wrap">
            <table className="pm-tabla">
              <thead>
                <tr>
                  <th>Centro</th>
                  {ESTADOS.map((e) => (
                    <th key={e.clave} className="pm-num">
                      <span className="pe-estado" style={{ background: e.bg, color: e.color }}>
                        {e.label}
                      </span>
                    </th>
                  ))}
                  <th className="pm-num">Total</th>
                  <th className="pm-num">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.centro}>
                    <td>
                      <strong>{f.centro}</strong>
                    </td>
                    {ESTADOS.map((e) => celda(f.centro, e.clave, f[e.clave]))}
                    {celda(f.centro, "", f.total)}
                    <td className="pm-num">{f.total ? `${pct(f.convertido, f.total)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {filas.length > 1 && (
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {ESTADOS.map((e) => celda("", e.clave, totales[e.clave]))}
                    <td className="pm-num">{totales.total}</td>
                    <td className="pm-num">{totales.total ? `${pct(totales.convertido, totales.total)}%` : "—"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {prospectos.length === 0 ? (
            <p className="pm-vacio">Sin prospectos en este periodo</p>
          ) : (
            <>
              <div className="pm-ventas-cab">
                <p className="pm-titulo" style={{ fontSize: 14 }}>
                  Prospectos ({visibles.length})
                </p>
                {textoFiltro && (
                  <button
                    type="button"
                    className="tel-borrar-btn"
                    onClick={() => {
                      setFiltroCentro("");
                      setFiltroEstado("");
                    }}
                  >
                    Solo {textoFiltro} · ver todos
                  </button>
                )}
              </div>
              <div className="pm-tabla-wrap">
                <table className="pm-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Prospecto</th>
                      {variosCentros && <th>Centro</th>}
                      <th>Medio</th>
                      <th>Estatus</th>
                      <th>Lo registró</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.slice(0, 500).map((p) => {
                      const e = estadoDe(p.estado);
                      return (
                        <tr key={p.id}>
                          <td className="pm-nowrap">{p.fecha}</td>
                          <td>
                            <strong>{p.nombre}</strong>
                            {(p.empresa || p.interes) && <div className="pm-mini">{[p.empresa, p.interes].filter(Boolean).join(" · ")}</div>}
                          </td>
                          {variosCentros && <td>{p.centro}</td>}
                          <td>{p.medio}</td>
                          <td>
                            <span className="pe-estado" style={{ background: e.bg, color: e.color }}>
                              {e.label}
                            </span>
                            {p.motivoPerdido && <div className="pm-mini">{p.motivoPerdido}</div>}
                          </td>
                          <td>{p.registro}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibles.length > 500 && <p className="pm-nota">Se muestran los 500 más recientes; el Excel trae todos.</p>}
            </>
          )}
        </>
      )}
      <p className="pm-nota">
        Es el estatus que tiene hoy cada prospecto. Con un periodo, solo cuenta los que se registraron en esas fechas.
        Da clic en un número para ver cuáles son.
      </p>
    </div>
  );
}
