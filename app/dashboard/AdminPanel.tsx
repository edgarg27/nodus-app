"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";

type Cliente = {
  id: string;
  nombre: string;
  email: string;
  centro: string | null;
  ciudad: string | null;
  rfc: string | null;
  numero_oficina: string | null;
  tipo_oficina: string | null;
  activo: boolean | null;
  empresa: string | null;
  telefono: string | null;
  ocupantes_oficina: string | null;
};

type Factura = {
  id: string;
  folio: string;
  concepto: string;
  monto: number;
  fecha_vencimiento: string;
  estado: string;
};

type Voucher = {
  id: string;
  codigo: string;
  folio: string;
  centro: string | null;
  created_at: string;
  duracion_minutos: number | null;
  expira_en: string | null;
};

type Notificacion = { id: string; tipo: string; categoria: string | null; mensaje: string; leida: boolean; created_at: string };

const ESTATUS_CONTRATO_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pre_aprobado: { label: "⏳ Pre-aprobado", bg: "#FAEEDA", color: "#854F0B" },
  vigente: { label: "✓ Activo", bg: "#E1F5EE", color: "#0F6E56" },
  rechazado: { label: "✗ Rechazado", bg: "#FCEBEB", color: "#A32D2D" },
  inactivo_debe: { label: "⚠️ Inactivo · debe", bg: "#FCEBEB", color: "#A32D2D" },
  inactivo_pagado: { label: "✓ Inactivo · pagado", bg: "#F0F0F0", color: "#555" },
};

type ContratoResumen = {
  id: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  estatus: string | null;
  archivo_url: string | null;
};

type Resumen = {
  totalClientes: number;
  facturasPendientes: number;
  facturasVencidas: number;
  comprobantesRevisar: number;
};

