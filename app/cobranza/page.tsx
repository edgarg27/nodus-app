"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza"];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type ClienteCobranza = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  centro: string | null;
  suspendido: boolean;
  suspendido_desde: string | null;
  dia_pago: number | null;
  renta_mensual: number | null;
  ultimaFacturaEstado: string | null;
  ultimaFacturaFolio: string | null;
  ultimaFacturaMonto: number | null;
};

type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  notas: string | null;
  tipo: string | null;
  centro: string | null;
};

export default function CobranzaPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState("");
  const [esGlobal, setEsGlobal] = useState(false);
  const [centro, setCentro] = useState<string | null>(null);
  const [tab, setTab] = useState<"clientes" | "gastos">(
    searchParams.get("tab") === "gastos" ? "gastos" : "clientes"
  );

  const [clientes, setClientes] = useState<ClienteCobranza[]>([]);
  const [filtroPago, setFiltroPago] = useState<"todos" | "corriente" | "pendiente" | "vencida">("todos");
  const [ejecutando, setEjecutando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState("");

  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [cargandoGastos, setCargandoGastos] = useState(false);
  const [anioGastos, setAnioGastos] = useState(new Date().getFullYear());

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const miRol = profile?.rol || "";
    const global = ROLES_GLOBALES.includes(miRol);
    setRol(miRol);
    setEsGlobal(global);
    setCentro(profile?.centro || null);

    // Los roles globales ven todos los centros aunque su perfil no tenga
    // uno fijo asignado — no bloqueamos la pantalla por eso.
    await fetchClientes(profile?.centro || null, miRol);
    if (global) await fetchGastosGlobales();
    setLoading(false);
  }

  async function fetchClientes(c: string | null, rolActual: string) {
    let query = supabase
      .from("profiles")
      .select("id, nombre, email, empresa, centro, suspendido, suspendido_desde")
      .eq("rol", "cliente")
      .eq("activo", true)
      .order("nombre");
    if (!ROLES_GLOBALES.includes(rolActual) && c) query = query.eq("centro", c);
    const { data: perfiles } = await query;

    const lista: ClienteCobranza[] = [];
    for (const p of perfiles || []) {
      const { data: contrato } = await supabase
        .from("contratos")
        .select("dia_pago, renta_mensual")
        .eq("user_id", p.id)
        .eq("estatus", "vigente")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: ultimaFactura } = await supabase
        .from("facturas")
        .select("folio, monto, estado")
        .eq("user_id", p.id)
        .order("fecha_emision", { ascending: false })
        .limit(1)
        .maybeSingle();

      lista.push({
        ...p,
        dia_pago: contrato?.dia_pago ?? null,
        renta_mensual: contrato?.renta_mensual ?? null,
        ultimaFacturaEstado: ultimaFactura?.estado ?? null,
        ultimaFacturaFolio: ultimaFactura?.folio ?? null,
        ultimaFacturaMonto: ultimaFactura?.monto ?? null,
      });
    }
    setClientes(lista);
  }

  // Todos los gastos, de todos los centros y todos los departamentos
  // (sistemas, operaciones, admin) — cobranza necesita ver el panorama
  // completo de dinero saliendo, no solo lo de un centro.
  async function fetchGastosGlobales() {
    setCargandoGastos(true);
    const { data } = await supabase.from("gastos").select("*").order("fecha", { ascending: false });
    setGastos(data || []);
    setCargandoGastos(false);
  }

  async function ejecutarCobranza() {
    if (!confirm("¿Ejecutar la cobranza ahora? Esto genera facturas, manda recordatorios y puede suspender a quien no haya pagado.")) return;
    setEjecutando(true);
    setError("");
    setResultado(null);
    try {
      const res = await fetch("/api/cron/facturacion-diaria", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo ejecutar la cobranza");
      } else {
        setResultado(data.resumen);
        fetchClientes(centro, rol);
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setEjecutando(false);
  }

  const badgeInfo = (estado: string | null) =>
    estado === "pagada"
      ? { bg: "#E1F5EE", texto: "✓ Al corriente" }
      : estado === "vencida"
      ? { bg: "#FCEBEB", texto: "⚠️ Vencida" }
      : estado === "pendiente"
      ? { bg: "#FAEEDA", texto: "⏳ Pendiente" }
      : { bg: "#F0F0F0", texto: "Sin facturas" };

  const clientesFiltrados = clientes.filter((c) => {
    if (filtroPago === "todos") return true;
    if (filtroPago === "corriente") return c.ultimaFacturaEstado === "pagada";
    if (filtroPago === "pendiente") return c.ultimaFacturaEstado === "pendiente";
    if (filtroPago === "vencida") return c.ultimaFacturaEstado === "vencida";
    return true;
  });

  const conteoPago = {
    corriente: clientes.filter((c) => c.ultimaFacturaEstado === "pagada").length,
    pendiente: clientes.filter((c) => c.ultimaFacturaEstado === "pendiente").length,
    vencida: clientes.filter((c) => c.ultimaFacturaEstado === "vencida").length,
  };

  // ---------- Gráficas de gastos ----------
  function renderBarras(titulo: string, datos: { centro: string; valor: number }[], color: string) {
    const max = Math.max(...datos.map((d) => d.valor), 1);
    const total = datos.reduce((s, d) => s + d.valor, 0);
    return (
      <div className="rep-ocupacion-card" style={{ marginBottom: 12 }}>
        <div className="rep-ocupacion-header">
          <span className="rep-ocupacion-centro">{titulo}</span>
          <span className="rep-ocupacion-porcentaje">
            ${total.toLocaleString("es-MX", { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {datos.map((d) => (
            <div key={d.centro}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span>{d.centro}</span>
                <b>${d.valor.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</b>
              </div>
              <div style={{ background: "#f0f0f0", borderRadius: 6, height: 10, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(d.valor / max) * 100}%`,
                    background: color,
                    height: "100%",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const centrosConGasto = Array.from(new Set(gastos.map((g) => g.centro || "Sin centro"))).sort();
  const gastosPorCentro = centrosConGasto.map((c) => ({
    centro: c,
    valor: gastos.filter((g) => (g.centro || "Sin centro") === c).reduce((s, g) => s + Number(g.monto), 0),
  }));
  const gastosPorDepto = ["sistemas", "operaciones", "admin"].map((t) => ({
    centro: t === "sistemas" ? "🖥️ Sistemas" : t === "operaciones" ? "🔧 Operaciones" : "🧑‍💼 Admin",
    valor: gastos.filter((g) => (g.tipo || "admin") === t).reduce((s, g) => s + Number(g.monto), 0),
  }));
  const totalGlobal = gastos.reduce((s, g) => s + Number(g.monto), 0);
  const aniosDisponibles = Array.from(
    new Set([...gastos.map((g) => new Date(g.fecha).getFullYear()), new Date().getFullYear()])
  ).sort((a, b) => b - a);
  const gastosPorMesGlobal = MESES.map((m, i) => ({
    centro: m,
    valor: gastos
      .filter((g) => {
        const d = new Date(g.fecha);
        return d.getFullYear() === anioGastos && d.getMonth() === i;
      })
      .reduce((s, g) => s + Number(g.monto), 0),
  }));

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Cobranza</p>
        <p className="rep-sub">{esGlobal ? "Todos los centros" : centro || "Selecciona un centro"}</p>
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
        ) : (
          <>
            {esGlobal && (
              <div className="tickets-filtros">
                <button
                  className={"filtro-chip" + (tab === "clientes" ? " active" : "")}
                  onClick={() => setTab("clientes")}
                >
                  👥 Clientes
                </button>
                <button
                  className={"filtro-chip" + (tab === "gastos" ? " active" : "")}
                  onClick={() => setTab("gastos")}
                >
                  💸 Gastos
                </button>
              </div>
            )}

            {tab === "clientes" && (
              <>
                <button className="btn-ejecutar-cobranza" onClick={ejecutarCobranza} disabled={ejecutando}>
                  {ejecutando ? "Ejecutando..." : "⚡ Ejecutar cobranza ahora"}
                </button>
                <p style={{ fontSize: 11, color: "#aaa", margin: 0 }}>
                  Normalmente esto corre solo, todos los días, una vez que el sitio esté publicado en
                  internet. Este botón sirve para probarlo o forzarlo manualmente mientras tanto.
                </p>

                {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
                {resultado && (
                  <div className="nota-info">
                    Recordatorios: {resultado.recordatorios} · Facturas generadas:{" "}
                    {resultado.facturasGeneradas} · SPEI generados: {resultado.speiGenerados} ·
                    Vouchers renovados: {resultado.vouchersGenerados} · Suspendidos:{" "}
                    {resultado.suspendidos}
                    {resultado.errores?.length > 0 && (
                      <div style={{ color: "#A32D2D", marginTop: 6 }}>
                        {resultado.errores.map((e: string, i: number) => (
                          <p key={i} style={{ margin: 0 }}>
                            {e}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="tickets-filtros" style={{ marginTop: 12 }}>
                  <button
                    className={"filtro-chip" + (filtroPago === "todos" ? " active" : "")}
                    onClick={() => setFiltroPago("todos")}
                  >
                    Todos ({clientes.length})
                  </button>
                  <button
                    className={"filtro-chip" + (filtroPago === "corriente" ? " active" : "")}
                    onClick={() => setFiltroPago("corriente")}
                  >
                    ✓ Al corriente ({conteoPago.corriente})
                  </button>
                  <button
                    className={"filtro-chip" + (filtroPago === "pendiente" ? " active" : "")}
                    onClick={() => setFiltroPago("pendiente")}
                  >
                    ⏳ No ha pagado ({conteoPago.pendiente})
                  </button>
                  <button
                    className={"filtro-chip" + (filtroPago === "vencida" ? " active" : "")}
                    onClick={() => setFiltroPago("vencida")}
                  >
                    ⚠️ Atrasado ({conteoPago.vencida})
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    Clientes ({clientesFiltrados.length})
                  </p>
                  <button
                    className="btn-exportar"
                    onClick={() => {
                      if (esGlobal) {
                        const porCentro: Record<string, Record<string, any>[]> = {};
                        clientesFiltrados.forEach((c) => {
                          const key = c.centro || "Sin centro";
                          if (!porCentro[key]) porCentro[key] = [];
                          porCentro[key].push({
                            Nombre: c.nombre,
                            Empresa: c.empresa || "",
                            "Día de pago": c.dia_pago || "",
                            "Renta mensual": c.renta_mensual || "",
                            "Última factura": c.ultimaFacturaFolio || "",
                            Estado: c.ultimaFacturaEstado || "",
                            Suspendido: c.suspendido ? "Sí" : "No",
                          });
                        });
                        exportarExcelPorCentro("cobranza", porCentro);
                      } else {
                        exportarExcel(
                          `cobranza-${centro}`,
                          clientesFiltrados.map((c) => ({
                            Nombre: c.nombre,
                            Empresa: c.empresa || "",
                            "Día de pago": c.dia_pago || "",
                            "Renta mensual": c.renta_mensual || "",
                            "Última factura": c.ultimaFacturaFolio || "",
                            Estado: c.ultimaFacturaEstado || "",
                            Suspendido: c.suspendido ? "Sí" : "No",
                          }))
                        );
                      }
                    }}
                  >
                    📥 Excel
                  </button>
                </div>

                {clientesFiltrados.length === 0 ? (
                  <div className="empty-card">Sin clientes en esta categoría</div>
                ) : !esGlobal ? (
                  clientesFiltrados.map((c) => {
                    const badge = badgeInfo(c.ultimaFacturaEstado);
                    return (
                      <div className={"cobranza-card" + (c.suspendido ? " suspendido" : "")} key={c.id}>
                        <div>
                          <p className="item-card-titulo">
                            {c.nombre} {c.empresa ? `· ${c.empresa}` : ""}
                          </p>
                          <p className="item-card-sub">
                            {c.dia_pago ? `Paga el día ${c.dia_pago}` : "Sin día de pago definido"}
                            {c.renta_mensual ? ` · $${Number(c.renta_mensual).toLocaleString("es-MX")}/mes` : ""}
                          </p>
                          {c.suspendido && (
                            <p className="item-card-extra" style={{ color: "#a32d2d" }}>
                              🚫 Suspendido
                              {c.suspendido_desde
                                ? ` desde ${new Date(c.suspendido_desde).toLocaleDateString("es-MX")}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <span className="factura-badge" style={{ background: badge.bg }}>
                          <span className="factura-badge-text">{badge.texto}</span>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  Array.from(new Set(clientesFiltrados.map((c) => c.centro || "Sin centro")))
                    .sort()
                    .map((centroNombre) => {
                      const clientesDelCentro = clientesFiltrados.filter(
                        (c) => (c.centro || "Sin centro") === centroNombre
                      );
                      return (
                        <div key={centroNombre} style={{ marginBottom: 16 }}>
                          <p className="panel-section-label" style={{ marginTop: 12 }}>
                            🏢 {centroNombre} ({clientesDelCentro.length})
                          </p>
                          {clientesDelCentro.map((c) => {
                            const badge = badgeInfo(c.ultimaFacturaEstado);
                            return (
                              <div className={"cobranza-card" + (c.suspendido ? " suspendido" : "")} key={c.id}>
                                <div>
                                  <p className="item-card-titulo">
                                    {c.nombre} {c.empresa ? `· ${c.empresa}` : ""}
                                  </p>
                                  <p className="item-card-sub">
                                    {c.dia_pago ? `Paga el día ${c.dia_pago}` : "Sin día de pago definido"}
                                    {c.renta_mensual ? ` · $${Number(c.renta_mensual).toLocaleString("es-MX")}/mes` : ""}
                                  </p>
                                  {c.suspendido && (
                                    <p className="item-card-extra" style={{ color: "#a32d2d" }}>
                                      🚫 Suspendido
                                      {c.suspendido_desde
                                        ? ` desde ${new Date(c.suspendido_desde).toLocaleDateString("es-MX")}`
                                        : ""}
                                    </p>
                                  )}
                                </div>
                                <span className="factura-badge" style={{ background: badge.bg }}>
                                  <span className="factura-badge-text">{badge.texto}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                )}
              </>
            )}

            {tab === "gastos" && esGlobal && (
              <>
                {cargandoGastos ? (
                  <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando gastos de todos los centros...</p>
          </div>
                ) : (
                  <>
                    <div className="gastos-total-card">
                      <p className="gastos-total-monto">
                        ${totalGlobal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="gastos-total-lbl">Total de gastos · todos los centros y departamentos</p>
                    </div>

                    {renderBarras("💸 Gastos por centro", gastosPorCentro, "#F07E3A")}
                    {renderBarras("🏷️ Gastos por departamento", gastosPorDepto, "#185FA5")}

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <select
                        className="ticket-admin-select"
                        value={anioGastos}
                        onChange={(e) => setAnioGastos(Number(e.target.value))}
                      >
                        {aniosDisponibles.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    {renderBarras(`📅 Gastos por mes (${anioGastos})`, gastosPorMesGlobal, "#0F6E56")}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <p className="panel-section-label" style={{ margin: 0 }}>
                        Historial ({gastos.length})
                      </p>
                      <button
                        className="btn-exportar"
                        onClick={() => {
                          const porCentro: Record<string, Record<string, any>[]> = {};
                          gastos.forEach((g) => {
                            const key = g.centro || "Sin centro";
                            if (!porCentro[key]) porCentro[key] = [];
                            porCentro[key].push({
                              Departamento: g.tipo === "sistemas" ? "Sistemas" : g.tipo === "operaciones" ? "Operaciones" : "Admin",
                              Concepto: g.concepto,
                              Categoria: g.categoria || "",
                              Monto: g.monto,
                              Fecha: g.fecha,
                            });
                          });
                          exportarExcelPorCentro("gastos-globales", porCentro);
                        }}
                      >
                        📥 Excel
                      </button>
                    </div>
                    {gastos.length === 0 ? (
                      <div className="empty-card">Sin gastos registrados</div>
                    ) : (
                      centrosConGasto.map((c) => {
                        const gastosDelCentro = gastos.filter((g) => (g.centro || "Sin centro") === c);
                        return (
                          <div key={c} style={{ marginBottom: 16 }}>
                            <p className="panel-section-label" style={{ marginTop: 12 }}>
                              🏢 {c} ({gastosDelCentro.length})
                            </p>
                            {gastosDelCentro.map((g) => (
                              <div className="item-card" key={g.id}>
                                <div className="item-card-info">
                                  <p className="item-card-titulo">{g.concepto}</p>
                                  <p className="item-card-sub">
                                    {g.tipo === "sistemas" ? "🖥️ Sistemas" : g.tipo === "operaciones" ? "🔧 Operaciones" : "🧑‍💼 Admin"}
                                    {" · "}
                                    {g.categoria || "—"} · {new Date(g.fecha).toLocaleDateString("es-MX")}
                                  </p>
                                  {g.notas && <p className="item-card-extra">{g.notas}</p>}
                                </div>
                                <p className="item-card-monto">${Number(g.monto).toLocaleString("es-MX")}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
