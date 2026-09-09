"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  notas: string | null;
  proveedor_id: string | null;
  factura_url: string | null;
  comprobante_pago_url: string | null;
  centro?: string | null;
};
type Proveedor = { id: string; nombre: string };

function primerDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}
function ultimoDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function IngresosCentroPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const esGlobal = ROLES_GLOBALES.includes(miRol);

  const [tab, setTab] = useState<"resumen" | "gastos">("resumen");

  const [fechaDesde, setFechaDesde] = useState(primerDiaMes());
  const [fechaHasta, setFechaHasta] = useState(ultimoDiaMes());
  const [totalIngresos, setTotalIngresos] = useState(0);
  const [totalGastos, setTotalGastos] = useState(0);

  // ---- Gastos (pestaña propia, dentro de esta misma pantalla) ----
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargandoGastos, setCargandoGastos] = useState(true);
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [errorGasto, setErrorGasto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [fechaGasto, setFechaGasto] = useState(hoyISO());
  const [notasGasto, setNotasGasto] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [factura, setFactura] = useState<File[]>([]);
  const [comprobante, setComprobante] = useState<File[]>([]);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, fechaDesde, fechaHasta]);

  useEffect(() => {
    if (centro) cargarGastos(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

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
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    // Ingresos = dinero que efectivamente entró (pagos.estado = 'pagado'),
    // no lo facturado — por eso sale de `pagos` y no de `facturas`, que
    // puede incluir pendientes/vencidas.
    const [{ data: pagosData }, { data: gastosData }] = await Promise.all([
      supabase
        .from("pagos")
        .select("monto")
        .eq("centro", c)
        .eq("estado", "pagado")
        .gte("fecha_pago", fechaDesde)
        .lte("fecha_pago", fechaHasta),
      supabase.from("gastos").select("monto").eq("centro", c).gte("fecha", fechaDesde).lte("fecha", fechaHasta),
    ]);
    setTotalIngresos((pagosData || []).reduce((s, p) => s + Number(p.monto), 0));
    setTotalGastos((gastosData || []).reduce((s, g) => s + Number(g.monto), 0));
    setLoading(false);
  }

  async function cargarGastos(c: string) {
    setCargandoGastos(true);
    const [{ data: gastosData }, { data: provsData }] = await Promise.all([
      supabase.from("gastos").select("*").eq("centro", c).order("fecha", { ascending: false }),
      supabase.from("proveedores").select("id, nombre").eq("centro", c).order("nombre"),
    ]);
    setGastos(gastosData || []);
    setProveedores(provsData || []);
    setCargandoGastos(false);
  }

  function resetFormGasto() {
    setConcepto("");
    setCategoria("");
    setMonto("");
    setFechaGasto(hoyISO());
    setNotasGasto("");
    setProveedorId("");
    setFactura([]);
    setComprobante([]);
  }

  async function subirArchivoGasto(archivo: File, prefijo: string) {
    const fileName = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
      archivo.name.split(".").pop() || "jpg"
    }`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
    if (uploadError) return null;
    const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function registrarGasto(e: React.FormEvent) {
    e.preventDefault();
    if (!centro) return;
    if (!concepto.trim() || !monto || !fechaGasto) {
      setErrorGasto("Completa concepto, monto y fecha");
      return;
    }
    setGuardandoGasto(true);
    setErrorGasto("");

    const facturaUrl = factura[0] ? await subirArchivoGasto(factura[0], "factura") : null;
    const comprobanteUrl = comprobante[0] ? await subirArchivoGasto(comprobante[0], "pago") : null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from("gastos").insert({
      concepto: concepto.trim(),
      categoria: categoria.trim() || null,
      monto: Number(monto),
      fecha: fechaGasto,
      notas: notasGasto.trim() || null,
      centro,
      proveedor_id: proveedorId || null,
      factura_url: facturaUrl,
      comprobante_pago_url: comprobanteUrl,
      registrado_por: user?.id,
    });

    if (insertError) {
      setErrorGasto("No se pudo registrar el gasto. Intenta de nuevo.");
      setGuardandoGasto(false);
      return;
    }

    resetFormGasto();
    setGuardandoGasto(false);
    cargarGastos(centro);
    fetchTodo(centro);
  }

  const proveedorNombre = (id: string | null) => proveedores.find((p) => p.id === id)?.nombre;
  const totalGastosCentro = useMemo(() => gastos.reduce((s, g) => s + Number(g.monto), 0), [gastos]);

  const gananciaNeta = useMemo(() => totalIngresos - totalGastos, [totalIngresos, totalGastos]);

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Ingresos por Centro</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!centro ? (
        <div className="rep-content">
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        </div>
      ) : (
        <>
          <div className="centro-tabs">
            <button className={"centro-tab" + (tab === "resumen" ? " active" : "")} onClick={() => setTab("resumen")}>
              📊 Resumen
            </button>
            <button className={"centro-tab" + (tab === "gastos" ? " active" : "")} onClick={() => setTab("gastos")}>
              💸 Gastos
            </button>
          </div>

          <div className="rep-content">
            {tab === "resumen" && (
              <>
                <div className="form-card">
                  <div className="tel-form-grid">
                    <div>
                      <p className="sub-label">Desde</p>
                      <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
                    </div>
                    <div>
                      <p className="sub-label">Hasta</p>
                      <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
                    </div>
                  </div>
                </div>

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
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#0F6E56" }}>
                          ${totalIngresos.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Ingresos</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: "#A32D2D" }}>
                          ${totalGastos.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Gastos</p>
                      </div>
                      <div className="stat-card">
                        <p className="stat-val" style={{ color: gananciaNeta >= 0 ? "#0F6E56" : "#A32D2D" }}>
                          ${gananciaNeta.toLocaleString("es-MX")}
                        </p>
                        <p className="stat-lbl">Ganancia neta</p>
                      </div>
                    </div>

                    <p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
                      Desglose por departamento: próximamente.
                    </p>
                  </>
                )}
              </>
            )}

            {tab === "gastos" && (
              <>
                <div className="gastos-total-card">
                  <p className="gastos-total-monto">
                    ${totalGastosCentro.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                  </p>
                  <p className="gastos-total-lbl">Total registrado en {centro}</p>
                </div>

                <p className="panel-section-label" style={{ marginTop: 12 }}>
                  Registrar gasto
                </p>
                <form className="form-card" onSubmit={registrarGasto}>
                  <div className="tel-form-grid">
                    <input placeholder="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
                    <input
                      placeholder="Categoría (ej. Renta, Mantenimiento)"
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Monto"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                    />
                    <input type="date" value={fechaGasto} onChange={(e) => setFechaGasto(e.target.value)} />
                  </div>
                  <input
                    type="text"
                    placeholder="Notas"
                    value={notasGasto}
                    onChange={(e) => setNotasGasto(e.target.value)}
                  />
                  <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                    <option value="">Sin proveedor (opcional)</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                  <p className="sub-label">Factura</p>
                  <FileDropzone files={factura} onChange={setFactura} maxFiles={1} accept="image/*,.pdf" />
                  <p className="sub-label">Comprobante de pago</p>
                  <FileDropzone files={comprobante} onChange={setComprobante} maxFiles={1} accept="image/*,.pdf" />

                  {errorGasto && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorGasto}</p>}

                  <button className="btn-enviar" type="submit" disabled={guardandoGasto}>
                    {guardandoGasto ? "Guardando..." : "+ Agregar gasto"}
                  </button>
                </form>

                <p className="panel-section-label" style={{ marginTop: 12 }}>
                  Historial ({gastos.length})
                </p>
                {cargandoGastos ? (
                  <div className="nodus-inline-loading">
                    <div className="nodus-spinner nodus-spinner-sm">
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                      <span className="nodus-spinner-petal"></span>
                    </div>
                    <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
                  </div>
                ) : gastos.length === 0 ? (
                  <div className="empty-card">Sin gastos registrados en este centro</div>
                ) : (
                  gastos.map((g) => (
                    <div className="item-card" key={g.id}>
                      <div className="item-card-info">
                        <p className="item-card-titulo">{g.concepto}</p>
                        <p className="item-card-sub">
                          {new Date(g.fecha).toLocaleDateString("es-MX")}
                          {g.categoria ? ` · ${g.categoria}` : ""}
                          {proveedorNombre(g.proveedor_id) ? ` · ${proveedorNombre(g.proveedor_id)}` : ""}
                        </p>
                        {g.notas && <p className="item-card-extra">{g.notas}</p>}
                        {(g.factura_url || g.comprobante_pago_url) && (
                          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                            {g.factura_url && (
                              <a href={g.factura_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                📎 Factura
                              </a>
                            )}
                            {g.comprobante_pago_url && (
                              <a
                                href={g.comprobante_pago_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: 11, color: "#185FA5" }}
                              >
                                🧾 Comprobante de pago
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="item-card-monto">${Number(g.monto).toLocaleString("es-MX")}</p>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
