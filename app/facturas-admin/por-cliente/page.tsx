"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  parcial: { label: "◐ Parcial", bg: "#E8EEF9", color: "#254B8C" },
  pagada: { label: "✓ Pagada", bg: "#E1F5EE", color: "#0F6E56" },
  vencida: { label: "⚠️ Vencida", bg: "#FCEBEB", color: "#A32D2D" },
};

type Cliente = { id: string; nombre: string; email: string; empresa: string | null; rfc: string | null; nombre_fiscal: string | null };

type Factura = {
  id: string;
  folio: string;
  concepto: string;
  monto: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string;
  archivo_url: string | null;
  xml_url: string | null;
  uuid_cfdi: string | null;
  metodo_pago: string | null;
  cancelacion_estatus: "en_proceso" | "cancelada" | "rechazada" | null;
  fuente: string | null;
};

type Complemento = {
  id: string;
  serie: string | null;
  folio_fiscal: string | null;
  fecha_pago: string;
  monto: number;
  forma_pago: string;
  archivo_url: string | null;
  xml_url: string | null;
  cancelacion_estatus: "en_proceso" | "cancelada" | "rechazada" | null;
};

type FilaComplemento = { complemento_id: string; factura_id: string; importe: number };

const dinero = (n: number) => Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

// "2026-10-05" -> "5 oct 2026" sin pasar por Date (que lo movería un día por la zona horaria).
function fechaCorta(f: string) {
  const [a, m, d] = f.slice(0, 10).split("-");
  return `${Number(d)} ${MESES[Number(m) - 1].slice(0, 3).toLowerCase()} ${a}`;
}

function nombreMes(clave: string) {
  const [a, m] = clave.split("-");
  return `${MESES[Number(m) - 1]} ${a}`;
}

