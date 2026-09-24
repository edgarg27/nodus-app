"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";

// atencion_cliente es cuenta sin centro: ve todos, con selector.
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "operaciones", "atencion_cliente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const ESTADOS: Record<string, { label: string; bg: string; color: string }> = {
  operativo: { label: "Operativo", bg: "#E1F5EE", color: "#0F6E56" },
  danado: { label: "Dañado", bg: "#FCEBEB", color: "#A32D2D" },
  en_reparacion: { label: "En reparación", bg: "#FAEEDA", color: "#854F0B" },
  baja: { label: "Dado de baja", bg: "#F0F0F0", color: "#666" },
};

// Cada área tiene su propio inventario (migracion_inventario_por_area.sql):
// Sistemas, Servicio al Cliente y Operaciones ven solo el suyo;
// admins/gerente solo el General; la superadmin ve todos para
// corroborar. La RLS lo respalda.
type Area = "sistemas" | "atencion_cliente" | "operaciones" | "general";
type FiltroArea = Area | "todos";
const AREAS: Record<Area, string> = {
  sistemas: "Sistemas",
  atencion_cliente: "Servicio al Cliente",
  operaciones: "Operaciones",
  general: "General",
};

function areaPropia(rol: string): Area {
  return rol === "sistemas" || rol === "atencion_cliente" || rol === "operaciones" ? rol : "general";
}

type Item = {
  id: string;
  area: Area;
  registrado_por: string | null;
  dispositivo: string;
  marca_modelo: string | null;
  numero_serie: string | null;
  cantidad: number;
  ubicacion: string | null;
  estado: string;
  notas: string | null;
};

