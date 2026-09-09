"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "qrcode";

type DayPassPublico = {
  folio: number;
  tipo: "coworking" | "oficina_privada";
  centro: string;
  nombre: string;
  fecha: string;
  emitido_por_nombre: string | null;
};

export default function DayPassPublicoPage() {
  const params = useParams();
  const id = String(params.id);

  const [pase, setPase] = useState<DayPassPublico | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");

  useEffect(() => {
    fetch(`/api/day-pass/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPase(data);
      })
      .catch(() => setError("No se pudo cargar el Day Pass"))
      .finally(() => setLoading(false));
  }, [id]);

  // El QR manda a la pantalla de check-in (requiere que el admin inicie
  // sesión) — ahí es donde acepta la llegada del invitado, no a esta
  // misma página pública.
  useEffect(() => {
    if (!pase) return;
    const link = `${window.location.origin}/day-pass/${id}/checkin`;
    QRCode.toDataURL(link, { margin: 0, width: 200 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [pase, id]);

  if (loading) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando tu Day Pass...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!pase) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="empty-card">{error || "Day Pass no encontrado"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">Tu Day Pass</p>
        <p className="rep-sub">Muéstralo en recepción al llegar</p>
      </div>
      <div className="sub-content">
        <div className="daypass-ticket-wrap">
          <div className="daypass-ticket-3d">
            <div className="daypass-ticket daypass-ticket-imprimible">
              <div className="daypass-main">
                <div className="daypass-content">
                  <div className="daypass-header">
                    <div className="daypass-brand-wrap">
                      <img src="/images/nodus-icon.png" className="daypass-brand-icon" alt="" />
                      <div>
                        <div className="daypass-brand">NODUS</div>
                        <div className="daypass-brand-sub">Flex Center</div>
                      </div>
                    </div>
                    <span className="daypass-type-badge">
                      {pase.tipo === "coworking" ? "Coworking" : "Oficina privada"}
                    </span>
                  </div>
                  <p className="daypass-title">Day Pass</p>
                  <p className="daypass-subtitle">
                    Disfruta de trabajar un día en{" "}
                    {pase.tipo === "coworking" ? "nuestro coworking" : "tu oficina privada"}
                  </p>
                  <div className="daypass-details">
                    <div className="daypass-detail-item">
                      <span className="daypass-label">Nombre</span>
                      <span className="daypass-value">{pase.nombre}</span>
                    </div>
                    <div className="daypass-detail-item">
                      <span className="daypass-label">Fecha</span>
                      <span className="daypass-value">{pase.fecha}</span>
                    </div>
                    <div className="daypass-detail-item">
                      <span className="daypass-label">Centro</span>
                      <span className="daypass-value">{pase.centro}</span>
                    </div>
                    <div className="daypass-detail-item">
                      <span className="daypass-label">Emite</span>
                      <span className="daypass-value">{pase.emitido_por_nombre || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="daypass-perforation" />

              <div className="daypass-stub">
                <div className="daypass-barcode-wrap">
                  {qr ? (
                    <img src={qr} className="daypass-qr" alt="Código QR del Day Pass" />
                  ) : (
                    <div className="daypass-barcode" />
                  )}
                  <p className="daypass-barcode-id">NODUS-{String(pase.folio).padStart(3, "0")}</p>
                </div>
                <div className="daypass-admit">
                  <p className="daypass-admit-label">Folio</p>
                  <p className="daypass-admit-num">{String(pase.folio).padStart(3, "0")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button className="reservar-btn" onClick={() => window.print()} style={{ marginTop: 16 }}>
          🖨 Guardar / Imprimir
        </button>
      </div>
    </div>
  );
}
