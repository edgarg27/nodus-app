"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

type Pago = {
  id: string;
  clabe: string | null;
  banco: string | null;
  referencia: string | null;
  fecha_limite: string | null;
  monto: number;
  estado: string;
};

function PagarSpeiInner() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const facturaId = params.get("facturaId") || "";
  const folio = params.get("folio") || "";

  const [loading, setLoading] = useState(true);
  const [pago, setPago] = useState<Pago | null>(null);
  const [error, setError] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const confettiSpei = useMemo(() => {
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
    generar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generar() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/generar-spei", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturaId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo generar la ficha de pago");
      } else {
        setPago(data.pago);
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setLoading(false);
  }

  async function verificar() {
    if (!pago) return;
    setVerificando(true);
    try {
      const res = await fetch("/api/verificar-spei", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoId: pago.id }),
      });
      const data = await res.json();
      if (data.estado === "pagado") {
        setPago({ ...pago, estado: "pagado" });
      } else {
        setError("Todavía no vemos tu transferencia reflejada. Si acabas de pagar, espera unos minutos e inténtalo de nuevo.");
      }
    } catch {
      setError("No se pudo verificar. Intenta de nuevo.");
    }
    setVerificando(false);
  }

  function copiarClabe() {
    if (!pago?.clabe) return;
    navigator.clipboard.writeText(pago.clabe);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (pago?.estado === "pagado") {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Pago confirmado</p>
        </div>
        <div className="sub-content">
          <div className="exito-card">
            <div className="confetti">
              {confettiSpei.map((c) => (
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
            <p className="exito-titulo">¡Tu pago quedó confirmado!</p>
            <p className="exito-mensaje">La factura {folio} ya está marcada como pagada.</p>
            <button className="exito-btn" onClick={() => router.push("/estado-cuenta")}>
              Volver a Estado de Cuenta
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/estado-cuenta">
          ← Regresar
        </a>
        <p className="rep-title">Pagar por SPEI</p>
        <p className="rep-sub">Factura {folio}</p>
      </div>

      <div className="sub-content">
        {loading ? (
          <p style={{ color: "#888", fontSize: 13 }}>Generando tu ficha de pago...</p>
        ) : error && !pago ? (
          <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>
        ) : pago ? (
          <>
            <div className="spei-card">
              <p className="spei-monto">${Number(pago.monto).toLocaleString("es-MX")}</p>
              <div className="spei-row">
                <span className="spei-label">Banco</span>
                <span className="spei-val">{pago.banco || "—"}</span>
              </div>
              <div className="spei-row">
                <span className="spei-label">CLABE</span>
                <span className="spei-val">
                  {pago.clabe || "—"}
                  {pago.clabe && (
                    <button className="spei-copiar" onClick={copiarClabe} type="button">
                      {copiado ? "✓ Copiado" : "Copiar"}
                    </button>
                  )}
                </span>
              </div>
              {pago.referencia && (
                <div className="spei-row">
                  <span className="spei-label">Referencia</span>
                  <span className="spei-val">{pago.referencia}</span>
                </div>
              )}
              {pago.fecha_limite && (
                <div className="spei-row">
                  <span className="spei-label">Vigente hasta</span>
                  <span className="spei-val">
                    {new Date(pago.fecha_limite).toLocaleString("es-MX")}
                  </span>
                </div>
              )}
            </div>

            <div className="nota-info">
              Haz una transferencia SPEI desde tu banco a esta CLABE, por el monto exacto. En
              cuanto tu banco confirme el depósito, tu factura se marca como pagada
              automáticamente.
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={verificar} disabled={verificando}>
              {verificando ? "Verificando..." : "🔄 Ya transferí, verificar"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function PagarSpeiPage() {
  return (
    <Suspense fallback={null}>
      <PagarSpeiInner />
    </Suspense>
  );
}
