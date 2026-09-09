"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

type Pago = { id: string; monto: number; concepto: string | null; estado: string };

export default function PagarSimuladoPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const supabase = createClient();

  const [pago, setPago] = useState<Pago | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  // Esta pantalla se usa tanto desde un link de correo sin sesión como
  // desde el dashboard de un cliente logueado — el redirect tras pagar
  // solo debe aplicar en el segundo caso.
  const [tieneSesion, setTieneSesion] = useState(false);

  const confettiPago = useMemo(() => {
    if (pago?.estado !== "pagado") return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pago?.estado]);

  useEffect(() => {
    fetch(`/api/pagos/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPago(data);
      })
      .catch(() => setError("No se pudo cargar el pago"))
      .finally(() => setLoading(false));
    supabase.auth.getUser().then(({ data: { user } }) => setTieneSesion(!!user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function simularPago() {
    setConfirmando(true);
    setError("");
    try {
      const res = await fetch("/api/pagos/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo confirmar el pago");
      } else {
        setPago((prev) => (prev ? { ...prev, estado: "pagado" } : prev));
        if (tieneSesion) {
          setTimeout(() => router.push("/dashboard-cliente"), 1500);
        }
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setConfirmando(false);
  }

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
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!pago) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="empty-card">{error || "Pago no encontrado"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">Confirmar pago</p>
      </div>
      <div className="sub-content">
        {pago.estado === "pagado" ? (
          <div className="exito-card">
            <div className="confetti">
              {confettiPago.map((c) => (
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
            <p className="exito-titulo">Pago confirmado</p>
            <p className="exito-mensaje">Gracias, este pago ya quedó registrado.</p>
            {tieneSesion && (
              <a className="exito-btn" href="/dashboard-cliente">
                Volver a mi panel
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="resumen-reserva-card">
              <p className="resumen-reserva-title">💰 Detalle del pago</p>
              <div className="resumen-reserva-row">
                <span className="resumen-reserva-label">Concepto</span>
                <span className="resumen-reserva-val">{pago.concepto || "Pago"}</span>
              </div>
              <div className="resumen-reserva-row" style={{ fontWeight: 700 }}>
                <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                  Monto
                </span>
                <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                  ${Number(pago.monto).toLocaleString("es-MX")}
                </span>
              </div>
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={simularPago} disabled={confirmando}>
              {confirmando ? "Confirmando..." : "✓ Simular pago"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
