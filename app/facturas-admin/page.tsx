"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  parcial: { label: "◐ Parcial", bg: "#E8EEF9", color: "#254B8C" },
  pagada: { label: "✓ Pagada", bg: "#E1F5EE", color: "#0F6E56" },
  vencida: { label: "⚠️ Vencida", bg: "#FCEBEB", color: "#A32D2D" },
};

type Cliente = { id: string; nombre: string; email: string; empresa: string | null };

type Factura = {
  id: string;
  user_id: string | null;
  folio: string;
  concepto: string;
  monto: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string;
  archivo_url: string | null;
  fuente?: string | null;
  uuid_cfdi?: string | null;
  rfc_receptor?: string | null;
  cliente_nombre?: string;
  cliente_email?: string;
};

type Pago = { id: string; monto: number; concepto: string | null; estado: string; factura_id: string | null; created_at: string };
type PagoSuelto = Pago & { user_id: string };

export default function FacturasAdminPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pagosSueltos, setPagosSueltos] = useState<PagoSuelto[]>([]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
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
    const { data: clis } = await supabase
      .from("profiles")
      .select("id, nombre, email, empresa")
      .eq("rol", "cliente")
      .eq("centro", c)
      .order("nombre");
    setClientes(clis || []);

    const clienteIds = (clis || []).map((cl) => cl.id);
    const nombrePorId: Record<string, string> = {};
    const emailPorId: Record<string, string> = {};
    (clis || []).forEach((cl) => {
      nombrePorId[cl.id] = cl.nombre;
      emailPorId[cl.id] = cl.email;
    });

    // Se filtra por `centro` (no por user_id in clienteIds) para que las
    // facturas importadas de CFDI sin cliente identificado (user_id null)
    // también aparezcan en la lista, no solo las que ya tienen dueño.
    const { data: facts } = await supabase
      .from("facturas")
      .select("*")
      .eq("centro", c)
      .order("fecha_emision", { ascending: false });
    setFacturas(
      (facts || []).map((f) => ({
        ...f,
        cliente_nombre: f.user_id ? nombrePorId[f.user_id] || "Cliente" : "Cliente no identificado",
        cliente_email: f.user_id ? emailPorId[f.user_id] || "" : "",
      }))
    );

    // Pagos sin factura vinculada — candidatos a "Vincular a esta factura".
    const { data: sueltos } =
      clienteIds.length > 0
        ? await supabase
            .from("pagos")
            .select("id, user_id, monto, concepto, estado, factura_id, created_at")
            .in("user_id", clienteIds)
            .is("factura_id", null)
            .order("created_at", { ascending: false })
        : { data: [] as PagoSuelto[] };
    setPagosSueltos((sueltos as PagoSuelto[]) || []);
    setLoading(false);
  }

  // ---- Formulario Nueva factura ----
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    cliente_id: "",
    folio: "",
    concepto: "",
    monto: "",
    fecha_emision: new Date().toISOString().split("T")[0],
    fecha_vencimiento: "",
    estado: "pendiente",
  });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [pagosAVincular, setPagosAVincular] = useState<Set<string>>(new Set());

  function togglePagoAVincular(id: string) {
    setPagosAVincular((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function crearFactura(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.cliente_id || !form.concepto.trim() || !form.monto || !form.fecha_vencimiento) {
      setError("Completa cliente, concepto, monto y fecha de vencimiento");
      return;
    }
    if (!centro) return;
    setGuardando(true);

    let archivoUrl: string | null = null;
    if (archivo) {
      const fileName = `${form.cliente_id}-${Date.now()}.${archivo.name.split(".").pop() || "pdf"}`;
      const { error: uploadError } = await supabase.storage
        .from("facturas")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (uploadError) {
        setError("No se pudo subir el PDF: " + uploadError.message);
        setGuardando(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("facturas").getPublicUrl(fileName);
      archivoUrl = urlData.publicUrl;
    }

    const folio = form.folio.trim() || `FAC-MAN-${Date.now().toString().slice(-6)}`;

    const { data: nuevaFactura, error: insertError } = await supabase
      .from("facturas")
      .insert({
        user_id: form.cliente_id,
        folio,
        concepto: form.concepto.trim(),
        monto: Number(form.monto),
        fecha_emision: form.fecha_emision,
        fecha_vencimiento: form.fecha_vencimiento,
        estado: form.estado,
        centro,
        archivo_url: archivoUrl,
      })
      .select("id")
      .single();

    if (insertError || !nuevaFactura) {
      setGuardando(false);
      setError("No se pudo guardar la factura. Intenta de nuevo.");
      return;
    }

    if (pagosAVincular.size > 0) {
      await fetch("/api/pagos/vincular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoIds: Array.from(pagosAVincular), facturaId: nuevaFactura.id }),
      });
    }

    setGuardando(false);
    setForm({
      cliente_id: "",
      folio: "",
      concepto: "",
      monto: "",
      fecha_emision: new Date().toISOString().split("T")[0],
      fecha_vencimiento: "",
      estado: "pendiente",
    });
    setArchivo(null);
    setPagosAVincular(new Set());
    setMostrarForm(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTodo(centro);
  }

  // ---- Ver / vincular pagos de una factura ----
  const [facturaExpandidaId, setFacturaExpandidaId] = useState<string | null>(null);
  const [pagosDeFactura, setPagosDeFactura] = useState<Pago[]>([]);
  const [cargandoPagos, setCargandoPagos] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  async function toggleFactura(f: Factura) {
    if (facturaExpandidaId === f.id) {
      setFacturaExpandidaId(null);
      return;
    }
    setFacturaExpandidaId(f.id);
    setCargandoPagos(true);
    const { data } = await supabase
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, created_at")
      .eq("factura_id", f.id)
      .order("created_at", { ascending: false });
    setPagosDeFactura(data || []);
    setCargandoPagos(false);
  }

  async function vincularPago(pagoId: string, facturaId: string) {
    setVinculando(pagoId);
    await fetch("/api/pagos/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoIds: [pagoId], facturaId }),
    });
    setVinculando(null);
    if (centro) fetchTodo(centro);
    // Refresca la lista de pagos de la factura abierta
    const { data } = await supabase
      .from("pagos")
      .select("id, monto, concepto, estado, factura_id, created_at")
      .eq("factura_id", facturaId)
      .order("created_at", { ascending: false });
    setPagosDeFactura(data || []);
  }

  const pagosSueltosDelCliente = (clienteId: string) => pagosSueltos.filter((p) => p.user_id === clienteId);

  // ---- Filtros (100% client-side, no tocan la consulta a Supabase) ----
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroFuente, setFiltroFuente] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [soloSinCliente, setSoloSinCliente] = useState(false);

  const hayFiltrosActivos =
    !!busqueda || !!filtroEstado || !!filtroFuente || !!filtroDesde || !!filtroHasta || soloSinCliente;

  function limpiarFiltros() {
    setBusqueda("");
    setFiltroEstado("");
    setFiltroFuente("");
    setFiltroDesde("");
    setFiltroHasta("");
    setSoloSinCliente(false);
  }

  const facturasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return facturas.filter((f) => {
      if (q) {
        const enTexto = [f.folio, f.concepto, f.uuid_cfdi, f.rfc_receptor, f.cliente_nombre, f.cliente_email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!enTexto.includes(q)) return false;
      }
      if (filtroEstado && f.estado !== filtroEstado) return false;
      if (filtroFuente && (f.fuente || "manual") !== filtroFuente) return false;
      if (filtroDesde && f.fecha_emision < filtroDesde) return false;
      if (filtroHasta && f.fecha_emision > filtroHasta) return false;
      if (soloSinCliente && f.user_id) return false;
      return true;
    });
  }, [facturas, busqueda, filtroEstado, filtroFuente, filtroDesde, filtroHasta, soloSinCliente]);

  const [asignando, setAsignando] = useState<string | null>(null);
  async function asignarCliente(facturaId: string, clienteId: string) {
    if (!clienteId) return;
    setAsignando(facturaId);
    await supabase.from("facturas").update({ user_id: clienteId }).eq("id", facturaId);
    setAsignando(null);
    if (centro) fetchTodo(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Facturas</p>
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

      <div className="rep-content">
        {!centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : loading ? (
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                🧾 Facturas ({hayFiltrosActivos ? `${facturasFiltradas.length} de ${facturas.length}` : facturas.length})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <a className="btn-exportar" href="/facturas-admin/importar">
                  📄 Importar CFDI
                </a>
                <button
                  className="btn-exportar"
                  onClick={() =>
                    exportarExcel(
                      `facturas-${centro}`,
                      facturasFiltradas.map((f) => ({
                        Cliente: f.cliente_nombre || "",
                        Correo: f.cliente_email || "",
                        Folio: f.folio,
                        Concepto: f.concepto,
                        Monto: f.monto,
                        Emision: f.fecha_emision,
                        Vencimiento: f.fecha_vencimiento,
                        Estado: f.estado,
                        Fuente: f.fuente || "manual",
                      }))
                    )
                  }
                >
                  📥 Excel
                </button>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarForm((v) => !v)}
                >
                  {mostrarForm ? "Cancelar" : "+ Nueva factura"}
                </button>
              </div>
            </div>

            <div className="form-card" style={{ marginTop: 8 }}>
              <div className="tel-form-grid">
                <div>
                  <p className="sub-label">Buscar</p>
                  <input
                    className="search-box"
                    placeholder="Folio, concepto, RFC, cliente..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                  />
                </div>
                <div>
                  <p className="sub-label">Estado</p>
                  <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="parcial">Parcial</option>
                    <option value="pagada">Pagada</option>
                    <option value="vencida">Vencida</option>
                  </select>
                </div>
                <div>
                  <p className="sub-label">Fuente</p>
                  <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)}>
                    <option value="">Todas</option>
                    <option value="manual">Manual</option>
                    <option value="cfdi_import">Importación CFDI</option>
                  </select>
                </div>
                <div>
                  <p className="sub-label">Emisión desde</p>
                  <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
                </div>
                <div>
                  <p className="sub-label">Emisión hasta</p>
                  <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#333" }}>
                <input type="checkbox" checked={soloSinCliente} onChange={(e) => setSoloSinCliente(e.target.checked)} />
                Solo sin cliente
              </label>
              {hayFiltrosActivos && (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#A32D2D", fontWeight: 600, marginTop: 8 }}
                  onClick={limpiarFiltros}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={crearFactura}>
                <p className="sub-label">Cliente</p>
                <select
                  value={form.cliente_id}
                  onChange={(e) => {
                    setForm({ ...form, cliente_id: e.target.value });
                    setPagosAVincular(new Set());
                  }}
                >
                  <option value="">Selecciona un cliente</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.empresa ? `(${c.empresa})` : ""} — {c.email}
                    </option>
                  ))}
                </select>

                {form.cliente_id && pagosSueltosDelCliente(form.cliente_id).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <p className="sub-label">Vincular pagos sueltos de este cliente (opcional)</p>
                    {pagosSueltosDelCliente(form.cliente_id).map((p) => (
                      <label
                        key={p.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, color: "#333" }}
                      >
                        <input
                          type="checkbox"
                          checked={pagosAVincular.has(p.id)}
                          onChange={() => togglePagoAVincular(p.id)}
                        />
                        {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                      </label>
                    ))}
                  </div>
                )}

                <div className="tel-form-grid">
                  <div>
                    <p className="sub-label">Folio (opcional, se autogenera)</p>
                    <input value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} />
                  </div>
                  <div>
                    <p className="sub-label">Monto</p>
                    <input
                      type="number"
                      step="0.01"
                      value={form.monto}
                      onChange={(e) => setForm({ ...form, monto: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Fecha de emisión</p>
                    <input
                      type="date"
                      value={form.fecha_emision}
                      onChange={(e) => setForm({ ...form, fecha_emision: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Fecha de vencimiento</p>
                    <input
                      type="date"
                      value={form.fecha_vencimiento}
                      onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                    />
                  </div>
                </div>

                <p className="sub-label">Concepto</p>
                <input value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} />

                <p className="sub-label">Subir factura (PDF, opcional)</p>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />

                {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

                <button
                  className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
                  type="submit"
                  disabled={guardando}
                >
                  <span className="btn-enviar-icon-wrapper">
                    <svg
                      className="btn-enviar-icon"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path fill="none" d="M0 0h24v24H0z"></path>
                      <path
                        fill="currentColor"
                        d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                      ></path>
                    </svg>
                  </span>
                  <span className="btn-enviar-check-wrapper">
                    <svg
                      className="btn-enviar-check"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>¡Listo!</span>
                  </span>
                  <span className="btn-enviar-text">+ Guardar factura</span>
                </button>
              </form>
            )}

            {facturas.length === 0 ? (
              <div className="empty-card">Sin facturas registradas en {centro}</div>
            ) : facturasFiltradas.length === 0 ? (
              <div className="empty-card">Ninguna factura coincide con los filtros</div>
            ) : (
              facturasFiltradas.map((f) => {
                const badge = ESTATUS_LABEL[f.estado] || { label: f.estado, bg: "#F0F0F0", color: "#555" };
                const sueltosDelCliente = f.user_id ? pagosSueltosDelCliente(f.user_id) : [];
                return (
                  <div className="contrato-card-admin" key={f.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {f.cliente_nombre} · {f.folio}
                        </p>
                        <p className="contrato-detalle">{f.cliente_email}</p>
                        <p className="contrato-detalle">{f.concepto}</p>
                        <p className="contrato-detalle">
                          ${Number(f.monto).toLocaleString("es-MX")} · vence {f.fecha_vencimiento}
                        </p>
                        {f.uuid_cfdi && (
                          <p className="contrato-detalle" style={{ fontSize: 11, color: "#888" }}>
                            🧾 CFDI · {f.rfc_receptor} · {f.uuid_cfdi}
                          </p>
                        )}
                        {!f.user_id && (
                          <div style={{ marginTop: 6 }}>
                            <p style={{ fontSize: 12, color: "#A32D2D", margin: "0 0 4px" }}>⚠️ Cliente no identificado</p>
                            <select
                              defaultValue=""
                              disabled={asignando === f.id}
                              onChange={(e) => asignarCliente(f.id, e.target.value)}
                            >
                              <option value="">Asignar cliente...</option>
                              {clientes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre} — {c.email}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {f.archivo_url && (
                          <a className="ver-pdf-btn" href={f.archivo_url} target="_blank" download>
                            📥 Ver PDF
                          </a>
                        )}
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => toggleFactura(f)}>
                        {facturaExpandidaId === f.id ? "Ocultar pagos" : "Ver pagos vinculados"}
                      </button>
                    </div>

                    {facturaExpandidaId === f.id && (
                      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
                        {cargandoPagos ? (
                          <p style={{ fontSize: 12, color: "#888" }}>Cargando pagos...</p>
                        ) : pagosDeFactura.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#aaa" }}>Sin pagos vinculados todavía.</p>
                        ) : (
                          pagosDeFactura.map((p) => (
                            <p className="contrato-detalle" key={p.id}>
                              {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                            </p>
                          ))
                        )}

                        {sueltosDelCliente.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <p className="sub-label">Vincular pago suelto de este cliente</p>
                            {sueltosDelCliente.map((p) => (
                              <div
                                key={p.id}
                                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}
                              >
                                <span style={{ fontSize: 12, color: "#555" }}>
                                  {p.concepto || "Pago"} · ${Number(p.monto).toLocaleString("es-MX")} · {p.estado}
                                </span>
                                <button
                                  className="tel-borrar-btn"
                                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                                  disabled={vinculando === p.id}
                                  onClick={() => vincularPago(p.id, f.id)}
                                >
                                  Vincular
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
