"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

type Cliente = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  rfc: string | null;
  numero_oficina: string | null;
  tipo_oficina: string | null;
  numero_usuario: string | null;
};

type Contrato = {
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  horas_sala_juntas: number | null;
  archivo_url: string | null;
  estatus: string | null;
};

type PagoPendiente = { id: string; concepto: string | null; monto: number; estado: string };

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

export default function BajaClientePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [pagosPendientes, setPagosPendientes] = useState<PagoPendiente[]>([]);
  const [depositoPagado, setDepositoPagado] = useState(0);

  const [confirmado, setConfirmado] = useState(false);
  const [debe, setDebe] = useState(false);
  const [montoAdeudado, setMontoAdeudado] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);

  const confettiBaja = useMemo(() => {
    if (!exito) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exito]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

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
    setMiRol(profile?.rol || "");
    setCentro(profile?.centro || null);

    let query = supabase
      .from("profiles")
      .select("id, nombre, email, empresa, rfc, numero_oficina, tipo_oficina, numero_usuario")
      .eq("rol", "cliente")
      .eq("activo", true)
      .order("nombre");
    if (!ROLES_GLOBALES.includes(profile?.rol || "") && profile?.centro) {
      query = query.eq("centro", profile.centro);
    }
    const { data } = await query;
    setClientes(data || []);
    setLoading(false);
  }

  const clientesFiltrados = clientes.filter((c) => {
    const q = busqueda.toLowerCase();
    return !q || c.nombre?.toLowerCase().includes(q) || c.empresa?.toLowerCase().includes(q);
  });

  async function seleccionarCliente(c: Cliente) {
    setClienteSel(c);
    setConfirmado(false);
    setError("");
    setCargandoDetalle(true);
    const [{ data }, { data: pendientes }, { data: depositos }] = await Promise.all([
      supabase
        .from("contratos")
        .select("fecha_inicio, fecha_vencimiento, renta_mensual, horas_sala_juntas, archivo_url, estatus")
        .eq("user_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Lo que debe: todos sus pagos que no estén ya pagados.
      supabase.from("pagos").select("id, concepto, monto, estado").eq("user_id", c.id).neq("estado", "pagado"),
      // Lo que ya cubrió: su depósito en garantía, si ya lo pagó — se resta
      // porque al dar de baja se le puede devolver o descontar del adeudo.
      // El concepto cambió a incluir el IVA (ver ContratoModal.tsx →
      // aprobar()), pero se buscan ambos por si el cliente tiene un pago
      // viejo con el concepto anterior.
      supabase
        .from("pagos")
        .select("monto")
        .eq("user_id", c.id)
        .eq("estado", "pagado")
        .in("concepto", ["Depósito en garantía", "Depósito en garantía (incl. IVA)"]),
    ]);
    setContrato(data);

    const totalPendiente = (pendientes || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const totalDepositoPagado = (depositos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const netoAdeudado = Math.max(0, totalPendiente - totalDepositoPagado);

    setPagosPendientes(pendientes || []);
    setDepositoPagado(totalDepositoPagado);
    setDebe(netoAdeudado > 0);
    setMontoAdeudado(netoAdeudado > 0 ? String(netoAdeudado) : "");

    setCargandoDetalle(false);
  }

  async function darDeBaja() {
    if (!clienteSel || !confirmado) return;
    if (debe && (!montoAdeudado || Number(montoAdeudado) <= 0)) {
      setError("Pon cuánto quedó debiendo el cliente");
      return;
    }
    if (!confirm(`¿Confirmas dar de baja a ${clienteSel.nombre}? Se borra su cuenta y no podrá volver a entrar.`))
      return;
    setProcesando(true);
    setError("");
    try {
      const res = await fetch("/api/dar-baja-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: clienteSel.id,
          debe,
          montoAdeudado: debe ? montoAdeudado : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo dar de baja al cliente");
      } else {
        setExito(true);
        setClientes((prev) => prev.filter((c) => c.id !== clienteSel.id));
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setProcesando(false);
  }

  if (exito && clienteSel) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Cliente dado de baja</p>
        </div>
        <div className="sub-content">
          <div className="exito-card">
            <div className="confetti">
              {confettiBaja.map((c) => (
                <span
                  key={c.id}
                  className="confetti-pieza"
                  style={{
                    left: `${c.left}%`,
                    background: c.color,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.duracion}s`,
                  }}
                />
              ))}
            </div>

            <div className="exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="exito-titulo">{clienteSel.nombre} fue dado de baja</p>
            <p className="exito-mensaje">Su cuenta y acceso quedaron eliminados. El contrato se conserva como registro.</p>
            <button
              className="exito-btn"
              onClick={() => {
                setExito(false);
                setClienteSel(null);
              }}
            >
              Dar de baja a otro cliente
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Baja de cliente</p>
        <p className="rep-sub">{esGlobal ? "Cualquier centro" : centro || "Tu centro"}</p>
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
        ) : !clienteSel ? (
          <>
            <input
              type="text"
              placeholder="Buscar cliente por nombre o empresa..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            />
            {clientesFiltrados.length === 0 ? (
              <div className="empty-card">Sin clientes activos que coincidan</div>
            ) : (
              clientesFiltrados.map((c) => (
                <button key={c.id} className="cliente-card" onClick={() => seleccionarCliente(c)}>
                  <div className="cliente-avatar">{c.nombre.charAt(0).toUpperCase()}</div>
                  <div className="cliente-info">
                    <p className="cliente-nombre">{c.nombre}</p>
                    <p className="cliente-email">{c.email}</p>
                    {c.empresa && <p className="cliente-centro">🏛️ {c.empresa}</p>}
                  </div>
                </button>
              ))
            )}
          </>
        ) : (
          <>
            <button
              className="tel-borrar-btn"
              style={{ color: "#0d1b3e", fontWeight: 600, alignSelf: "flex-start" }}
              onClick={() => setClienteSel(null)}
            >
              ← Elegir otro cliente
            </button>

            <div className="baja-detalle-card">
              <p className="contrato-cliente-nombre">
                {clienteSel.nombre} {clienteSel.empresa ? `· ${clienteSel.empresa}` : ""}
              </p>
              <p className="contrato-detalle">{clienteSel.email}</p>
              {clienteSel.numero_usuario && (
                <p className="contrato-detalle">Usuario: {clienteSel.numero_usuario}</p>
              )}
              {clienteSel.rfc && <p className="contrato-detalle">RFC: {clienteSel.rfc}</p>}
              <p className="contrato-detalle">
                {clienteSel.tipo_oficina === "oficina_privada"
                  ? `Oficina privada ${clienteSel.numero_oficina || ""}`
                  : clienteSel.tipo_oficina === "coworking"
                  ? "Coworking"
                  : clienteSel.tipo_oficina === "working_desk"
                  ? "Working desk"
                  : "Espacio sin especificar"}
              </p>
            </div>

            {cargandoDetalle ? (
              <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando contrato...</p>
          </div>
            ) : contrato ? (
              <div className="baja-detalle-card">
                <p className="panel-section-label" style={{ margin: 0 }}>
                  Contrato
                </p>
                <p className="contrato-detalle">
                  {contrato.fecha_inicio} → {contrato.fecha_vencimiento}
                </p>
                <p className="contrato-detalle">
                  ${Number(contrato.renta_mensual).toLocaleString("es-MX")}/mes
                  {contrato.horas_sala_juntas ? ` · ${contrato.horas_sala_juntas}h sala de juntas` : ""}
                </p>
                {contrato.archivo_url ? (
                  <a className="ver-pdf-btn" href={contrato.archivo_url} target="_blank" download>
                    📥 Ver y descargar contrato
                  </a>
                ) : (
                  <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>Sin contrato PDF adjunto</p>
                )}
              </div>
            ) : (
              <div className="empty-card">Este cliente no tiene contrato registrado</div>
            )}

            {!cargandoDetalle && (pagosPendientes.length > 0 || depositoPagado > 0) && (
              <div className="baja-detalle-card">
                <p className="panel-section-label" style={{ margin: 0 }}>
                  💰 Lo que debe el cliente
                </p>
                {pagosPendientes.map((p) => (
                  <p className="contrato-detalle" key={p.id}>
                    {p.concepto || "Pago"} ({p.estado}) · ${Number(p.monto).toLocaleString("es-MX")}
                  </p>
                ))}
                <p className="contrato-detalle" style={{ fontWeight: 700 }}>
                  Subtotal pendiente: $
                  {pagosPendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0).toLocaleString("es-MX")}
                </p>
                {depositoPagado > 0 && (
                  <p className="contrato-detalle">− Depósito ya pagado: ${depositoPagado.toLocaleString("es-MX")}</p>
                )}
                <p className="contrato-detalle" style={{ fontWeight: 700, color: "#0d1b3e" }}>
                  Total neto adeudado: $
                  {Math.max(
                    0,
                    pagosPendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0) - depositoPagado
                  ).toLocaleString("es-MX")}
                </p>
              </div>
            )}

            <div className="warning-box">
              <p className="warning-box-title">⚠️ Antes de dar de baja, revisa el espacio</p>
              <p className="warning-box-text">
                Verifica que la oficina, mobiliario y equipo que se le entregó al cliente estén
                exactamente en las mismas condiciones en que se le dieron al inicio del contrato
                (mismo mobiliario, sin daños, llaves/tarjetas de acceso devueltas, etc.).
              </p>
              <p className="warning-box-text">
                Al confirmar se borran también sus tickets, reservaciones y extensión/DID
                asignados. Si tenía extensión, se le avisa a sistemas para que la libere en el
                conmutador. El contrato se conserva como registro histórico.
              </p>
              <p className="warning-box-text" style={{ fontWeight: 700 }}>
                Si encuentras algún faltante o daño, ese costo se le cobrará al cliente antes de
                cerrar su cuenta — no continúes con la baja hasta resolverlo.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333" }}>
                  <input type="radio" checked={!debe} onChange={() => setDebe(false)} />
                  El cliente se fue y no debe nada
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333" }}>
                  <input type="radio" checked={debe} onChange={() => setDebe(true)} />
                  El cliente se va debiendo dinero
                </label>
                {debe && (
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Monto que debe (ej. 123)"
                    value={montoAdeudado}
                    onChange={(e) => setMontoAdeudado(e.target.value)}
                    style={{
                      border: "1px solid #f5c99a",
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontSize: 14,
                      marginLeft: 24,
                    }}
                  />
                )}
              </div>

              <label className="warning-check-row">
                <input
                  type="checkbox"
                  checked={confirmado}
                  onChange={(e) => setConfirmado(e.target.checked)}
                />
                <span style={{ fontSize: 13, color: "#333" }}>
                  Ya revisé el espacio, está en las condiciones en que se entregó (o cualquier
                  diferencia ya quedó resuelta/cobrada), y confirmo dar de baja a este cliente.
                </span>
              </label>
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="btn-dar-baja" onClick={darDeBaja} disabled={!confirmado || procesando}>
              {procesando ? "Procesando..." : "🚪 Dar de baja a este cliente"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