export default function AdminPanel({
  nombre,
  rol,
  centro,
  resumen,
  clientesIniciales,
}: {
  nombre: string;
  rol: string;
  centro: string | null;
  resumen: Resumen;
  clientesIniciales: Cliente[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [tab, setTab] = useState<"admin" | "clientes">("admin");
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>(clientesIniciales);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);
  const [facturasCliente, setFacturasCliente] = useState<Factura[]>([]);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [vouchersCliente, setVouchersCliente] = useState<Voucher[]>([]);
  const [contratosCliente, setContratosCliente] = useState<ContratoResumen[]>([]);
  const [generandoVoucher, setGenerandoVoucher] = useState(false);
  const [voucherEnviado, setVoucherEnviado] = useState(false);
  const [errorVoucher, setErrorVoucher] = useState("");
  const [duracionVoucher, setDuracionVoucher] = useState(43200); // 30 días default
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [menuNotifAbierto, setMenuNotifAbierto] = useState(false);
  const [misReportesEnProceso, setMisReportesEnProceso] = useState<{ id: string; folio: string; asunto: string }[]>([]);
  const [reporteResuelto, setReporteResuelto] = useState<{ id: string; folio: string; asunto: string } | null>(null);
  const [mostrarCelebracionReporte, setMostrarCelebracionReporte] = useState(false);
  const [editandoDatos, setEditandoDatos] = useState(false);
  const [formEmpresa, setFormEmpresa] = useState("");
  const [formOficina, setFormOficina] = useState("");
  const [formTelefono, setFormTelefono] = useState("");
  const [formOcupantes, setFormOcupantes] = useState("");
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [datosClienteEnviado, setDatosClienteEnviado] = useState(false);
  const [ticketsUrgentes, setTicketsUrgentes] = useState<{ id: string; folio: string; asunto: string; categoria: string }[]>([]);

  const esGlobal =
    rol === "sistemas" ||
    (rol === "superadmin" || rol === "gerente") ||
    rol === "operaciones" ||
    rol === "cobranza" ||
    rol === "atencion_cliente" ||
    rol === "diseno";

  useEffect(() => {
    fetchNotificaciones();
    fetchMisReportes();
    fetchTicketsUrgentes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTicketsUrgentes() {
    let query = supabase
      .from("tickets")
      .select("id, folio, asunto, categoria")
      .eq("urgencia", "urgente")
      .neq("estado", "cerrado")
      .neq("asunto", "📶 Solicitud de nuevo WiFi")
      .order("created_at", { ascending: false });
    if (!esGlobal && centro) query = query.eq("centro", centro);
    if (rol === "sistemas") query = query.eq("categoria", "sistemas");
    else if (rol === "operaciones") query = query.eq("categoria", "mantenimiento");
    const { data } = await query;
    setTicketsUrgentes(data || []);
  }


  async function fetchMisReportes() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: enProceso } = await supabase
      .from("tickets")
      .select("id, folio, asunto")
      .eq("user_id", user.id)
      .eq("estado", "en_proceso");
    setMisReportesEnProceso(enProceso || []);

    const { data: resuelto } = await supabase
      .from("tickets")
      .select("id, folio, asunto")
      .eq("user_id", user.id)
      .eq("estado", "cerrado")
      .eq("notificado_resuelto", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resuelto) {
      setReporteResuelto(resuelto);
      setMostrarCelebracionReporte(true);
      await supabase.from("tickets").update({ notificado_resuelto: true }).eq("id", resuelto.id);
    }
  }

  const TIPOS_NOTIF_SISTEMAS = ["ticket_en_proceso", "ticket_resuelto", "baja_extension", "nuevo_ticket", "nuevo_voucher", "nuevo_did"];
  const TIPOS_NOTIF_OPERACIONES = ["ticket_en_proceso", "ticket_resuelto", "nuevo_ticket", "proximo_mantenimiento"];
  const TIPOS_NOTIF_COBRANZA = ["pago_confirmado", "fecha_pago_hoy", "pago_hoy", "recordatorio_pago", "cuenta_pausada", "nuevo_gasto"];
  const TIPOS_NOTIF_ATENCION = ["nueva_queja"];
  const TIPOS_NOTIF_DISENO = ["nuevo_logro"];

  const TIPOS_TICKET = ["nuevo_ticket", "ticket_en_proceso", "ticket_resuelto"];

  async function fetchNotificaciones() {
    let query = supabase.from("notificaciones").select("*").order("created_at", { ascending: false }).limit(20);
    if (!esGlobal && centro) query = query.eq("centro", centro);
    if (rol === "sistemas") query = query.in("tipo", TIPOS_NOTIF_SISTEMAS);
    else if (rol === "operaciones") query = query.in("tipo", TIPOS_NOTIF_OPERACIONES);
    else if (rol === "cobranza") query = query.in("tipo", TIPOS_NOTIF_COBRANZA);
    else if (rol === "atencion_cliente") query = query.in("tipo", TIPOS_NOTIF_ATENCION);
    else if (rol === "diseno") query = query.in("tipo", TIPOS_NOTIF_DISENO);
    const { data } = await query;
    // Filtro extra: un "nuevo_ticket"/"ticket_en_proceso"/"ticket_resuelto" solo
    // le corresponde a sistemas si es de categoría "sistemas", y a operaciones
    // si es de categoría "mantenimiento" — el tipo solo no basta para separarlos.
    let lista = data || [];
    if (rol === "sistemas") {
      lista = lista.filter((n) => !TIPOS_TICKET.includes(n.tipo) || n.categoria === "sistemas");
    } else if (rol === "operaciones") {
      lista = lista.filter((n) => !TIPOS_TICKET.includes(n.tipo) || n.categoria === "mantenimiento");
    }
    // Logros, quejas y sugerencias solo le llegan al superadmin, no al admin/gerente.
    if (rol === "gerente") {
      lista = lista.filter((n) => n.tipo !== "nueva_queja" && n.tipo !== "nuevo_logro");
    }
    setNotificaciones(lista);
  }

  async function marcarNotifLeida(id: string) {
    await supabase.from("notificaciones").update({ leida: true }).eq("id", id);
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
  }

  async function descartarNotificacion(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setNotificaciones((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notificaciones").delete().eq("id", id);
  }

  function abrirNotificacion(n: Notificacion) {
    if (!n.leida) marcarNotifLeida(n.id);
    setMenuNotifAbierto(false);
    if (n.tipo === "nueva_reservacion") {
      router.push("/centro?tab=reservaciones");
    } else if (n.tipo === "nuevo_tour") {
      router.push("/tours");
    } else if (n.tipo === "baja_extension" || n.tipo === "nuevo_did") {
      router.push("/telefonia");
    } else if (n.tipo === "nuevo_voucher") {
      router.push("/centro?tab=vouchers");
    } else if (n.tipo === "ticket_en_proceso" || n.tipo === "ticket_resuelto" || n.tipo === "nuevo_ticket") {
      router.push(n.mensaje?.includes("📶") ? "/wifi-solicitudes" : "/tickets");
    } else if (n.tipo === "proximo_mantenimiento") {
      router.push("/mantenimiento");
    } else if (n.tipo === "nuevo_gasto") {
      router.push("/cobranza?tab=gastos");
    } else if (
      n.tipo === "pago_confirmado" ||
      n.tipo === "fecha_pago_hoy" ||
      n.tipo === "pago_hoy" ||
      n.tipo === "recordatorio_pago" ||
      n.tipo === "cuenta_pausada"
    ) {
      router.push("/cobranza");
    } else if (n.tipo === "nueva_queja") {
      // Mismo tipo para quejas Y sugerencias (ver app/quejas-sugerencias/page.tsx)
      router.push("/atencion-cliente");
    } else if (n.tipo === "nuevo_logro") {
      router.push("/diseno");
    }
  }

  const notifsSinLeer = notificaciones.filter((n) => !n.leida).length;

  const clientesFiltrados = useMemo(() => {
    if (!busqueda.trim()) return clientes;
    const q = busqueda.toLowerCase();
    return clientes.filter(
      (c) =>
        c.nombre?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.rfc?.toLowerCase().includes(q) ||
        c.numero_oficina?.toLowerCase().includes(q) ||
        c.centro?.toLowerCase().includes(q) ||
        c.empresa?.toLowerCase().includes(q)
    );
  }, [busqueda, clientes]);

  async function verDetalleCliente(cliente: Cliente) {
    setEditandoDatos(false);
    setFormEmpresa(cliente.empresa || "");
    setFormOficina(cliente.numero_oficina || "");
    setFormTelefono(cliente.telefono || "");
    setFormOcupantes(cliente.ocupantes_oficina || "");
    setClienteSeleccionado(cliente);
    setLoadingDetalle(true);
    setErrorVoucher("");
    const [{ data: facturas }, { data: vouchers }, { data: contratos }] = await Promise.all([
      supabase
        .from("facturas")
        .select("*")
        .eq("user_id", cliente.id)
        .order("fecha_vencimiento", { ascending: false }),
      supabase
        .from("vouchers")
        .select("*")
        .eq("user_id", cliente.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contratos")
        .select("id, fecha_inicio, fecha_vencimiento, renta_mensual, estatus, archivo_url")
        .eq("user_id", cliente.id)
        .order("created_at", { ascending: false }),
    ]);
    setFacturasCliente(facturas || []);
    setVouchersCliente(vouchers || []);
    setContratosCliente(contratos || []);
    setLoadingDetalle(false);
  }

  const [borrandoVoucher, setBorrandoVoucher] = useState<string | null>(null);

  async function borrarVoucher(voucherId: string) {
    if (!confirm("¿Borrar este voucher? Si es real, también se elimina del controlador UniFi.")) return;
    setBorrandoVoucher(voucherId);
    setErrorVoucher("");
    try {
      const res = await fetch("/api/eliminar-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorVoucher(data.error || "No se pudo borrar el voucher");
      } else {
        setVouchersCliente((prev) => prev.filter((v) => v.id !== voucherId));
      }
    } catch {
      setErrorVoucher("No se pudo conectar. Intenta de nuevo.");
    }
    setBorrandoVoucher(null);
  }

  async function guardarDatosCliente() {
    if (!clienteSeleccionado) return;
    setGuardandoDatos(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        empresa: formEmpresa.trim() || null,
        numero_oficina: formOficina.trim() || null,
        telefono: formTelefono.trim() || null,
        ocupantes_oficina: formOcupantes.trim() || null,
      })
      .eq("id", clienteSeleccionado.id);

    if (!error) {
      const actualizado = {
        ...clienteSeleccionado,
        empresa: formEmpresa.trim() || null,
        numero_oficina: formOficina.trim() || null,
        telefono: formTelefono.trim() || null,
        ocupantes_oficina: formOcupantes.trim() || null,
      };
      setClienteSeleccionado(actualizado);
      setClientes((prev) => prev.map((c) => (c.id === actualizado.id ? actualizado : c)));
      setEditandoDatos(false);
      setDatosClienteEnviado(true);
      setTimeout(() => setDatosClienteEnviado(false), 1800);
    }
    setGuardandoDatos(false);
  }

  function generarCodigoPrueba() {
    const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";
    for (let i = 0; i < 8; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
    return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
  }

  async function generarVoucherPrueba() {
    if (!clienteSeleccionado) return;
    setGenerandoVoucher(true);
    setErrorVoucher("");

    // Bosques ya está conectado de verdad al controlador UniFi. Los demás
    // centros siguen en modo simulado mientras se les configura su conexión.
    if (clienteSeleccionado.centro === "Bosques") {
      try {
        const res = await fetch("/api/generar-voucher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteId: clienteSeleccionado.id, minutos: duracionVoucher }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorVoucher(data.error || "No se pudo generar el voucher");
        } else {
          setVouchersCliente((prev) => [data.voucher, ...prev]);
          setVoucherEnviado(true);
          setTimeout(() => setVoucherEnviado(false), 1800);
        }
      } catch {
        setErrorVoucher("No se pudo conectar con UniFi. Intenta de nuevo.");
      }
      setGenerandoVoucher(false);
      return;
    }

    // Modo simulado (código de prueba) para centros aún sin UniFi conectado
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const folio = `VCH-${Date.now().toString().slice(-6)}`;
    const codigo = generarCodigoPrueba();
    const expiraEn = new Date(Date.now() + duracionVoucher * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("vouchers")
      .insert({
        user_id: clienteSeleccionado.id,
        codigo,
        folio,
        centro: clienteSeleccionado.centro,
        generado_por: user?.id,
        duracion_minutos: duracionVoucher,
        expira_en: expiraEn,
      })
      .select()
      .single();

    if (!error && data) {
      setVouchersCliente((prev) => [data, ...prev]);
      setVoucherEnviado(true);
      setTimeout(() => setVoucherEnviado(false), 1800);
    }
    setGenerandoVoucher(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const resumenCliente = {
    pendientes: facturasCliente.filter((f) => f.estado === "pendiente").length,
    vencidas: facturasCliente.filter((f) => f.estado === "vencida").length,
    pagadas: facturasCliente.filter((f) => f.estado === "pagada").length,
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-header-title">
            {rol === "sistemas"
              ? "Panel de Sistemas"
              : rol === "operaciones"
              ? "Panel de Operaciones"
              : rol === "cobranza"
              ? "Panel de Cobranza"
              : rol === "atencion_cliente"
              ? "Panel de Atención al Cliente"
              : rol === "diseno"
              ? "Panel de Diseño"
              : "Panel Admin"}
          </p>
          <p className="panel-header-sub">
            Nodus Flex Center{!esGlobal && centro ? ` · ${centro}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ position: "relative" }}>
            <button
              className={"notif-bell" + (notifsSinLeer > 0 ? " notif-bell-ring" : "")}
              onClick={() => setMenuNotifAbierto((v) => !v)}
              title="Notificaciones"
            >
              <svg className="notif-bell-svg" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
                <path d="M224 0c-17.7 0-32 14.3-32 32V49.9C119.5 61.4 64 124.2 64 200v33.4c0 45.4-15.5 89.5-43.8 124.9L5.3 377c-5.8 7.2-6.9 17.1-2.9 25.4S14.8 416 24 416H424c9.2 0 17.6-5.3 21.6-13.6s2.9-18.2-2.9-25.4l-14.9-18.6c-28.3-35.4-43.8-79.5-43.8-124.9V200c0-75.8-55.5-138.6-128-150.1V32c0-17.7-14.3-32-32-32zm0 96h8c57.4 0 104 46.6 104 104v33.4c0 47.9 13.9 94.6 39.7 134.6H72.3c25.8-40 39.7-86.7 39.7-134.6V200c0-57.4 46.6-104 104-104h8zm64 352H160c0 17 6.7 33.3 18.7 45.3S207 512 224 512s33.3-6.7 45.3-18.7S288 465 288 448z" />
              </svg>
              {notifsSinLeer > 0 && <span className="notif-badge">{notifsSinLeer}</span>}
            </button>
            {menuNotifAbierto && (
              <>
                <div className="menu-overlay-click" onClick={() => setMenuNotifAbierto(false)} />
                <div className="notif-dropdown">
                  {notificaciones.length === 0 ? (
                    <p className="notif-empty">Sin notificaciones</p>
                  ) : (
                    notificaciones.map((n) => (
                      <div
                        key={n.id}
                        className={"notif-item" + (!n.leida ? " no-leida" : "")}
                        onClick={() => abrirNotificacion(n)}
                        style={{ position: "relative", paddingRight: 26 }}
                      >
                        <button
                          onClick={(e) => descartarNotificacion(n.id, e)}
                          title="Quitar"
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            border: "none",
                            background: "transparent",
                            color: "#aaa",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                            padding: 4,
                          }}
                        >
                          ✕
                        </button>
                        <p className="notif-item-msg">{n.mensaje}</p>
                        <p className="notif-item-fecha">
                          {new Date(n.created_at).toLocaleString("es-MX")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              className="panel-avatar"
              onClick={() => setMenuAbierto((v) => !v)}
              title="Opciones de cuenta"
            >
              {nombre.charAt(0).toUpperCase()}
            </button>
            {menuAbierto && (
              <>
                <div className="menu-overlay-click" onClick={() => setMenuAbierto(false)} />
                <div className="avatar-dropdown">
                  <p className="avatar-dropdown-nombre">{nombre}</p>
                  <p className="avatar-dropdown-rol">
                    {rol}
                    {centro ? ` · ${centro}` : ""}
                  </p>
                  <button className="avatar-dropdown-item" onClick={handleLogout}>
                    🚪 Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel-tabs">
        <button
          className={"panel-tab" + (tab === "admin" ? " active" : "")}
          onClick={() => setTab("admin")}
        >
          Administrador
        </button>
        {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
          <button
            className={"panel-tab" + (tab === "clientes" ? " active" : "")}
            onClick={() => setTab("clientes")}
          >
            Clientes
          </button>
        )}
      </div>

      {tab === "admin" && (
        <div className="panel-content">
          {misReportesEnProceso.length > 0 &&
            misReportesEnProceso.map((r) => (
              <div className="ticket-en-proceso-banner" key={r.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/herramientas.png" alt="" className="ticket-en-proceso-icon icon-img-24" />
                <div>
                  <p className="ticket-en-proceso-title">Tu reporte {r.folio} está en proceso</p>
                  <p className="ticket-en-proceso-sub">Se está trabajando en &quot;{r.asunto}&quot;</p>
                </div>
              </div>
            ))}

          {ticketsUrgentes.length > 0 && (
            <a href="/tickets" className="alerta-urgente alerta-urgente-link">
              <span className="alerta-urgente-dot" />
              <span className="alerta-urgente-body">
                <p className="alerta-urgente-titulo">
                  {ticketsUrgentes.length} reporte{ticketsUrgentes.length > 1 ? "s" : ""} urgente
                  {ticketsUrgentes.length > 1 ? "s" : ""} sin resolver
                </p>
                <p className="alerta-urgente-item">
                  {ticketsUrgentes
                    .slice(0, 3)
                    .map((t) => t.asunto)
                    .join(" · ")}
                  {ticketsUrgentes.length > 3 ? "…" : ""}
                </p>
              </span>
            </a>
          )}

          {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
            <>
              <p className="panel-section-label">Resumen general</p>
              <div className="stats-row">
                <button className="stat-card" onClick={() => setTab("clientes")}>
                  <p className="stat-val">{resumen.totalClientes}</p>
                  <p className="stat-lbl">Clientes activos</p>
                  <p className="stat-delta">Ver clientes →</p>
                </button>
                <div className="stat-card">
                  <p className="stat-val">{resumen.facturasPendientes}</p>
                  <p className="stat-lbl">Facturas pendientes</p>
                </div>
                <div className="stat-card">
                  <p className="stat-val">{resumen.facturasVencidas}</p>
                  <p className="stat-lbl">Facturas vencidas</p>
                </div>
                <div className="stat-card">
                  <p className="stat-val">{resumen.comprobantesRevisar}</p>
                  <p className="stat-lbl">Comprobantes por revisar</p>
                </div>
              </div>
            </>
          )}

          <p className="panel-section-label" style={{ marginTop: 8 }}>
            Módulos
          </p>
          <div className="modulos-grid">
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/centro?tab=reservaciones">
                <span className="modulo-icon">📋</span>
                <span className="modulo-name">Reservaciones</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/cobranza">
                <span className="modulo-icon">💰</span>
                <span className="modulo-name">Cobranza</span>
              </a>
            )}
            {/* Gastos y Proveedores de sistemas/operaciones/admin ya viven
                dentro de "Panel de Centro" (con factura/comprobante
                adjuntos) — este acceso directo es solo para cobranza, que
                no tiene Panel de Centro. */}
            {(rol === "cobranza" || rol === "superadmin" || rol === "gerente") && (
              <a className="modulo-card" href="/cobranza?tab=gastos">
                <span className="modulo-icon">💸</span>
                <span className="modulo-name">Gastos</span>
              </a>
            )}
            {(rol === "atencion_cliente" || rol === "superadmin" || rol === "gerente") && (
              <a className="modulo-card" href="/atencion-cliente">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/queja.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Quejas y Sugerencias</span>
              </a>
            )}
            {(rol === "diseno" || rol === "superadmin" || rol === "gerente") && (
              <a className="modulo-card" href="/diseno">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/insignia.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Logros</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/tickets">
                <span className="modulo-icon">🎫</span>
                <span className="modulo-name">Tickets</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/contratos">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/contrato.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Contratos</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/registrar-plan">
                <span className="modulo-icon">📝</span>
                <span className="modulo-name">Cotizar</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/prospectos">
                <span className="modulo-icon">🎯</span>
                <span className="modulo-name">Prospectos</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/paquetes">
                <span className="modulo-icon">🎁</span>
                <span className="modulo-name">Paquetes</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/pagos">
                <span className="modulo-icon">💰</span>
                <span className="modulo-name">Pagos</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/deposito-garantia">
                <span className="modulo-icon">🔒</span>
                <span className="modulo-name">Depósito en garantía</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/facturas-admin">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/factura.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Facturas</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/experiencia-cliente">
                <span className="modulo-icon">🎉</span>
                <span className="modulo-name">Experiencia de Cliente</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/reportes">
                <span className="modulo-icon">📊</span>
                <span className="modulo-name">Reportes</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/ingresos-centro">
                <span className="modulo-icon">💹</span>
                <span className="modulo-name">Ingresos por Centro</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/telefonia">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/telefono.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Telefonía</span>
              </a>
            )}
            {(rol === "sistemas" || (rol === "superadmin" || rol === "gerente")) && (
              <a className="modulo-card" href="/wifi-solicitudes">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/wifi.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">WiFi</span>
              </a>
            )}
            {(rol === "superadmin" || rol === "gerente") && (
              <a className="modulo-card" href="/usuarios">
                <span className="modulo-icon">🔑</span>
                <span className="modulo-name">Usuarios</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/centro">
                <span className="modulo-icon">🏢</span>
                <span className="modulo-name">Panel de Centro</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/mapa-oficinas">
                <span className="modulo-icon">🗺️</span>
                <span className="modulo-name">Mapa oficinas</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/correos">
                <span className="modulo-icon">📧</span>
                <span className="modulo-name">Correos</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/alta-cliente">
                <span className="modulo-icon">👤</span>
                <span className="modulo-name">Nuevo cliente</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/baja-cliente">
                <span className="modulo-icon">🚪</span>
                <span className="modulo-name">Baja de cliente</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/tours">
                <span className="modulo-icon">🚶</span>
                <span className="modulo-name">Tours</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/sala-juntas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/sala-juntas.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Sala de Juntas</span>
              </a>
            )}
            {rol !== "sistemas" && rol !== "operaciones" && rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/cotizaciones">
                <span className="modulo-icon">🧾</span>
                <span className="modulo-name">Cotizaciones</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/mantenimiento">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/herramientas.png" alt="" className="modulo-icon icon-img-32" />
                <span className="modulo-name">Mtto.</span>
              </a>
            )}
            {rol !== "cobranza" && rol !== "operaciones" && rol !== "atencion_cliente" && rol !== "diseno" && (
              <a className="modulo-card" href="/inventario">
                <span className="modulo-icon">📦</span>
                <span className="modulo-name">Inventario</span>
              </a>
            )}
            {(rol === "sistemas" || rol === "superadmin" || rol === "gerente") && (
              <a className="modulo-card" href="/equipos">
                <span className="modulo-icon">💻</span>
                <span className="modulo-name">Equipos</span>
              </a>
            )}
          </div>
        </div>
      )}

      {tab === "clientes" && (
        <div className="panel-content">
          <div className="search-box">
            <span>🔍</span>
            <input
              placeholder="Buscar por nombre, correo, RFC, oficina o centro..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda && (
              <button
                className="modal-cerrar"
                onClick={() => setBusqueda("")}
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>

          <button
            className="btn-exportar"
            style={{ alignSelf: "flex-start" }}
            onClick={() =>
              exportarExcel(
                "clientes",
                clientesFiltrados.map((c) => ({
                  Nombre: c.nombre,
                  Email: c.email,
                  Empresa: c.empresa || "",
                  Centro: c.centro || "",
                  Oficina: c.numero_oficina || "",
                  RFC: c.rfc || "",
                  Activo: c.activo ? "Sí" : "No",
                }))
              )
            }
          >
            📥 Exportar Excel
          </button>

          <div className="cliente-list">
            {clientesFiltrados.length === 0 ? (
              <div className="empty-card">Sin clientes que coincidan con la búsqueda</div>
            ) : (
              clientesFiltrados.map((c) => (
                <button
                  key={c.id}
                  className="cliente-card"
                  onClick={() => verDetalleCliente(c)}
                >
                  <div className="cliente-avatar">
                    {c.nombre ? c.nombre.charAt(0).toUpperCase() : "?"}
                  </div>
                  <div className="cliente-info">
                    <p className="cliente-nombre">{c.nombre}</p>
                    <p className="cliente-email">{c.email}</p>
                    {c.empresa && (
                      <p className="cliente-centro" style={{ color: "#0d1b3e", fontWeight: 600 }}>
                        🏛️ {c.empresa}
                      </p>
                    )}
                    {c.centro && (
                      <p className="cliente-centro">
                        🏢 {c.centro}
                        {c.numero_oficina ? ` · Oficina ${c.numero_oficina}` : ""}
                      </p>
                    )}
                  </div>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: 20,
                      fontSize: 10,
                      fontWeight: 600,
                      background: c.activo ? "#E1F5EE" : "#FCEBEB",
                      color: c.activo ? "#0F6E56" : "#A32D2D",
                      flexShrink: 0,
                    }}
                  >
                    {c.activo ? "Activo" : "Inactivo"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {clienteSeleccionado && (
        <div className="modal-overlay" onClick={() => setClienteSeleccionado(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-avatar">
                {clienteSeleccionado.nombre
                  ? clienteSeleccionado.nombre.charAt(0).toUpperCase()
                  : "?"}
              </div>
              <div style={{ flex: 1 }}>
                <p className="modal-nombre">{clienteSeleccionado.nombre}</p>
                <p className="modal-email">{clienteSeleccionado.email}</p>
              </div>
              <button className="modal-cerrar" onClick={() => setClienteSeleccionado(null)}>
                ✕
              </button>
            </div>

            <a
              className="btn-enviar"
              style={{ textDecoration: "none", display: "block", textAlign: "center", marginBottom: 8 }}
              href={`/registrar-plan?clienteId=${clienteSeleccionado.id}`}
            >
              🧾 Cotizar
            </a>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="modal-seccion" style={{ margin: 0 }}>
                📋 Datos del cliente
              </p>
              {!editandoDatos && (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setEditandoDatos(true)}
                >
                  ✎ Editar
                </button>
              )}
            </div>

            {editandoDatos ? (
              <div className="form-card" style={{ padding: 0, border: "none" }}>
                <p className="sub-label">Empresa</p>
                <input
                  value={formEmpresa}
                  onChange={(e) => setFormEmpresa(e.target.value)}
                  placeholder="Nombre de la empresa"
                />
                <p className="sub-label">Número de oficina</p>
                <input
                  value={formOficina}
                  onChange={(e) => setFormOficina(e.target.value)}
                  placeholder="Ej. 102"
                />
                <p className="sub-label">Teléfono</p>
                <input
                  value={formTelefono}
                  onChange={(e) => setFormTelefono(e.target.value)}
                  placeholder="Ej. 449 123 4567"
                />
                <p className="sub-label">Personas en la oficina</p>
                <input
                  value={formOcupantes}
                  onChange={(e) => setFormOcupantes(e.target.value)}
                  placeholder="Ej. Juan Pérez, María López"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    className={"btn-enviar" + (guardandoDatos ? " sending" : "") + (datosClienteEnviado ? " sent" : "")}
                    style={{ flex: 1 }}
                    onClick={guardarDatosCliente}
                    disabled={guardandoDatos}
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
                    <span className="btn-enviar-text">Guardar</span>
                  </button>
                  <button
                    className="tel-borrar-btn"
                    style={{ color: "#888" }}
                    onClick={() => setEditandoDatos(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {clienteSeleccionado.empresa && (
                  <div className="modal-row">
                    <span className="modal-label">Empresa</span>
                    <span className="modal-val">{clienteSeleccionado.empresa}</span>
                  </div>
                )}
                {clienteSeleccionado.rfc && (
                  <div className="modal-row">
                    <span className="modal-label">RFC</span>
                    <span className="modal-val">{clienteSeleccionado.rfc}</span>
                  </div>
                )}
                <div className="modal-row">
                  <span className="modal-label">Ciudad</span>
                  <span className="modal-val">{clienteSeleccionado.ciudad || "-"}</span>
                </div>
                <div className="modal-row">
                  <span className="modal-label">Centro</span>
                  <span className="modal-val">{clienteSeleccionado.centro || "-"}</span>
                </div>
                {clienteSeleccionado.numero_oficina && (
                  <div className="modal-row">
                    <span className="modal-label">Oficina</span>
                    <span className="modal-val">{clienteSeleccionado.numero_oficina}</span>
                  </div>
                )}
                {clienteSeleccionado.tipo_oficina && (
                  <div className="modal-row">
                    <span className="modal-label">Tipo</span>
                    <span className="modal-val">{clienteSeleccionado.tipo_oficina}</span>
                  </div>
                )}
                {clienteSeleccionado.telefono && (
                  <div className="modal-row">
                    <span className="modal-label">Teléfono</span>
                    <span className="modal-val">{clienteSeleccionado.telefono}</span>
                  </div>
                )}
                {clienteSeleccionado.ocupantes_oficina && (
                  <div className="modal-row">
                    <span className="modal-label">Personas en la oficina</span>
                    <span className="modal-val">{clienteSeleccionado.ocupantes_oficina}</span>
                  </div>
                )}
              </div>
            )}

            <p className="modal-seccion">📄 Contratos</p>
            {loadingDetalle ? (
              <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
            ) : contratosCliente.length === 0 ? (
              <p style={{ fontSize: 13, color: "#888" }}>Este cliente no tiene contratos registrados.</p>
            ) : (
              contratosCliente.map((ct) => {
                const badge = ESTATUS_CONTRATO_LABEL[ct.estatus || ""] || { label: ct.estatus || "—", bg: "#F0F0F0", color: "#555" };
                return (
                  <div className="factura-row" key={ct.id}>
                    <div>
                      <p className="factura-folio">
                        {ct.fecha_inicio} → {ct.fecha_vencimiento}
                      </p>
                      <p className="factura-concepto">${Number(ct.renta_mensual).toLocaleString("es-MX")}/mes</p>
                      {ct.archivo_url && (
                        <a className="ver-pdf-btn" href={ct.archivo_url} target="_blank" download>
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
                );
              })
            )}

            <p className="modal-seccion">💰 Estado de cuenta</p>
            {loadingDetalle ? (
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
                <div className="resumen-pagos">
                  <div className="resumen-pago-card" style={{ borderLeftColor: "#854F0B" }}>
                    <p className="resumen-pago-num">{resumenCliente.pendientes}</p>
                    <p className="resumen-pago-lbl">Pendientes</p>
                  </div>
                  <div className="resumen-pago-card" style={{ borderLeftColor: "#A32D2D" }}>
                    <p className="resumen-pago-num">{resumenCliente.vencidas}</p>
                    <p className="resumen-pago-lbl">Vencidas</p>
                  </div>
                  <div className="resumen-pago-card" style={{ borderLeftColor: "#0F6E56" }}>
                    <p className="resumen-pago-num">{resumenCliente.pagadas}</p>
                    <p className="resumen-pago-lbl">Pagadas</p>
                  </div>
                </div>

                {facturasCliente.slice(0, 4).map((f) => (
                  <div className="factura-row" key={f.id}>
                    <div>
                      <p className="factura-folio">{f.folio}</p>
                      <p className="factura-concepto">{f.concepto}</p>
                      <p className="factura-fecha">Vence: {f.fecha_vencimiento}</p>
                    </div>
                    <div>
                      <p className="factura-monto">
                        ${Number(f.monto).toLocaleString("es-MX")}
                      </p>
                      <span
                        className="factura-badge"
                        style={{
                          background:
                            f.estado === "pagada"
                              ? "#E1F5EE"
                              : f.estado === "vencida"
                              ? "#FCEBEB"
                              : "#FAEEDA",
                        }}
                      >
                        <span className="factura-badge-text">
                          {f.estado === "pagada"
                            ? "✓ Pagada"
                            : f.estado === "vencida"
                            ? "⚠️ Vencida"
                            : "⏳ Pendiente"}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
                {facturasCliente.length === 0 && (
                  <p style={{ textAlign: "center", color: "#888", fontSize: 13, padding: "16px 0" }}>
                    Sin facturas registradas
                  </p>
                )}

                <p className="modal-seccion">
                  <img
                    src="/icons/wifi.png"
                    alt=""
                    style={{ width: 16, height: 16, verticalAlign: -3, marginRight: 6 }}
                  />
                  Ticket de conexión
                </p>
                {vouchersCliente.length > 0 ? (
                  <div
                    style={{
                      background: "#0d1b3e",
                      borderRadius: 12,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: 0 }}>
                      Tu ticket de conexión es:
                    </p>
                    <p
                      style={{
                        color: "#fff",
                        fontSize: 22,
                        fontWeight: 700,
                        letterSpacing: 1,
                        margin: 0,
                        fontFamily: "monospace",
                      }}
                    >
                      {vouchersCliente[0].codigo}
                    </p>
                    <p style={{ color: "#f07e3a", fontSize: 12, fontWeight: 600, margin: "4px 0 0" }}>
                      Folio: {vouchersCliente[0].folio}
                    </p>
                    <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, margin: "2px 0 0" }}>
                      Generado el{" "}
                      {new Date(vouchersCliente[0].created_at).toLocaleDateString("es-MX")}
                    </p>
                    {vouchersCliente[0].expira_en && (
                      <p
                        style={{
                          color:
                            new Date(vouchersCliente[0].expira_en) < new Date()
                              ? "#f07e3a"
                              : "rgba(255,255,255,0.5)",
                          fontSize: 11,
                          margin: "1px 0 0",
                          fontWeight: 600,
                        }}
                      >
                        {new Date(vouchersCliente[0].expira_en) < new Date() && (
                          <img
                            src="/icons/advertencia.png"
                            alt=""
                            style={{ width: 12, height: 12, verticalAlign: -1, marginRight: 4 }}
                          />
                        )}
                        {new Date(vouchersCliente[0].expira_en) < new Date()
                          ? "Venció el "
                          : "Vence el "}
                        {new Date(vouchersCliente[0].expira_en).toLocaleString("es-MX")}
                      </p>
                    )}
                    <button
                      onClick={() => borrarVoucher(vouchersCliente[0].id)}
                      disabled={borrandoVoucher === vouchersCliente[0].id}
                      style={{
                        marginTop: 8,
                        alignSelf: "flex-start",
                        background: "rgba(255,255,255,0.1)",
                        border: "none",
                        color: "#fca5a5",
                        fontSize: 11,
                        padding: "6px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      {borrandoVoucher === vouchersCliente[0].id ? "Borrando..." : "🗑 Borrar este voucher"}
                    </button>
                  </div>
                ) : (
                  <p style={{ color: "#888", fontSize: 13 }}>
                    Este cliente aún no tiene un voucher generado.
                  </p>
                )}

                <div>
                  <p className="sub-label" style={{ marginBottom: 6 }}>
                    Duración del voucher
                  </p>
                  <select
                    className="ticket-admin-select"
                    style={{ width: "100%", padding: "10px 12px" }}
                    value={duracionVoucher}
                    onChange={(e) => setDuracionVoucher(Number(e.target.value))}
                  >
                    <option value={60}>1 hora</option>
                    <option value={480}>8 horas</option>
                    <option value={1440}>1 día</option>
                    <option value={10080}>7 días</option>
                    <option value={43200}>30 días</option>
                    <option value={129600}>90 días</option>
                  </select>
                </div>

                <button
                  className={"btn-enviar" + (generandoVoucher ? " sending" : "") + (voucherEnviado ? " sent" : "")}
                  onClick={generarVoucherPrueba}
                  disabled={generandoVoucher}
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
                  <span className="btn-enviar-text">
                    {clienteSeleccionado.centro === "Bosques"
                      ? "🎫 Generar voucher (real, vía UniFi)"
                      : "🎫 Generar voucher (prueba)"}
                  </span>
                </button>
                {errorVoucher && (
                  <p style={{ color: "#A32D2D", fontSize: 12, margin: 0 }}>{errorVoucher}</p>
                )}
                {clienteSeleccionado.centro !== "Bosques" && (
                  <p style={{ color: "#aaa", fontSize: 11, margin: 0, fontStyle: "italic" }}>
                    Este centro aún no está conectado al controlador UniFi real — el código
                    generado es solo de prueba.
                  </p>
                )}

                {vouchersCliente.length > 1 && (
                  <>
                    <p className="sub-label" style={{ marginTop: 4 }}>
                      Vouchers anteriores
                    </p>
                    {vouchersCliente.slice(1).map((v) => (
                      <div className="factura-row" key={v.id}>
                        <div>
                          <p className="factura-folio">{v.folio}</p>
                          <p className="factura-fecha">
                            {new Date(v.created_at).toLocaleDateString("es-MX")}
                          </p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p className="factura-monto" style={{ fontFamily: "monospace" }}>
                            {v.codigo}
                          </p>
                          <button
                            onClick={() => borrarVoucher(v.id)}
                            disabled={borrandoVoucher === v.id}
                            className="tel-borrar-btn"
                            style={{ fontSize: 11 }}
                          >
                            {borrandoVoucher === v.id ? "..." : "🗑 Borrar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {mostrarCelebracionReporte && reporteResuelto && (
        <div className="modal-overlay" onClick={() => setMostrarCelebracionReporte(false)}>
          <div className="confetti-wrap">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="confetti-piece"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.6}s`,
                  background: ["#f07e3a", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
                }}
              />
            ))}
          </div>
          <div className="celebracion-card" onClick={(e) => e.stopPropagation()}>
            <p className="celebracion-icon">🎉</p>
            <p className="celebracion-title">¡Tu reporte fue resuelto!</p>
            <p className="celebracion-sub">
              {reporteResuelto.folio} · {reporteResuelto.asunto}
            </p>
            <button className="reservar-btn" onClick={() => setMostrarCelebracionReporte(false)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
