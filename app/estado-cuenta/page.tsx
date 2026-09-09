"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factura = {
  id: string;
  folio: string;
  concepto: string;
  monto: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string;
  archivo_url: string | null;
};

// Pagos sin factura_id (renta/depósito/adicionales del flujo simulado de
// Cotizar/Contratos) — se excluyen los que SÍ tienen factura_id porque
// esos ya están cubiertos por el estado de su factura; sumarlos aparte
// duplicaría el monto adeudado/pagado.
type Pago = {
  id: string;
  monto: number;
  concepto: string | null;
  estado: string;
  link_pago: string | null;
  fecha_pago: string | null;
  created_at: string;
};

function formatMonto(monto: number) {
  return `$${Number(monto).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function formatFecha(fecha: string) {
  try {
    return new Date(fecha).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return fecha;
  }
}

export default function EstadoCuentaPage() {
  const supabase = createClient();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("Cliente");
  const [sub, setSub] = useState("");

  useEffect(() => {
    fetchFacturas();
  }, []);

  async function fetchFacturas() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre, numero_oficina, centro")
      .eq("id", user.id)
      .single();
    if (profile) {
      setNombre(profile.nombre || "Cliente");
      setSub(
        profile.numero_oficina ? `Oficina ${profile.numero_oficina}` : profile.centro || ""
      );
    }

    // Marcar vencidas automáticamente
    await supabase
      .from("facturas")
      .update({ estado: "vencida" })
      .eq("user_id", user.id)
      .eq("estado", "pendiente")
      .lt("fecha_vencimiento", new Date().toISOString().split("T")[0]);

    const { data } = await supabase
      .from("facturas")
      .select("*")
      .eq("user_id", user.id)
      .order("fecha_vencimiento", { ascending: false });

    setFacturas(data || []);

    const { data: pagosData } = await supabase
      .from("pagos")
      .select("id, monto, concepto, estado, link_pago, fecha_pago, created_at")
      .eq("user_id", user.id)
      .is("factura_id", null)
      .order("created_at", { ascending: false });

    setPagos(pagosData || []);
    setLoading(false);
  }

  const pendientes = facturas.filter((f) => f.estado === "pendiente");
  const vencidas = facturas.filter((f) => f.estado === "vencida");
  const pagadas = facturas.filter((f) => f.estado === "pagada");
  const pagosPendientes = pagos.filter((p) => p.estado !== "pagado");
  const pagosPagados = pagos.filter((p) => p.estado === "pagado");
  const totalPendiente =
    [...pendientes, ...vencidas].reduce((s, f) => s + Number(f.monto), 0) +
    pagosPendientes.reduce((s, p) => s + Number(p.monto), 0);
  const totalPagado =
    pagadas.reduce((s, f) => s + Number(f.monto), 0) + pagosPagados.reduce((s, p) => s + Number(p.monto), 0);

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Estado de Cuenta</p>
        <p className="rep-sub">
          {nombre} {sub ? `· ${sub}` : ""}
        </p>
      </div>

      <div className="sub-content">
        <div className="resumen-principal">
          <div className="resumen-principal-item">
            <p className="resumen-principal-monto">{formatMonto(totalPendiente)}</p>
            <p className="resumen-principal-lbl">Por pagar</p>
          </div>
          <div className="resumen-principal-divider" />
          <div className="resumen-principal-item">
            <p className="resumen-principal-monto verde">{formatMonto(totalPagado)}</p>
            <p className="resumen-principal-lbl">Pagado</p>
          </div>
        </div>

        <div className="contadores-row">
          <div className="contador-card" style={{ borderLeftColor: "#854F0B" }}>
            <p className="contador-num">{pendientes.length}</p>
            <p className="contador-lbl">Pendientes</p>
          </div>
          <div className="contador-card" style={{ borderLeftColor: "#A32D2D" }}>
            <p className="contador-num">{vencidas.length}</p>
            <p className="contador-lbl">Vencidas</p>
          </div>
          <div className="contador-card" style={{ borderLeftColor: "#0F6E56" }}>
            <p className="contador-num">{pagadas.length}</p>
            <p className="contador-lbl">Pagadas</p>
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
            {vencidas.length > 0 && (
              <>
                <p className="sec-label-red">⚠️ Facturas vencidas ({vencidas.length})</p>
                {vencidas.map((f) => (
                  <div className="factura-card-full vencida" key={f.id}>
                    <div className="factura-top">
                      <div>
                        <p className="factura-folio">{f.folio}</p>
                        <p className="factura-concepto">{f.concepto}</p>
                        <p className="factura-fecha">Venció: {formatFecha(f.fecha_vencimiento)}</p>
                        {f.archivo_url && (
                          <a className="ver-pdf-btn" href={f.archivo_url} target="_blank">
                            📄 Ver factura
                          </a>
                        )}
                      </div>
                      <div className="factura-right">
                        <p className="factura-monto" style={{ color: "#A32D2D" }}>
                          {formatMonto(f.monto)}
                        </p>
                        <span className="factura-badge" style={{ background: "#FCEBEB" }}>
                          <span className="factura-badge-text">⚠️ Vencida</span>
                        </span>
                      </div>
                    </div>
                    <a
                      className="pagar-btn-full vencida"
                      href={`/pagar-spei?facturaId=${f.id}&folio=${encodeURIComponent(f.folio)}`}
                      style={{ marginBottom: 6 }}
                    >
                      🏦 Pagar por SPEI (automático)
                    </a>
                    <a
                      className="pagar-btn-full vencida"
                      href={`/subir-comprobante?facturaId=${f.id}&folio=${encodeURIComponent(
                        f.folio
                      )}&monto=${f.monto}`}
                    >
                      💳 Ya pagué, subir comprobante
                    </a>
                  </div>
                ))}
              </>
            )}

            {pendientes.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 8 }}>
                  ⏳ Facturas pendientes ({pendientes.length})
                </p>
                {pendientes.map((f) => (
                  <div className="factura-card-full" key={f.id}>
                    <div className="factura-top">
                      <div>
                        <p className="factura-folio">{f.folio}</p>
                        <p className="factura-concepto">{f.concepto}</p>
                        <p className="factura-fecha">Vence: {formatFecha(f.fecha_vencimiento)}</p>
                        {f.archivo_url && (
                          <a className="ver-pdf-btn" href={f.archivo_url} target="_blank">
                            📄 Ver factura
                          </a>
                        )}
                      </div>
                      <div className="factura-right">
                        <p className="factura-monto">{formatMonto(f.monto)}</p>
                        <span className="factura-badge" style={{ background: "#FAEEDA" }}>
                          <span className="factura-badge-text">⏳ Pendiente</span>
                        </span>
                      </div>
                    </div>
                    <a
                      className="pagar-btn-full"
                      href={`/pagar-spei?facturaId=${f.id}&folio=${encodeURIComponent(f.folio)}`}
                      style={{ marginBottom: 6 }}
                    >
                      🏦 Pagar por SPEI (automático)
                    </a>
                    <a
                      className="pagar-btn-full"
                      href={`/subir-comprobante?facturaId=${f.id}&folio=${encodeURIComponent(
                        f.folio
                      )}&monto=${f.monto}`}
                    >
                      💳 Ya pagué, subir comprobante
                    </a>
                  </div>
                ))}
              </>
            )}

            {pagosPendientes.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 8 }}>
                  💳 Otros pagos pendientes ({pagosPendientes.length})
                </p>
                {pagosPendientes.map((p) => (
                  <div className="factura-card-full" key={p.id}>
                    <div className="factura-top">
                      <div>
                        <p className="factura-folio">{p.concepto || "Pago"}</p>
                        <p className="factura-fecha">Desde {formatFecha(p.created_at)}</p>
                      </div>
                      <div className="factura-right">
                        <p className="factura-monto">{formatMonto(p.monto)}</p>
                        <span className="factura-badge" style={{ background: "#FAEEDA" }}>
                          <span className="factura-badge-text">⏳ Pendiente</span>
                        </span>
                      </div>
                    </div>
                    <a className="pagar-btn-full" href={p.link_pago || `/pagar-simulado/${p.id}`}>
                      💳 Ir a pagar
                    </a>
                  </div>
                ))}
              </>
            )}

            {pendientes.length === 0 && vencidas.length === 0 && pagosPendientes.length === 0 && (
              <div className="cli-al-corriente">
                <p className="cli-al-corriente-icon">🎉</p>
                <p className="cli-al-corriente-text">¡Estás al corriente!</p>
                <p className="cli-al-corriente-sub">No tienes pagos pendientes</p>
              </div>
            )}

            <p className="panel-section-label" style={{ marginTop: 8 }}>
              ✓ Historial de pagos ({pagadas.length + pagosPagados.length})
            </p>
            {pagadas.length === 0 && pagosPagados.length === 0 ? (
              <div className="empty-card">Sin historial aún</div>
            ) : (
              <>
                {pagadas.map((f) => (
                  <div className="historial-card" key={f.id}>
                    <div>
                      <p className="factura-folio">{f.folio}</p>
                      <p className="factura-concepto">{f.concepto}</p>
                      <p className="factura-fecha">Pagada el {formatFecha(f.fecha_emision)}</p>
                      {f.archivo_url && (
                        <a className="ver-pdf-btn" href={f.archivo_url} target="_blank">
                          📄 Ver factura
                        </a>
                      )}
                    </div>
                    <div className="factura-right">
                      <p className="factura-monto" style={{ color: "#0F6E56" }}>
                        {formatMonto(f.monto)}
                      </p>
                      <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                        <span className="factura-badge-text">✓ Pagada</span>
                      </span>
                    </div>
                  </div>
                ))}
                {pagosPagados.map((p) => (
                  <div className="historial-card" key={p.id}>
                    <div>
                      <p className="factura-folio">{p.concepto || "Pago"}</p>
                      <p className="factura-fecha">
                        Pagado el {formatFecha(p.fecha_pago || p.created_at)}
                      </p>
                    </div>
                    <div className="factura-right">
                      <p className="factura-monto" style={{ color: "#0F6E56" }}>
                        {formatMonto(p.monto)}
                      </p>
                      <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                        <span className="factura-badge-text">✓ Pagada</span>
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
