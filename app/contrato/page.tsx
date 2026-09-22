"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSignedFileUrl } from "@/lib/storage";
import { conIva, totalAdicionalesMensuales } from "@/lib/adicionales";
import { DIA_LIMITE_PAGO_MENSUAL } from "@/lib/formaPago";

type Adicional = { id: string; concepto: string; cantidad: number | null; monto: number | null };

type Contrato = {
  id: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estatus: string | null;
  archivo_url: string | null;
  renta_mensual: number | null;
  horas_sala_juntas: number | null;
  dia_pago: number | null;
  deposito_garantia: number | null;
  forma_pago: string | null;
};

const CONCEPTO_PAGO_DEPOSITO = "Depósito en garantía (incl. IVA)";

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ContratoPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const contratoId = searchParams.get("contratoId");
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("");
  const [depositoPagado, setDepositoPagado] = useState(false);
  const [adicionales, setAdicionales] = useState<Adicional[]>([]);

  // Solicitudes al staff (renovar, más horas, cambiar espacio, otro).
  type SolicitudCliente = { id: string; tipo: string; estado: string; created_at: string };
  const [misSolicitudes, setMisSolicitudes] = useState<SolicitudCliente[]>([]);
  const [mostrarSolicitud, setMostrarSolicitud] = useState(false);
  const [tipoSolicitud, setTipoSolicitud] = useState("renovar");
  const [mensajeSolicitud, setMensajeSolicitud] = useState("");
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [errorSolicitud, setErrorSolicitud] = useState("");
  const [solicitudEnviada, setSolicitudEnviada] = useState(false);
  const [abriendoContrato, setAbriendoContrato] = useState(false);

  async function abrirContrato() {
    if (!contrato?.archivo_url) return;
    setAbriendoContrato(true);
    const { url, error } = await getSignedFileUrl(supabase, "contratos", contrato.archivo_url);
    setAbriendoContrato(false);
    if (!url) {
      alert("No se pudo abrir el contrato: " + (error || "intenta de nuevo"));
      return;
    }
    window.open(url, "_blank");
  }

  useEffect(() => {
    fetchContrato();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoId]);

  async function fetchContrato() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("numero_oficina, centro")
      .eq("id", user.id)
      .single();
    if (profile) {
      setSub(
        `${profile.numero_oficina ? `Oficina ${profile.numero_oficina} · ` : ""}${
          profile.centro || ""
        }`
      );
    }

    let query = supabase.from("contratos").select("*").eq("user_id", user.id);
    query = contratoId ? query.eq("id", contratoId) : query.order("created_at", { ascending: false });
    const { data } = await query.limit(1).maybeSingle();

    setContrato(data);

    if (data) {
      const { data: adics } = await supabase
        .from("contrato_adicionales")
        .select("id, concepto, cantidad, monto")
        .eq("contrato_id", data.id)
        .order("created_at");
      setAdicionales(adics || []);
      await cargarSolicitudes(user.id);
    }

    if (data && data.deposito_garantia) {
      const { data: pago } = await supabase
        .from("pagos")
        .select("estado")
        .eq("contrato_id", data.id)
        .eq("concepto", CONCEPTO_PAGO_DEPOSITO)
        .maybeSingle();
      setDepositoPagado(pago?.estado === "pagado");
    }

    setLoading(false);
  }

  // Meses de calendario reales entre dos fechas (no días/30 — los meses no
  // miden todos 30 días, eso desfasaba el conteo hasta por un mes de más).
  // Redondea hacia arriba: si sobra cualquier fracción de mes, cuenta como
  // un mes más en curso.
  function mesesEntre(desde: Date, hasta: Date) {
    if (hasta <= desde) return 0;
    let meses = (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
    let alineado = new Date(desde.getFullYear(), desde.getMonth() + meses, desde.getDate());
    while (alineado > hasta) {
      meses--;
      alineado = new Date(desde.getFullYear(), desde.getMonth() + meses, desde.getDate());
    }
    if (alineado < hasta) meses++;
    return Math.max(meses, 0);
  }

  function calcularInfo() {
    if (!contrato) return { mesesRestantes: 0, porcentaje: 0 };
    const hoy = new Date();
    const inicio = new Date(contrato.fecha_inicio);
    const fin = new Date(contrato.fecha_vencimiento);
    const totalDias = (fin.getTime() - inicio.getTime()) / 86400000;
    const diasTranscurridos = (hoy.getTime() - inicio.getTime()) / 86400000;
    const porcentaje = Math.min(Math.max((diasTranscurridos / totalDias) * 100, 0), 100);
    const mesesRestantes = mesesEntre(hoy, fin);
    return { mesesRestantes, porcentaje };
  }

  const { mesesRestantes, porcentaje } = calcularInfo();

  const ETIQUETA_SOLICITUD: Record<string, string> = {
    renovar: "Renovar mi contrato",
    mas_horas: "Más horas de sala de juntas",
    cambiar_espacio: "Cambiar o ampliar mi espacio",
    otro: "Otra solicitud",
  };

  async function cargarSolicitudes(userId: string) {
    const { data } = await supabase
      .from("solicitudes_cliente")
      .select("id, tipo, estado, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);
    setMisSolicitudes(data || []);
  }

  async function enviarSolicitud() {
    setEnviandoSolicitud(true);
    setErrorSolicitud("");
    try {
      const res = await fetch("/api/solicitudes-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: tipoSolicitud, mensaje: mensajeSolicitud, contratoId: contrato?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorSolicitud(data.error || "No se pudo enviar la solicitud");
      } else {
        setSolicitudEnviada(true);
        setMensajeSolicitud("");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) await cargarSolicitudes(user.id);
      }
    } catch {
      setErrorSolicitud("No se pudo conectar. Intenta de nuevo.");
    }
    setEnviandoSolicitud(false);
  }
  const totalMensualAdicionales = totalAdicionalesMensuales(adicionales);

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mi Contrato</p>
        <p className="rep-sub">{sub}</p>
      </div>

      <div className="sub-content">
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
        ) : !contrato ? (
          <div className="empty-card">
            <img
              src="/icons/contrato.png"
              alt=""
              style={{ width: 40, height: 40, margin: "0 auto" }}
            />
            <p style={{ fontWeight: 700, color: "#1a1a1a", margin: "8px 0 4px" }}>
              Sin contrato registrado
            </p>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
              Aún no se ha cargado tu contrato. Comunícate con administración para más información.
            </p>
          </div>
        ) : (
          <>
            <div className="contrato-card">
              <div className="contrato-row">
                <span className="modal-label">Inicio de contrato</span>
                <span className="modal-val">{formatFecha(contrato.fecha_inicio)}</span>
              </div>
              <div className="contrato-row">
                <span className="modal-label">Vencimiento</span>
                <span className="modal-val">{formatFecha(contrato.fecha_vencimiento)}</span>
              </div>
              {contrato.renta_mensual != null && (
                <div className="contrato-row">
                  <span className="modal-label">Renta mensual</span>
                  <span className="modal-val">
                    ${Number(contrato.renta_mensual).toLocaleString("es-MX")}
                  </span>
                </div>
              )}
              {adicionales.map((a) => (
                <div className="contrato-row" key={a.id}>
                  <span className="modal-label">
                    Adicional: {a.concepto}
                    {(a.cantidad || 1) > 1 ? ` (x${a.cantidad})` : ""}
                  </span>
                  <span className="modal-val">
                    {Number(a.monto) > 0 ? `$${conIva(a.concepto, Number(a.monto)).toLocaleString("es-MX")}` : "Incluida"}
                  </span>
                </div>
              ))}
              {contrato.renta_mensual != null && totalMensualAdicionales > 0 && contrato.forma_pago !== "adelantado" && (
                <div className="contrato-row">
                  <span className="modal-label" style={{ fontWeight: 700, color: "#0d1b3e" }}>
                    Total por pagar al mes
                  </span>
                  <span className="modal-val" style={{ fontWeight: 700 }}>
                    $
                    {(Number(contrato.renta_mensual) + totalMensualAdicionales).toLocaleString("es-MX", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {contrato.horas_sala_juntas != null && contrato.horas_sala_juntas > 0 && (
                <div className="contrato-row">
                  <span className="modal-label">Horas sala de juntas</span>
                  <span className="modal-val">{contrato.horas_sala_juntas}h / mes</span>
                </div>
              )}
              {contrato.forma_pago === "mensual" ? (
                <div className="contrato-row">
                  <span className="modal-label">Fecha de pago</span>
                  <span className="modal-val">Del 1 al {DIA_LIMITE_PAGO_MENSUAL} de cada mes</span>
                </div>
              ) : (
                contrato.dia_pago != null && (
                  <div className="contrato-row">
                    <span className="modal-label">Día de pago</span>
                    <span className="modal-val">Día {contrato.dia_pago} de cada mes</span>
                  </div>
                )
              )}
              <div className="contrato-row">
                <span className="modal-label">Estatus</span>
                <span
                  className="factura-badge"
                  style={{
                    background: contrato.estatus === "vigente" ? "#E1F5EE" : "#FAEEDA",
                  }}
                >
                  <span
                    className="factura-badge-text"
                    style={{ color: contrato.estatus === "vigente" ? "#0F6E56" : "#854F0B" }}
                  >
                    {contrato.estatus === "vigente"
                      ? "✓ Vigente"
                      : (contrato.estatus || "").toUpperCase()}
                  </span>
                </span>
              </div>
              {contrato.deposito_garantia != null && contrato.deposito_garantia > 0 && (
                <div className="contrato-row">
                  <span className="modal-label">Depósito en garantía</span>
                  <span
                    className="factura-badge"
                    style={{ background: depositoPagado ? "#E1F5EE" : "#FAEEDA" }}
                  >
                    <span
                      className="factura-badge-text"
                      style={{ color: depositoPagado ? "#0F6E56" : "#854F0B" }}
                    >
                      {depositoPagado ? "✓ Entregado" : "⏳ Pendiente"}
                    </span>
                  </span>
                </div>
              )}
            </div>

            <p className="panel-section-label">Renovar o ampliar</p>
            <div className="contrato-card">
              <p style={{ fontSize: 13, color: "#666", margin: "0 0 10px" }}>
                ¿Quieres renovar tu contrato, más horas de sala o cambiar de espacio? Mándale la solicitud al equipo del
                centro y te contactarán.
              </p>
              <button
                className="reservar-btn"
                onClick={() => {
                  setSolicitudEnviada(false);
                  setErrorSolicitud("");
                  setMostrarSolicitud(true);
                }}
              >
                Hacer una solicitud
              </button>
              {misSolicitudes.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {misSolicitudes.map((s) => (
                    <div className="contrato-row" key={s.id}>
                      <span className="modal-label">
                        {ETIQUETA_SOLICITUD[s.tipo] || s.tipo} · {formatFecha(s.created_at)}
                      </span>
                      <span
                        className="factura-badge"
                        style={{ background: s.estado === "atendida" ? "#E1F5EE" : "#FAEEDA" }}
                      >
                        <span
                          className="factura-badge-text"
                          style={{ color: s.estado === "atendida" ? "#0F6E56" : "#854F0B" }}
                        >
                          {s.estado === "atendida" ? "✓ Atendida" : "⏳ Pendiente"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {mostrarSolicitud && (
              <div className="modal-overlay" onClick={() => !enviandoSolicitud && setMostrarSolicitud(false)}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  {solicitudEnviada ? (
                    <>
                      <p className="modal-nombre">¡Solicitud enviada!</p>
                      <p className="modal-email">
                        El equipo de tu centro ya la recibió y te contactará pronto para darle seguimiento.
                      </p>
                      <button className="reservar-btn" style={{ marginTop: 10 }} onClick={() => setMostrarSolicitud(false)}>
                        Listo
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="modal-nombre">Hacer una solicitud</p>
                      <p className="sub-label">¿Qué necesitas?</p>
                      <select value={tipoSolicitud} onChange={(e) => setTipoSolicitud(e.target.value)}>
                        {Object.entries(ETIQUETA_SOLICITUD).map(([valor, texto]) => (
                          <option key={valor} value={valor}>
                            {texto}
                          </option>
                        ))}
                      </select>
                      <p className="sub-label" style={{ marginTop: 8 }}>
                        Cuéntanos más (opcional)
                      </p>
                      <textarea
                        placeholder="Ej. Quiero renovar por 6 meses / necesito 4 horas más de sala al mes"
                        value={mensajeSolicitud}
                        onChange={(e) => setMensajeSolicitud(e.target.value)}
                      />
                      {errorSolicitud && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorSolicitud}</p>}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button className="tel-borrar-btn" onClick={() => setMostrarSolicitud(false)} disabled={enviandoSolicitud}>
                          Cancelar
                        </button>
                        <button className="reservar-btn" onClick={enviarSolicitud} disabled={enviandoSolicitud}>
                          {enviandoSolicitud ? "Enviando..." : "Enviar solicitud"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="tiempo-card">
              <p className="tiempo-label">Tiempo restante del contrato</p>
              <p className="tiempo-val">{mesesRestantes} meses</p>
              <div className="tiempo-progress-bar">
                <div className="tiempo-progress-fill" style={{ width: `${porcentaje}%` }} />
              </div>
              <p className="tiempo-sub">Vence el {formatFecha(contrato.fecha_vencimiento)}</p>
            </div>

            <p className="panel-section-label">Documento</p>
            {contrato.archivo_url ? (
              <button
                type="button"
                className="doc-row"
                style={{ border: "none", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
                onClick={abrirContrato}
                disabled={abriendoContrato}
              >
                <div className="doc-icono">
                  <img src="/icons/contrato.png" alt="" className="icon-img-24" />
                </div>
                <div className="doc-info">
                  <p className="doc-nombre">Contrato de Arrendamiento</p>
                  <p className="doc-fecha">Firmado el {formatFecha(contrato.fecha_inicio)}</p>
                </div>
                <div className="doc-download-btn">{abriendoContrato ? "…" : "👁️"}</div>
              </button>
            ) : (
              <div className="doc-row">
                <div className="doc-icono">
                  <img src="/icons/contrato.png" alt="" className="icon-img-24" />
                </div>
                <div className="doc-info">
                  <p className="doc-nombre">Contrato de Arrendamiento</p>
                  <p className="doc-fecha-pendiente">⏳ PDF pendiente de carga</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
