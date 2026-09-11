"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

// Mismo concepto exacto que genera ContratoModal.tsx → aprobar() al crear
// el pago del depósito (incluye IVA, ver ese archivo) — es el único filtro
// que distingue estos pagos de la renta/adicionales en la tabla `pagos`.
const CONCEPTO_DEPOSITO = "Depósito en garantía (incl. IVA)";

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  pagado: { label: "✓ Realizado", bg: "#E1F5EE", color: "#0F6E56" },
};

type Deposito = {
  id: string;
  user_id: string | null;
  monto: number;
  contrato_id: string | null;
  centro: string;
  estado: string;
  created_at: string;
  cliente_nombre?: string;
  cliente_empresa?: string | null;
};

export default function DepositoGarantiaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchDepositos(centro);
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

  async function fetchDepositos(c: string) {
    setLoading(true);
    const { data: pgs } = await supabase
      .from("pagos")
      .select("id, user_id, monto, contrato_id, centro, estado, created_at")
      .eq("centro", c)
      .eq("concepto", CONCEPTO_DEPOSITO)
      .order("created_at", { ascending: false });

    const userIds = Array.from(new Set((pgs || []).map((p) => p.user_id).filter((id): id is string => !!id)));
    const nombrePorId: Record<string, string> = {};
    const empresaPorId: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: clis } = await supabase.from("profiles").select("id, nombre, empresa").in("id", userIds);
      (clis || []).forEach((cl) => {
        nombrePorId[cl.id] = cl.nombre;
        empresaPorId[cl.id] = cl.empresa;
      });
    }

    setDepositos(
      (pgs || []).map((p) => ({
        ...p,
        cliente_nombre: p.user_id ? nombrePorId[p.user_id] : undefined,
        cliente_empresa: p.user_id ? empresaPorId[p.user_id] : undefined,
      }))
    );
    setLoading(false);
  }

  async function marcarPagado(id: string) {
    if (!confirm("¿Marcar este depósito en garantía como realizado?")) return;
    setProcesando(id);
    await fetch("/api/pagos/marcar-pagado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoId: id }),
    });
    setProcesando(null);
    if (centro) fetchDepositos(centro);
  }

  const depositosFiltrados = soloPendientes ? depositos.filter((d) => d.estado !== "pagado") : depositos;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Depósito en garantía</p>
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
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 8px" }}>
              El depósito en garantía se genera como su propio pago (ya con IVA) al aprobar un contrato en
              Contratos. Márcalo como realizado aquí en cuanto el cliente lo entregue.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                🔒 Depósitos ({depositosFiltrados.length})
              </p>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => setSoloPendientes((v) => !v)}
              >
                {soloPendientes ? "Ver todos" : "Ver solo pendientes"}
              </button>
            </div>

            {depositosFiltrados.length === 0 ? (
              <div className="empty-card">
                {soloPendientes ? "Sin depósitos pendientes en " + centro : "Sin depósitos registrados en " + centro}
              </div>
            ) : (
              depositosFiltrados.map((d) => {
                const badge = ESTATUS_LABEL[d.estado] || { label: d.estado || "—", bg: "#F0F0F0", color: "#555" };
                return (
                  <div className="contrato-card-admin" key={d.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {d.cliente_nombre || "Cliente"} {d.cliente_empresa ? `· ${d.cliente_empresa}` : ""}
                        </p>
                        <p className="contrato-detalle">
                          ${Number(d.monto).toLocaleString("es-MX")} (incl. IVA) ·{" "}
                          {new Date(d.created_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                      </span>
                    </div>
                    {d.estado !== "pagado" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn-aceptar" onClick={() => marcarPagado(d.id)} disabled={procesando === d.id}>
                          ✓ Marcar como realizado
                        </button>
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