export default function InventarioPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroArea, setFiltroArea] = useState<FiltroArea>("todos");
  const [nombrePorId, setNombrePorId] = useState<Record<string, string>>({});
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const esGlobal = ROLES_GLOBALES.includes(miRol);
  const esSuper = miRol === "superadmin";

  // Superadmin: el filtro que eligió; los demás: siempre su propia área.
  function areaAFiltrar(rol: string, filtro: FiltroArea): Area | null {
    if (rol === "superadmin") return filtro === "todos" ? null : filtro;
    return areaPropia(rol);
  }

  // Para la columna "Registró" (solo superadmin).
  async function cargarNombres(lista: Item[]) {
    const ids = Array.from(new Set(lista.map((i) => i.registrado_por).filter((x): x is string => !!x)));
    if (ids.length === 0) return {} as Record<string, string>;
    const { data } = await supabase.from("profiles").select("id, nombre").in("id", ids);
    return Object.fromEntries((data || []).map((p) => [p.id, p.nombre || ""])) as Record<string, string>;
  }
  const [exportandoTodo, setExportandoTodo] = useState(false);

  async function exportarTodosLosCentros() {
    setExportandoTodo(true);
    try {
      const resultados = await Promise.all(
        centrosDisponibles.map(async (c) => {
          let q = supabase.from("inventario").select("*").eq("centro", c);
          const area = areaAFiltrar(miRol, filtroArea);
          if (area) q = q.eq("area", area);
          const { data } = await q.order("dispositivo");
          const nombres: Record<string, string> = esSuper ? await cargarNombres(data || []) : {};
          return [
            c,
            (data || []).map((i: Item) => ({
              ...(esSuper
                ? { Área: AREAS[i.area] || i.area, Registró: (i.registrado_por && nombres[i.registrado_por]) || "" }
                : {}),
              Dispositivo: i.dispositivo,
              "Marca/Modelo": i.marca_modelo || "",
              "Número de serie": i.numero_serie || "",
              Cantidad: i.cantidad,
              Ubicación: i.ubicacion || "",
              Estado: ESTADOS[i.estado]?.label || i.estado,
              Notas: i.notas || "",
            })),
          ] as const;
        })
      );
      exportarExcelPorCentro("inventario", Object.fromEntries(resultados));
    } finally {
      setExportandoTodo(false);
    }
  }

  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    dispositivo: "",
    marca_modelo: "",
    numero_serie: "",
    cantidad: "1",
    ubicacion: "",
    estado: "operativo",
    notas: "",
    area: "general" as Area,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      const c = profile?.centro || CENTROS_SUGERIDOS[0];
      setCentro(c);
      await fetchItems(c, rol);
    } else {
      const c = profile?.centro || null;
      setCentro(c);
      if (c) await fetchItems(c, rol);
    }
    setLoading(false);
  }

  async function cambiarCentro(c: string) {
    setCentro(c);
    setLoading(true);
    await fetchItems(c);
    setLoading(false);
  }

  async function cambiarFiltroArea(f: FiltroArea) {
    setFiltroArea(f);
    if (!centro) return;
    setLoading(true);
    await fetchItems(centro, miRol, f);
    setLoading(false);
  }

  async function fetchItems(c: string, rol: string = miRol, filtro: FiltroArea = filtroArea) {
    let q = supabase.from("inventario").select("*").eq("centro", c);
    const area = areaAFiltrar(rol, filtro);
    if (area) q = q.eq("area", area);
    const { data } = await q.order("dispositivo");
    setItems(data || []);
    if (rol === "superadmin") setNombrePorId(await cargarNombres(data || []));
  }

  const itemsFiltrados = items.filter((i) => {
    const q = busqueda.toLowerCase();
    return (
      !q ||
      i.dispositivo.toLowerCase().includes(q) ||
      i.numero_serie?.toLowerCase().includes(q) ||
      i.marca_modelo?.toLowerCase().includes(q) ||
      i.ubicacion?.toLowerCase().includes(q)
    );
  });

  async function guardarItem(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!centro || !form.dispositivo.trim()) {
      setError("Ponle un nombre al dispositivo");
      return;
    }
    setGuardando(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from("inventario").insert({
      centro,
      area: esSuper ? form.area : areaPropia(miRol),
      dispositivo: form.dispositivo,
      marca_modelo: form.marca_modelo || null,
      numero_serie: form.numero_serie || null,
      cantidad: Number(form.cantidad) || 1,
      ubicacion: form.ubicacion || null,
      estado: form.estado,
      notas: form.notas || null,
      registrado_por: user?.id,
    });

    if (insertError) {
      setError(`No se pudo guardar: ${insertError.message}`);
      setGuardando(false);
      return;
    }

    setForm({
      dispositivo: "",
      marca_modelo: "",
      numero_serie: "",
      cantidad: "1",
      ubicacion: "",
      estado: "operativo",
      notas: "",
      area: form.area,
    });
    setMostrarForm(false);
    setGuardando(false);
    fetchItems(centro);
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from("inventario").update({ estado }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, estado } : i)));
  }

  async function borrarItem(id: string) {
    setBorrandoId(null);
    await supabase.from("inventario").delete().eq("id", id);
    if (centro) fetchItems(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Inventario</p>
        <p className="rep-sub">
          {centro || "Selecciona un centro"}
          {miRol && !esSuper ? ` · Inventario ${AREAS[areaPropia(miRol)]}` : ""}
        </p>
        {((esGlobal && centrosDisponibles.length > 1) || esSuper) && (
          <div className="centro-selector">
            {esGlobal && centrosDisponibles.length > 1 && (
              <select value={centro || ""} onChange={(e) => cambiarCentro(e.target.value)}>
                {centrosDisponibles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {esSuper && (
              <select value={filtroArea} onChange={(e) => cambiarFiltroArea(e.target.value as FiltroArea)}>
                <option value="todos">Todos los inventarios</option>
                <option value="sistemas">Inventario Sistemas</option>
                <option value="atencion_cliente">Inventario Servicio al Cliente</option>
                <option value="general">Inventario General</option>
              </select>
            )}
          </div>
        )}
      </div>

      <div className="rep-content">
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
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Equipo registrado ({items.length})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-exportar"
                  disabled={exportandoTodo}
                  onClick={() =>
                    esGlobal
                      ? exportarTodosLosCentros()
                      : exportarExcel(
                          `inventario-${centro}`,
                          items.map((i) => ({
                            ...(esSuper
                              ? { Área: AREAS[i.area] || i.area, Registró: (i.registrado_por && nombrePorId[i.registrado_por]) || "" }
                              : {}),
                            Dispositivo: i.dispositivo,
                            "Marca/Modelo": i.marca_modelo || "",
                            "Número de serie": i.numero_serie || "",
                            Cantidad: i.cantidad,
                            Ubicación: i.ubicacion || "",
                            Estado: ESTADOS[i.estado]?.label || i.estado,
                            Notas: i.notas || "",
                          }))
                        )
                  }
                >
                  {exportandoTodo ? "Generando..." : esGlobal ? "📥 Excel (todos los centros)" : "📥 Excel"}
                </button>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarForm((v) => !v)}
                >
                  {mostrarForm ? "Cancelar" : "+ Agregar"}
                </button>
              </div>
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={guardarItem}>
                <div className="tel-form-grid">
                  <input
                    placeholder="Dispositivo (ej. Switch 24 puertos)"
                    value={form.dispositivo}
                    onChange={(e) => setForm({ ...form, dispositivo: e.target.value })}
                  />
                  <input
                    placeholder="Marca / Modelo"
                    value={form.marca_modelo}
                    onChange={(e) => setForm({ ...form, marca_modelo: e.target.value })}
                  />
                  <input
                    placeholder="Número de serie"
                    value={form.numero_serie}
                    onChange={(e) => setForm({ ...form, numero_serie: e.target.value })}
                  />
                  <input
                    type="number"
                    min={1}
                    placeholder="Cantidad"
                    value={form.cantidad}
                    onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                  />
                  <input
                    placeholder="Ubicación (ej. Site, Piso 2)"
                    value={form.ubicacion}
                    onChange={(e) => setForm({ ...form, ubicacion: e.target.value })}
                  />
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                    {Object.entries(ESTADOS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  {esSuper && (
                    <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value as Area })}>
                      <option value="general">Inventario General</option>
                      <option value="sistemas">Inventario Sistemas</option>
                      <option value="atencion_cliente">Inventario Servicio al Cliente</option>
                    </select>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Notas (opcional)"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                />
                {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
                <button className="btn-enviar" type="submit" disabled={guardando}>
                  {guardando ? "Guardando..." : "Guardar en inventario"}
                </button>
              </form>
            )}

            <input
              type="text"
              placeholder="Buscar por dispositivo, serie, marca o ubicación..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            />

            {itemsFiltrados.length === 0 ? (
              <div className="empty-card">Sin artículos que coincidan</div>
            ) : (
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Dispositivo</th>
                      <th>Marca/Modelo</th>
                      <th>N° Serie</th>
                      <th>Cant.</th>
                      <th>Ubicación</th>
                      <th>Estado</th>
                      {esSuper && <th>Área</th>}
                      {esSuper && <th>Registró</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsFiltrados.map((i) => {
                      const est = ESTADOS[i.estado] || ESTADOS.operativo;
                      return (
                        <tr key={i.id}>
                          <td style={{ fontWeight: 600 }}>{i.dispositivo}</td>
                          <td>{i.marca_modelo || "—"}</td>
                          <td style={{ fontFamily: "monospace" }}>{i.numero_serie || "—"}</td>
                          <td>{i.cantidad}</td>
                          <td>{i.ubicacion || "—"}</td>
                          <td>
                            <select
                              value={i.estado}
                              onChange={(e) => cambiarEstado(i.id, e.target.value)}
                              className="estado-pill"
                              style={{ background: est.bg, color: est.color, border: "none" }}
                            >
                              {Object.entries(ESTADOS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          {esSuper && <td>{AREAS[i.area] || i.area}</td>}
                          {esSuper && <td>{(i.registrado_por && nombrePorId[i.registrado_por]) || "—"}</td>}
                          <td>
                            <button className="tel-borrar-btn" onClick={() => setBorrandoId(i.id)}>
                              🗑
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {borrandoId && (
        <div className="modal-overlay" onClick={() => setBorrandoId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Borrar artículo</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Borrar este artículo del inventario?
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setBorrandoId(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => borrarItem(borrandoId)}>
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
