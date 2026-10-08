"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";
import { fechaLocal } from "@/lib/fechaMexico";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];

type ClienteCobranza = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  centro: string | null;
  created_at: string;
  suspendido: boolean;
  suspendido_desde: string | null;
  dia_pago: number | null;
  renta_mensual: number | null;
  ultimaFacturaEstado: string | null;
  ultimaFacturaFolio: string | null;
  ultimaFacturaMonto: number | null;
};

// Cliente dado de baja que se fue debiendo (contrato "inactivo_debe"): su
// cuenta está bloqueada y ya no sale en la lista de arriba, pero hay que
// seguir cobrándole. Sale de aquí sola cuando ya no tiene nada pendiente
// (el cron diario pasa su baja a "inactivo_pagado").
type BajaConAdeudo = {
  contratoId: string;
  userId: string | null;
  nombre: string;
  empresa: string | null;
  centro: string | null;
  oficina: string | null;
  fechaBaja: string | null;
  montoAdeudado: number;
  pendientes: { id: string; tipo: "Pago" | "Factura"; concepto: string; monto: number; estado: string }[];
};

export default function CobranzaPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState("");
  const [esGlobal, setEsGlobal] = useState(false);
  const [centro, setCentro] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteCobranza[]>([]);
  const [filtroPago, setFiltroPago] = useState<"todos" | "corriente" | "pendiente" | "vencida">("todos");
  const [busquedaClientes, setBusquedaClientes] = useState("");
  const [ejecutando, setEjecutando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState("");

  const [bajasConAdeudo, setBajasConAdeudo] = useState<BajaConAdeudo[]>([]);
  // Confirmación de "Ejecutar cobranza ahora" con el modal de la app.
  const [confirmandoCobranza, setConfirmandoCobranza] = useState(false);


  useEffect(() => {
    // Los gastos ya no viven aquí: los enlaces viejos a la pestaña
    // (/cobranza?tab=gastos) llevan a la pantalla Gastos.
    if (searchParams.get("tab") === "gastos") {
      window.location.replace("/gastos");
      return;
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    await fetchBajasConAdeudo(profile?.centro || null, miRol);
    setLoading(false);
  }

  async function fetchClientes(c: string | null, rolActual: string) {
    let query = supabase
      .from("profiles")
      .select("id, nombre, email, empresa, centro, created_at, suspendido, suspendido_desde")
      .eq("rol", "cliente")
      .eq("activo", true)
      .order("created_at", { ascending: false });
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

  async function fetchBajasConAdeudo(c: string | null, rolActual: string) {
    let query = supabase
      .from("contratos")
      .select("id, user_id, centro, oficina_id, fecha_baja, monto_adeudado, cliente_nombre_historico, cliente_empresa_historico")
      .eq("estatus", "inactivo_debe")
      .order("fecha_baja", { ascending: false });
    if (!ROLES_GLOBALES.includes(rolActual) && c) query = query.eq("centro", c);
    const { data: contratos } = await query;
    if (!contratos || contratos.length === 0) {
      setBajasConAdeudo([]);
      return;
    }

    const userIds = Array.from(new Set(contratos.map((x) => x.user_id).filter((x): x is string => !!x)));
    const oficinaIds = Array.from(new Set(contratos.map((x) => x.oficina_id).filter((x): x is string => !!x)));
    const [{ data: pagos }, { data: facturas }, { data: oficinas }] = await Promise.all([
      userIds.length > 0
        ? supabase
            .from("pagos")
            .select("id, user_id, concepto, monto, estado")
            .in("user_id", userIds)
            .not("estado", "in", "(pagado,cancelado,rechazado)")
        : Promise.resolve({ data: [] as { id: string; user_id: string; concepto: string | null; monto: number; estado: string }[] }),
      userIds.length > 0
        ? supabase
            .from("facturas")
            .select("id, user_id, folio, concepto, monto, estado")
            .in("user_id", userIds)
            .not("estado", "in", "(pagada,cancelada)")
        : Promise.resolve({
            data: [] as { id: string; user_id: string; folio: string | null; concepto: string | null; monto: number; estado: string }[],
          }),
      oficinaIds.length > 0
        ? supabase.from("oficinas").select("id, numero").in("id", oficinaIds)
        : Promise.resolve({ data: [] as { id: string; numero: string | null }[] }),
    ]);
    const numeroOficina = new Map((oficinas || []).map((o) => [o.id, o.numero]));

    setBajasConAdeudo(
      contratos.map((ct) => ({
        contratoId: ct.id,
        userId: ct.user_id,
        nombre: ct.cliente_nombre_historico || "Cliente",
        empresa: ct.cliente_empresa_historico,
        centro: ct.centro,
        oficina: ct.oficina_id ? numeroOficina.get(ct.oficina_id) || null : null,
        fechaBaja: ct.fecha_baja,
        montoAdeudado: Number(ct.monto_adeudado) || 0,
        pendientes: [
          ...(pagos || [])
            .filter((pg) => pg.user_id === ct.user_id)
            .map((pg) => ({ id: pg.id, tipo: "Pago" as const, concepto: pg.concepto || "Pago", monto: Number(pg.monto) || 0, estado: pg.estado })),
          ...(facturas || [])
            .filter((f) => f.user_id === ct.user_id)
            .map((f) => ({
              id: f.id,
              tipo: "Factura" as const,
              concepto: [f.folio, f.concepto].filter(Boolean).join(" · ") || "Factura",
              monto: Number(f.monto) || 0,
              estado: f.estado,
            })),
        ],
      }))
    );
  }

  async function ejecutarCobranza() {
    setConfirmandoCobranza(false);
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
    if (filtroPago === "corriente" && c.ultimaFacturaEstado !== "pagada") return false;
    if (filtroPago === "pendiente" && c.ultimaFacturaEstado !== "pendiente") return false;
    if (filtroPago === "vencida" && c.ultimaFacturaEstado !== "vencida") return false;
    const q = busquedaClientes.trim().toLowerCase();
    if (!q) return true;
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.empresa || "").toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  const conteoPago = {
    corriente: clientes.filter((c) => c.ultimaFacturaEstado === "pagada").length,
    pendiente: clientes.filter((c) => c.ultimaFacturaEstado === "pendiente").length,
    vencida: clientes.filter((c) => c.ultimaFacturaEstado === "vencida").length,
  };

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
              <>
                <button className="btn-ejecutar-cobranza" onClick={() => setConfirmandoCobranza(true)} disabled={ejecutando}>
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
                    {resultado.bajasPagadas ? ` · Bajas que terminaron de pagar: ${resultado.bajasPagadas}` : ""}
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

                <input
                  placeholder="Buscar por nombre, empresa o correo..."
                  value={busquedaClientes}
                  onChange={(e) => setBusquedaClientes(e.target.value)}
                  style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8 }}
                />

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
                  <div className="empty-card">
                    {busquedaClientes ? "Sin clientes que coincidan con la búsqueda" : "Sin clientes en esta categoría"}
                  </div>
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
                                ? ` desde ${fechaLocal(c.suspendido_desde).toLocaleDateString("es-MX")}`
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
                                        ? ` desde ${fechaLocal(c.suspendido_desde).toLocaleDateString("es-MX")}`
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

                <p className="panel-section-label" style={{ marginTop: 20 }}>
                  ⚠️ Dados de baja con adeudo ({bajasConAdeudo.length})
                </p>
                <p style={{ fontSize: 12, color: "#888", margin: "2px 0 6px" }}>
                  Clientes que ya se fueron debiendo: su cuenta está bloqueada, pero su historial se conserva. Salen de aquí
                  solos cuando ya no tienen pagos ni facturas pendientes.
                </p>
                {bajasConAdeudo.length === 0 ? (
                  <div className="empty-card">Nadie se fue debiendo 🎉</div>
                ) : (
                  bajasConAdeudo.map((b) => {
                    const totalPendiente = b.pendientes.reduce((acc, x) => acc + x.monto, 0);
                    return (
                      <div className="cobranza-card suspendido" key={b.contratoId} style={{ alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <p className="item-card-titulo">
                            {b.nombre} {b.empresa ? `· ${b.empresa}` : ""}
                          </p>
                          <p className="item-card-sub">
                            {[b.centro, b.oficina ? `Oficina ${b.oficina}` : null].filter(Boolean).join(" · ")}
                            {b.fechaBaja ? ` · Baja el ${new Date(b.fechaBaja + "T00:00:00").toLocaleDateString("es-MX")}` : ""}
                          </p>
                          {b.pendientes.length === 0 ? (
                            <p className="item-card-extra" style={{ color: "#888" }}>
                              Sin pagos ni facturas pendientes registrados (el adeudo se anotó a mano al darlo de baja).
                            </p>
                          ) : (
                            <div style={{ marginTop: 4 }}>
                              {b.pendientes.map((x) => (
                                <p key={x.tipo + x.id} className="item-card-extra" style={{ margin: 0 }}>
                                  {x.tipo === "Factura" ? "🧾" : "💳"} {x.concepto} — ${x.monto.toLocaleString("es-MX")} ({x.estado})
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p className="item-card-titulo" style={{ color: "#A32D2D", margin: 0 }}>
                            ${b.montoAdeudado.toLocaleString("es-MX")}
                          </p>
                          <p className="item-card-sub" style={{ margin: 0 }}>adeudo al darlo de baja</p>
                          {b.pendientes.length > 0 && (
                            <p className="item-card-sub" style={{ margin: 0 }}>
                              Pendiente hoy: ${totalPendiente.toLocaleString("es-MX")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </>
          </>
        )}
      </div>

      {confirmandoCobranza && (
        <div className="modal-overlay" onClick={() => setConfirmandoCobranza(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Ejecutar cobranza ahora</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Ejecutar la cobranza ahora? Esto genera facturas, manda recordatorios y puede suspender a quien no haya
              pagado.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoCobranza(false)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={ejecutarCobranza}>
                ⚡ Sí, ejecutar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
