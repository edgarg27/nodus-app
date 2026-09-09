"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Contrato = {
  id: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estatus: string | null;
  archivo_url: string | null;
  renta_mensual: number | null;
  horas_sala_juntas: number | null;
};

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
    setLoading(false);
  }

  function calcularInfo() {
    if (!contrato) return { mesesRestantes: 0, porcentaje: 0 };
    const hoy = new Date();
    const inicio = new Date(contrato.fecha_inicio);
    const fin = new Date(contrato.fecha_vencimiento);
    const totalDias = (fin.getTime() - inicio.getTime()) / 86400000;
    const diasTranscurridos = (hoy.getTime() - inicio.getTime()) / 86400000;
    const porcentaje = Math.min(Math.max((diasTranscurridos / totalDias) * 100, 0), 100);
    const mesesRestantes = Math.max(Math.ceil((fin.getTime() - hoy.getTime()) / (86400000 * 30)), 0);
    return { mesesRestantes, porcentaje };
  }

  const { mesesRestantes, porcentaje } = calcularInfo();

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
              {contrato.horas_sala_juntas != null && contrato.horas_sala_juntas > 0 && (
                <div className="contrato-row">
                  <span className="modal-label">Horas sala de juntas</span>
                  <span className="modal-val">{contrato.horas_sala_juntas}h / mes</span>
                </div>
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
            </div>

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
              <a className="doc-row" href={contrato.archivo_url} target="_blank">
                <div className="doc-icono">
                  <img src="/icons/contrato.png" alt="" className="icon-img-24" />
                </div>
                <div className="doc-info">
                  <p className="doc-nombre">Contrato de Arrendamiento</p>
                  <p className="doc-fecha">Firmado el {formatFecha(contrato.fecha_inicio)}</p>
                </div>
                <div className="doc-download-btn">👁️</div>
              </a>
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