export default function FacturasPorClientePage() {
  const supabase = createClient();
  const [cargando, setCargando] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const esGlobal = ROLES_GLOBALES.includes(miRol);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [clienteId, setClienteId] = useState("");

  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [complementos, setComplementos] = useState<Complemento[]>([]);
  const [filas, setFilas] = useState<FilaComplemento[]>([]);
  const [cargandoCliente, setCargandoCliente] = useState(false);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchClientes(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  useEffect(() => {
    if (clienteId) fetchCliente(clienteId);
    else {
      setFacturas([]);
      setComplementos([]);
      setFilas([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  async function init() {
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
    // Llegar desde la lista de facturas: ?cliente=<id> abre directo a ese cliente.
    const id = new URLSearchParams(window.location.search).get("cliente");
    if (id) {
      // El cliente puede ser de otro centro que el predeterminado (roles globales): se abre en el suyo.
      if (ROLES_GLOBALES.includes(rol)) {
        const { data: p } = await supabase.from("profiles").select("centro").eq("id", id).maybeSingle();
        if (p?.centro) setCentro(p.centro);
      }
      setClienteId(id);
    }
  }

  async function fetchClientes(c: string) {
    setCargando(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, nombre, email, empresa, rfc, nombre_fiscal")
      .eq("rol", "cliente")
      .eq("centro", c)
      .order("nombre");
    setClientes((data as Cliente[]) || []);
    setCargando(false);
  }

  async function fetchCliente(id: string) {
    setCargandoCliente(true);
    const { data: facts } = await supabase
      .from("facturas")
      .select("id, folio, concepto, monto, fecha_emision, fecha_vencimiento, estado, archivo_url, xml_url, uuid_cfdi, metodo_pago, cancelacion_estatus, fuente")
      .eq("user_id", id)
      .order("fecha_emision", { ascending: false });
    setFacturas((facts as Factura[]) || []);

    const { data: comps } = await supabase
      .from("complementos_pago")
      .select("id, serie, folio_fiscal, fecha_pago, monto, forma_pago, archivo_url, xml_url, cancelacion_estatus")
      .eq("user_id", id)
      .order("fecha_pago", { ascending: false });
    setComplementos((comps as Complemento[]) || []);
    const ids = (comps || []).map((c) => c.id);
    const { data: fs } = ids.length
      ? await supabase.from("complemento_pago_facturas").select("complemento_id, factura_id, importe").in("complemento_id", ids)
      : { data: [] as FilaComplemento[] };
    setFilas((fs as FilaComplemento[]) || []);
    setCargandoCliente(false);
  }

  const cliente = clientes.find((c) => c.id === clienteId) || null;

  const clientesFiltrados = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => [c.nombre, c.email, c.empresa, c.rfc, c.nombre_fiscal].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [clientes, busquedaCliente]);

  // Lo cubierto por complementos no cancelados; el saldo de una factura PPD es lo que falta.
  function saldoPPD(f: Factura): number {
    const cancelados = new Set(complementos.filter((c) => c.cancelacion_estatus === "cancelada").map((c) => c.id));
    const cubierto = filas.filter((r) => r.factura_id === f.id && !cancelados.has(r.complemento_id)).reduce((s, r) => s + Number(r.importe), 0);
    return Math.round((Number(f.monto) - cubierto) * 100) / 100;
  }

  const facturasFiltradas = useMemo(
    () => facturas.filter((f) => (!desde || f.fecha_emision >= desde) && (!hasta || f.fecha_emision <= hasta)),
    [facturas, desde, hasta]
  );
  const complementosFiltrados = useMemo(
    () => complementos.filter((c) => (!desde || c.fecha_pago >= desde) && (!hasta || c.fecha_pago <= hasta)),
    [complementos, desde, hasta]
  );

  // Agrupado por mes de emisión (más reciente primero).
  const meses = useMemo(() => {
    const mapa = new Map<string, Factura[]>();
    for (const f of facturasFiltradas) {
      const clave = f.fecha_emision.slice(0, 7);
      mapa.set(clave, [...(mapa.get(clave) || []), f]);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([clave, lista]) => {
        const vigentes = lista.filter((f) => f.cancelacion_estatus !== "cancelada");
        return {
          clave,
          lista,
          facturado: vigentes.reduce((s, f) => s + Number(f.monto), 0),
          pagado: vigentes.filter((f) => f.estado === "pagada").reduce((s, f) => s + Number(f.monto), 0),
          porCobrar: vigentes.filter((f) => f.estado !== "pagada").reduce((s, f) => s + Number(f.monto), 0),
        };
      });
  }, [facturasFiltradas]);

  const totales = useMemo(
    () => ({
      facturado: meses.reduce((s, m) => s + m.facturado, 0),
      pagado: meses.reduce((s, m) => s + m.pagado, 0),
      porCobrar: meses.reduce((s, m) => s + m.porCobrar, 0),
      canceladas: facturasFiltradas.filter((f) => f.cancelacion_estatus === "cancelada").length,
    }),
    [meses, facturasFiltradas]
  );

  function exportar() {
    exportarExcel(
      `facturas-${(cliente?.nombre || "cliente").replace(/[^\w-]+/g, "-")}`,
      facturasFiltradas.map((f) => ({
        Mes: nombreMes(f.fecha_emision.slice(0, 7)),
        Folio: f.folio,
        Concepto: f.concepto,
        Monto: Number(f.monto),
        Estado: f.estado,
        Emision: f.fecha_emision,
        Vencimiento: f.fecha_vencimiento,
        UUID: f.uuid_cfdi || "",
        "Método de pago": f.metodo_pago || "",
        "Saldo sin complemento": f.metodo_pago === "PPD" && f.uuid_cfdi && f.cancelacion_estatus !== "cancelada" ? saldoPPD(f) : "",
        Cancelación: f.cancelacion_estatus || "",
        Fuente: f.fuente || "manual",
      }))
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Regresar
        </a>
        <p className="rep-title">Facturas por cliente</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select
              value={centro || ""}
              onChange={(e) => {
                setCentro(e.target.value);
                setClienteId("");
              }}
            >
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content">
        <div className="form-card">
          <p className="sub-label">Cliente</p>
          <input
            className="search-box"
            placeholder="Buscar por nombre, correo, empresa o RFC..."
            value={busquedaCliente}
            onChange={(e) => setBusquedaCliente(e.target.value)}
          />
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ marginTop: 6 }}>
            <option value="">{cargando ? "Cargando clientes..." : `Elige un cliente (${clientesFiltrados.length})`}</option>
            {clientesFiltrados.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
                {c.empresa ? ` — ${c.empresa}` : ""} · {c.email}
              </option>
            ))}
          </select>
          {cliente && !clientesFiltrados.some((c) => c.id === cliente.id) && (
            <p style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Mostrando: {cliente.nombre}</p>
          )}

          {clienteId && (
            <div className="tel-form-grid" style={{ marginTop: 8 }}>
              <div>
                <p className="sub-label">Emisión desde</p>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div>
                <p className="sub-label">Emisión hasta</p>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {!clienteId ? (
          <div className="empty-card">Elige un cliente para ver su historial de facturas por mes</div>
        ) : cargandoCliente ? (
          <div className="empty-card">Cargando facturas...</div>
        ) : facturas.length === 0 && complementos.length === 0 ? (
          <div className="empty-card">Este cliente no tiene facturas registradas</div>
        ) : (
          <>
            <div className="resumen-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
              <div className="stat-card">
                <p className="stat-val" style={{ fontSize: 16 }}>{dinero(totales.facturado)}</p>
                <p className="stat-lbl">Facturado</p>
              </div>
              <div className="stat-card">
                <p className="stat-val" style={{ fontSize: 16, color: "#0F6E56" }}>{dinero(totales.pagado)}</p>
                <p className="stat-lbl">Pagado</p>
              </div>
              <div className="stat-card">
                <p className="stat-val" style={{ fontSize: 16, color: totales.porCobrar > 0 ? "#A32D2D" : undefined }}>{dinero(totales.porCobrar)}</p>
                <p className="stat-lbl">Por cobrar</p>
              </div>
            </div>
            {totales.canceladas > 0 && (
              <p style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
                {totales.canceladas} factura(s) con CFDI cancelado no se suman en los totales.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn-exportar" onClick={exportar}>
                Excel
              </button>
            </div>

            {meses.length === 0 ? (
              <div className="empty-card">Ninguna factura en ese rango de fechas</div>
            ) : (
              meses.map((m) => (
                <div key={m.clave} style={{ marginTop: 12 }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    {nombreMes(m.clave)}
                  </p>
                  <p style={{ fontSize: 12, color: "#666", margin: "2px 0 6px" }}>
                    Facturado {dinero(m.facturado)} · Pagado {dinero(m.pagado)} · Por cobrar {dinero(m.porCobrar)}
                  </p>
                  {m.lista.map((f) => {
                    const badge = ESTATUS_LABEL[f.estado] || { label: f.estado, bg: "#F0F0F0", color: "#555" };
                    const ppd = f.metodo_pago === "PPD" && !!f.uuid_cfdi && f.cancelacion_estatus !== "cancelada";
                    return (
                      <div className="contrato-card-admin" key={f.id}>
                        <div className="contrato-card-top">
                          <div>
                            <p className="contrato-cliente-nombre">{f.folio}</p>
                            <p className="contrato-detalle">{f.concepto}</p>
                            <p className="contrato-detalle">
                              {dinero(f.monto)} · emitida {fechaCorta(f.fecha_emision)} · vence {fechaCorta(f.fecha_vencimiento)}
                            </p>
                            {f.uuid_cfdi && (
                              <p className="contrato-detalle" style={{ fontSize: 11, color: "#888" }}>
                                CFDI{f.metodo_pago ? " " + f.metodo_pago : ""} · {f.uuid_cfdi}
                              </p>
                            )}
                            {ppd && (
                              <p className="contrato-detalle" style={{ fontSize: 12, fontWeight: 600, color: saldoPPD(f) > 0 ? "#854F0B" : "#0F6E56" }}>
                                {saldoPPD(f) > 0 ? `Saldo sin complemento: ${dinero(saldoPPD(f))}` : "✓ Cubierta por complementos de pago"}
                              </p>
                            )}
                            {f.cancelacion_estatus === "cancelada" && (
                              <p className="contrato-detalle" style={{ fontSize: 12, fontWeight: 600, color: "#A32D2D" }}>✕ CFDI cancelado</p>
                            )}
                            {f.cancelacion_estatus === "en_proceso" && (
                              <p className="contrato-detalle" style={{ fontSize: 12, fontWeight: 600, color: "#854F0B" }}>⏳ Cancelación en proceso</p>
                            )}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                              {f.archivo_url && (
                                <a className="ver-pdf-btn" href={`/api/facturas/descargar?id=${f.id}&tipo=pdf`}>
                                  Descargar PDF
                                </a>
                              )}
                              {f.xml_url && (
                                <a className="ver-pdf-btn" href={`/api/facturas/descargar?id=${f.id}&tipo=xml`}>
                                  Descargar XML
                                </a>
                              )}
                            </div>
                          </div>
                          <span className="factura-badge" style={{ background: badge.bg }}>
                            <span className="factura-badge-text" style={{ color: badge.color }}>
                              {badge.label}
                            </span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            {complementosFiltrados.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="panel-section-label" style={{ margin: 0 }}>
                  Complementos de pago ({complementosFiltrados.length})
                </p>
                {complementosFiltrados.map((c) => (
                  <div className="contrato-card-admin" key={c.id}>
                    <p className="contrato-cliente-nombre">
                      {c.serie || ""}
                      {c.folio_fiscal || ""} · {dinero(c.monto)}
                    </p>
                    <p className="contrato-detalle">
                      Pago del {fechaCorta(c.fecha_pago)} · forma {c.forma_pago}
                      {c.cancelacion_estatus === "cancelada" ? " · ✕ cancelado" : c.cancelacion_estatus === "en_proceso" ? " · ⏳ cancelación en proceso" : ""}
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {c.archivo_url && (
                        <a className="ver-pdf-btn" href={`/api/facturas/descargar?origen=complemento&id=${c.id}&tipo=pdf`}>
                          Descargar PDF
                        </a>
                      )}
                      {c.xml_url && (
                        <a className="ver-pdf-btn" href={`/api/facturas/descargar?origen=complemento&id=${c.id}&tipo=xml`}>
                          Descargar XML
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
