"use client";

import { useEffect, useState } from "react";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";
import { OPCIONES_PERIODO, rango, type Periodo } from "@/lib/periodoReporte";

// Periodo (y centro, para roles globales) de los reportes de /reportes. Devuelve desde/hasta ya calculados.
export function useFiltrosReporte(esGlobal: boolean, centroFijo?: string | null, periodoInicial: Periodo = "mes") {
  const hoy = hoyMexicoISO();
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);
  const [desdeOtro, setDesdeOtro] = useState(hoy.slice(0, 8) + "01");
  const [hastaOtro, setHastaOtro] = useState(hoy);
  const [centro, setCentro] = useState(esGlobal ? "" : centroFijo || "");
  const { desde, hasta } = rango(periodo, hoy, desdeOtro, hastaOtro);
  const textoPeriodo = periodo === "todo" ? "Todo el historial" : `Del ${desde} al ${hasta}`;

  const filtros = (conTodo = false) => (
    <div className="pm-filtros">
      <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
        {conTodo && <option value="todo">Todo el historial</option>}
        {OPCIONES_PERIODO.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.label}
          </option>
        ))}
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
  );

  const params = () => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (centro) p.set("centro", centro);
    return p.toString();
  };

  return { periodo, desde, hasta, centro, setCentro, textoPeriodo, filtros, params };
}

// Carga el JSON de un reporte cada vez que cambian los filtros (`query`).
export function useDatosReporte<T>(url: string, query: string) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    fetch(`${url}?${query}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (!vigente) return;
        if (ok) setDatos(d as T);
        else setError(d.error || "No se pudo cargar el reporte");
      })
      .catch(() => vigente && setError("No se pudo conectar"))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [url, query]);
  return { datos, cargando, error };
}
