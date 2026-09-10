"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ContratoPublico = {
  id: string;
  centro: string;
  cliente_nombre_historico: string | null;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  archivo_url: string | null;
  firmado: boolean;
  firmado_at: string | null;
  estatus: string | null;
};

export default function FirmarContratoPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [contrato, setContrato] = useState<ContratoPublico | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [firmado, setFirmado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/contratos/${id}/publico`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || !data.contrato) {
          setNotFound(true);
        } else {
          setContrato(data.contrato);
          setFirmado(!!data.contrato.firmado);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function firmar() {
    setFirmando(true);
    setError("");
    try {
      const res = await fetch("/api/contratos/firmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contratoId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo registrar tu firma");
        return;
      }
      setFirmado(true);
    } finally {
      setFirmando(false);
    }
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">Firmar contrato</p>
        <p className="rep-sub">{contrato?.centro || ""}</p>
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
        ) : notFound || !contrato ? (
          <div className="empty-card">Esta liga ya no es válida.</div>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "#333" }}>
              Hola{contrato.cliente_nombre_historico ? ` ${contrato.cliente_nombre_historico}` : ""}, este es tu contrato con{" "}
              <strong>{contrato.centro}</strong>.
            </p>

            <div className="modal-row">
              <span className="modal-label">Vigencia</span>
              <span className="modal-val">
                {contrato.fecha_inicio} a {contrato.fecha_vencimiento}
              </span>
            </div>
            <div className="modal-row">
              <span className="modal-label">Renta mensual</span>
              <span className="modal-val">${Number(contrato.renta_mensual).toLocaleString("es-MX")}</span>
            </div>

            {contrato.archivo_url && (
              <a className="ver-pdf-btn" href={contrato.archivo_url} target="_blank" style={{ marginTop: 12, display: "inline-block" }}>
                📥 Revisar el documento completo
              </a>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}

            {firmado ? (
              <p style={{ color: "#0F6E56", fontSize: 14, fontWeight: 600, marginTop: 16 }}>
                ✓ Firma registrada{contrato.firmado_at ? ` el ${new Date(contrato.firmado_at).toLocaleDateString("es-MX")}` : ""}. Gracias —
                ya puedes cerrar esta página.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#555", marginTop: 16 }}>
                  Al dar clic en "Firmo y acepto" confirmas que revisaste el documento y aceptas sus términos.
                </p>
                <button className="btn-aceptar" onClick={firmar} disabled={firmando || !contrato.archivo_url}>
                  {firmando ? "Registrando..." : "✓ Firmo y acepto"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
