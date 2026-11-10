"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";
import { labelRol } from "@/lib/roles";
import { TEXTO_ACCION, textoAccion } from "@/lib/bitacoraTipos";

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const POR_PAGINA = 50;

type Movimiento = {
  id: string;
  creado_en: string;
  actor_nombre: string | null;
  actor_rol: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  folio: string | null;
  cliente_nombre: string | null;
  centro: string | null;
  monto: number | null;
  detalle: string | null;
};

const moneda = (n: number | null) =>
  typeof n === "number" ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "—";

// Fecha y hora en horario de México.
function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BitacoraPage() {
  const supabase = createClient();
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [buscar, setBuscar] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [centro, setCentro] = useState("");
  const [accion, setAccion] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    let q = supabase
      .from("bitacora_movimientos")
      .select("id, creado_en, actor_nombre, actor_rol, accion, entidad, entidad_id, folio, cliente_nombre, centro, monto, detalle", { count: "exact" })
      .order("creado_en", { ascending: false });

    if (centro) q = q.eq("centro", centro);
    if (accion) q = q.eq("accion", accion);
    if (desde) q = q.gte("creado_en", `${desde}T00:00:00`);
    if (hasta) q = q.lte("creado_en", `${hasta}T23:59:59.999`);
    if (busquedaActiva) {
      const t = busquedaActiva.replace(/[%,]/g, " ").trim();
      if (t) q = q.or(`cliente_nombre.ilike.%${t}%,folio.ilike.%${t}%,actor_nombre.ilike.%${t}%`);
    }

    const { data, count, error: err } = await q.range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (err) {
      setError("No se pudo cargar la bitácora.");
      setMovimientos([]);
      setTotal(0);
    } else {
      setMovimientos((data as Movimiento[]) || []);
      setTotal(count || 0);
    }
    setLoading(false);
  }, [supabase, centro, accion, desde, hasta, busquedaActiva, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al cambiar un filtro se vuelve a la primera página.
  function alFiltrar(fn: () => void) {
    setPagina(0);
    fn();
  }

  function aplicarBusqueda() {
    setPagina(0);
    setBusquedaActiva(buscar.trim());
  }

  async function exportar() {
    // Exporta lo que coincide con los filtros (hasta 2000 renglones), no solo la página visible.
    let q = supabase
      .from("bitacora_movimientos")
      .select("creado_en, actor_nombre, actor_rol, accion, folio, cliente_nombre, centro, monto, detalle")
      .order("creado_en", { ascending: false })
      .limit(2000);
    if (centro) q = q.eq("centro", centro);
    if (accion) q = q.eq("accion", accion);
    if (desde) q = q.gte("creado_en", `${desde}T00:00:00`);
    if (hasta) q = q.lte("creado_en", `${hasta}T23:59:59.999`);
    if (busquedaActiva) {
      const t = busquedaActiva.replace(/[%,]/g, " ").trim();
      if (t) q = q.or(`cliente_nombre.ilike.%${t}%,folio.ilike.%${t}%,actor_nombre.ilike.%${t}%`);
    }
    const { data } = await q;
    const filas = (data as Movimiento[] | null) || [];
    if (filas.length === 0) {
      alert("No hay movimientos para exportar");
      return;
    }
    exportarExcel(
      "bitacora_pagos_facturas",
      filas.map((m) => ({
        "Fecha y hora": fechaHora(m.creado_en),
        Quién: m.actor_nombre || "—",
        Rol: m.actor_rol ? labelRol(m.actor_rol) : "—",
        Acción: textoAccion(m.accion),
        Cliente: m.cliente_nombre || "—",
        Folio: m.folio || "—",
        Centro: m.centro || "—",
        Monto: typeof m.monto === "number" ? m.monto : "",
        Detalle: m.detalle || "",
      }))
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Bitácora de pagos y facturas</p>
        <p className="rep-sub">Quién registró cada movimiento, sobre qué cliente y cuándo</p>
      </div>

      <div className="rep-content">
        <div className="form-card">
          <div className="tel-form-grid">
            <div>
              <p className="sub-label">Buscar (cliente, folio o persona)</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={buscar}
                  placeholder="Nombre, folio…"
                  onChange={(e) => setBuscar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") aplicarBusqueda();
                  }}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-secundario" onClick={aplicarBusqueda}>
                  Buscar
                </button>
              </div>
            </div>
            <div>
              <p className="sub-label">Acción</p>
              <select value={accion} onChange={(e) => alFiltrar(() => setAccion(e.target.value))}>
                <option value="">Todas</option>
                {Object.entries(TEXTO_ACCION).map(([val, txt]) => (
                  <option key={val} value={val}>
                    {txt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Centro</p>
              <select value={centro} onChange={(e) => alFiltrar(() => setCentro(e.target.value))}>
                <option value="">Todos</option>
                {CENTROS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Desde</p>
              <input type="date" value={desde} onChange={(e) => alFiltrar(() => setDesde(e.target.value))} />
            </div>
            <div>
              <p className="sub-label">Hasta</p>
              <input type="date" value={hasta} onChange={(e) => alFiltrar(() => setHasta(e.target.value))} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 12, flexWrap: "wrap" }}>
            <p style={{ margin: 0, color: "#5b6478", fontSize: 13 }}>{total} movimiento(s)</p>
            <button type="button" className="btn-secundario" onClick={exportar}>
              Exportar a Excel
            </button>
          </div>
        </div>

        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : movimientos.length === 0 ? (
          <div className="empty-card">Sin movimientos con estos filtros</div>
        ) : (
          <>
            <div className="form-card ft-tabla-wrap" style={{ padding: 0 }}>
              <table className="ft-tabla" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Quién</th>
                    <th>Acción</th>
                    <th>Cliente</th>
                    <th>Folio</th>
                    <th>Centro</th>
                    <th className="ft-num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id}>
                      <td className="ft-nowrap">{fechaHora(m.creado_en)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.actor_nombre || "—"}</div>
                        {m.actor_rol && <div style={{ fontSize: 12, color: "#5b6478" }}>{labelRol(m.actor_rol)}</div>}
                      </td>
                      <td>
                        <div>{textoAccion(m.accion)}</div>
                        {m.detalle && <div style={{ fontSize: 12, color: "#5b6478" }}>{m.detalle}</div>}
                      </td>
                      <td>{m.cliente_nombre || "—"}</td>
                      <td className="ft-nowrap">{m.folio || "—"}</td>
                      <td className="ft-nowrap">{m.centro || "—"}</td>
                      <td className="ft-num ft-nowrap">{moneda(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPaginas > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 12 }}>
                <button type="button" className="btn-secundario" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>
                  ← Anterior
                </button>
                <span style={{ fontSize: 13, color: "#5b6478" }}>
                  Página {pagina + 1} de {totalPaginas}
                </span>
                <button
                  type="button"
                  className="btn-secundario"
                  disabled={pagina + 1 >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
