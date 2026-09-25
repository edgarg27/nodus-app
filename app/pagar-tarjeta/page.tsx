"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AceptoPolitica from "@/app/components/AceptoPolitica";
import { POLITICA_CANCELACION_VERSION } from "@/lib/politicaCancelacion";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];
const OPENPAY_JS = "https://resources.openpay.mx/lib/openpay-js/1.2.38/openpay.v1.min.js";
const OPENPAY_DATA_JS = "https://resources.openpay.mx/lib/openpay-data-js/1.2.38/openpay-data.v1.min.js";

declare global {
  interface Window {
    OpenPay?: any;
  }
}

function cargarScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.body.appendChild(s);
  });
}

type Detalle = { titulo: string; monto: number; pagado: boolean };
type TarjetaGuardada = { id: string; marca: string | null; ultimos4: string | null; vence_mes: string | null; vence_anio: string | null };

const etiquetaMarca = (m: string | null) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : "Tarjeta");

// Pago con tarjeta con Openpay. La tarjeta se convierte en un token en el
// navegador (Openpay.js) y solo ese token llega a Nodus: nunca guardamos ni
// vemos el número. Si el banco pide verificación (3D Secure) se manda al cliente
// a su banco y regresa aquí con ?retorno=1.
function PagarTarjetaInner() {
  const supabase = createClient();
  const params = useSearchParams();
  const pagoId = params.get("pagoId") || "";
  const facturaId = params.get("facturaId") || "";
  const retorno = params.get("retorno") === "1";

  const merchantId = process.env.NEXT_PUBLIC_OPENPAY_MERCHANT_ID || "";
  const publicKey = process.env.NEXT_PUBLIC_OPENPAY_PUBLIC_KEY || "";
  const sandbox = process.env.NEXT_PUBLIC_OPENPAY_SANDBOX !== "false";
  const configurado = !!merchantId && !!publicKey;

  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [titular, setTitular] = useState("");
  const [numero, setNumero] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [cvv, setCvv] = useState("");
  const [aceptaPolitica, setAceptaPolitica] = useState(false);
  // Tarjetas que el cliente ya guardó (Mis tarjetas): puede pagar con una sin capturarla de nuevo.
  const [tarjetas, setTarjetas] = useState<TarjetaGuardada[]>([]);
  const [tarjetaSel, setTarjetaSel] = useState("");
  const [usarOtra, setUsarOtra] = useState(false);
  const deviceRef = useRef("");

  const confetti = useMemo(() => {
    if (!detalle?.pagado) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
  }, [detalle?.pagado]);

  useEffect(() => {
    cargarDetalle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarDetalle() {
    setCargando(true);
    if (pagoId) {
      const { data } = await supabase.from("pagos").select("monto, concepto, estado").eq("id", pagoId).maybeSingle();
      if (data) setDetalle({ titulo: data.concepto || "Pago", monto: Number(data.monto), pagado: data.estado === "pagado" });
    } else if (facturaId) {
      const { data } = await supabase.from("facturas").select("folio, concepto, monto, estado").eq("id", facturaId).maybeSingle();
      if (data) setDetalle({ titulo: `${data.folio} · ${data.concepto}`, monto: Number(data.monto), pagado: data.estado === "pagada" });
    }
    // Solo las tarjetas de quien paga (el personal puede leer todas por soporte).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: guardadas } = await supabase
      .from("tarjetas_guardadas")
      .select("id, marca, ultimos4, vence_mes, vence_anio")
      .eq("user_id", user?.id || "")
      .eq("activa", true)
      .order("created_at", { ascending: false });
    const lista = (guardadas as TarjetaGuardada[]) || [];
    setTarjetas(lista);
    if (lista.length > 0) setTarjetaSel(lista[0].id);
    setCargando(false);
  }

  // Regreso del 3D Secure: se confirma con Openpay si el cargo se completó.
  useEffect(() => {
    if (!retorno || cargando || !detalle || detalle.pagado) return;
    (async () => {
      setVerificando(true);
      try {
        const res = await fetch("/api/pagos/verificar-tarjeta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pagoId: pagoId || undefined, facturaId: facturaId || undefined }),
        });
        const data = await res.json();
        if (res.ok && data.estado === "pagado") setDetalle((d) => (d ? { ...d, pagado: true } : d));
        else setError(data.error || "El banco no confirmó el pago. Si te cobraron, avisa al centro; si no, inténtalo de nuevo.");
      } catch {
        setError("No se pudo verificar el pago. Revisa tu estado de cuenta en unos minutos.");
      }
      setVerificando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retorno, cargando, detalle?.pagado]);

  // Carga Openpay.js y su huella antifraude cuando el formulario ya está en pantalla.
  const usandoGuardada = tarjetas.length > 0 && !usarOtra;
  const formVisible = configurado && !!detalle && !detalle.pagado && !retorno && !usandoGuardada;
  useEffect(() => {
    if (!formVisible) return;
    let cancelado = false;
    (async () => {
      try {
        await cargarScript(OPENPAY_JS);
        await cargarScript(OPENPAY_DATA_JS);
        if (cancelado || !window.OpenPay) return;
        window.OpenPay.setId(merchantId);
        window.OpenPay.setApiKey(publicKey);
        window.OpenPay.setSandboxMode(sandbox);
        deviceRef.current = window.OpenPay.deviceData.setup("form-tarjeta", "device_session_id");
        setListo(true);
      } catch {
        setError("No se pudo cargar el pago seguro. Revisa tu conexión e inténtalo de nuevo.");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [formVisible, merchantId, publicKey, sandbox]);

  // Pago con una tarjeta guardada: el cobro lo hace el servidor con la tarjeta de Openpay.
  async function pagarGuardada() {
    setError("");
    if (!aceptaPolitica) return setError("Para pagar, acepta la política de cancelación y reembolsos");
    if (!tarjetaSel) return setError("Elige una tarjeta");
    setProcesando(true);
    try {
      const res = await fetch("/api/pagos/pagar-tarjeta-guardada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pagoId: pagoId || undefined,
          facturaId: facturaId || undefined,
          tarjetaId: tarjetaSel,
          politicaVersion: POLITICA_CANCELACION_VERSION,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "No se pudo procesar el pago");
      else if (data.estado === "pagado") setDetalle((d) => (d ? { ...d, pagado: true } : d));
      else setError("Tu pago está en proceso. Revisa tu estado de cuenta en unos minutos.");
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setProcesando(false);
  }

  function pagar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const OP = window.OpenPay;
    if (!OP) return;
    if (!aceptaPolitica) return setError("Para pagar, acepta la política de cancelación y reembolsos");
    const num = numero.replace(/\s+/g, "");
    if (!titular.trim()) return setError("Escribe el nombre como aparece en la tarjeta");
    if (!OP.card.validateCardNumber(num)) return setError("El número de la tarjeta no es válido");
    if (!OP.card.validateExpiry(mes, anio)) return setError("La fecha de vencimiento no es válida");
    if (!OP.card.validateCVC(cvv, num)) return setError("El código de seguridad no es válido");

    setProcesando(true);
    OP.token.create(
      { card_number: num, holder_name: titular.trim(), expiration_year: anio, expiration_month: mes, cvv2: cvv },
      async (respuesta: any) => {
        // El número y el CVV ya no se necesitan: se borran del formulario.
        setNumero("");
        setCvv("");
        try {
          const res = await fetch("/api/pagos/pagar-tarjeta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pagoId: pagoId || undefined,
              facturaId: facturaId || undefined,
              tokenId: respuesta.data.id,
              deviceSessionId: deviceRef.current,
              politicaVersion: POLITICA_CANCELACION_VERSION,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "No se pudo procesar el pago");
          } else if (data.redirect) {
            window.location.href = data.redirect; // verificación 3D Secure con su banco
            return;
          } else if (data.estado === "pagado") {
            setDetalle((d) => (d ? { ...d, pagado: true } : d));
          } else {
            setError("Tu pago está en proceso. Revisa tu estado de cuenta en unos minutos.");
          }
        } catch {
          setError("No se pudo conectar. Intenta de nuevo.");
        }
        setProcesando(false);
      },
      (falla: any) => {
        setError(falla?.data?.description || "No se pudo validar la tarjeta. Revísala e inténtalo de nuevo.");
        setProcesando(false);
      }
    );
  }

  if (cargando) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="nodus-inline-loading">
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!detalle) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="empty-card">No encontramos ese pago.</div>
          <a className="exito-btn" href="/estado-cuenta">
            Volver a mi estado de cuenta
          </a>
        </div>
      </div>
    );
  }

  const estiloCampo = { width: "100%", border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 15 } as const;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/estado-cuenta">
          ← Regresar
        </a>
        <p className="rep-title">Pagar con tarjeta</p>
      </div>
      <div className="sub-content">
        {detalle.pagado ? (
          <div className="exito-card">
            <div className="confetti">
              {confetti.map((c) => (
                <span
                  key={c.id}
                  className="confetti-pieza"
                  style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.duracion}s` }}
                />
              ))}
            </div>
            <div className="exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="exito-titulo">Pago confirmado</p>
            <p className="exito-mensaje">Gracias, tu pago ya quedó registrado.</p>
            <a className="exito-btn" href="/estado-cuenta">
              Volver a mi estado de cuenta
            </a>
          </div>
        ) : (
          <>
            <div className="resumen-reserva-card">
              <p className="resumen-reserva-title">💰 Detalle del pago</p>
              <div className="resumen-reserva-row">
                <span className="resumen-reserva-label">Concepto</span>
                <span className="resumen-reserva-val">{detalle.titulo}</span>
              </div>
              <div className="resumen-reserva-row" style={{ fontWeight: 700 }}>
                <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                  Monto
                </span>
                <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                  ${detalle.monto.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {retorno ? (
              <p style={{ fontSize: 14, color: "#555" }}>{verificando ? "Confirmando tu pago con el banco…" : ""}</p>
            ) : usandoGuardada ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                <p className="sub-label">Paga con una de tus tarjetas</p>
                {tarjetas.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      border: `1px solid ${tarjetaSel === t.id ? "#f07e3a" : "#eee"}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <input type="radio" name="tarjeta" checked={tarjetaSel === t.id} onChange={() => setTarjetaSel(t.id)} />
                    <span style={{ fontSize: 15 }}>
                      💳 {etiquetaMarca(t.marca)} ···· {t.ultimos4 || "****"}
                    </span>
                    {t.vence_mes && t.vence_anio && (
                      <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>
                        vence {t.vence_mes}/{String(t.vence_anio).slice(-2)}
                      </span>
                    )}
                  </label>
                ))}
                <AceptoPolitica acepto={aceptaPolitica} onChange={setAceptaPolitica} deshabilitado={procesando} />
                {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}
                <button className="reservar-btn" type="button" onClick={pagarGuardada} disabled={procesando || !tarjetaSel || !aceptaPolitica}>
                  {procesando ? "Procesando…" : `Pagar $${detalle.monto.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`}
                </button>
                <button
                  type="button"
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  disabled={procesando}
                  onClick={() => {
                    setError("");
                    setUsarOtra(true);
                  }}
                >
                  Usar otra tarjeta
                </button>
              </div>
            ) : !configurado ? (
              <div className="nota-info">
                El pago con tarjeta todavía no está disponible. Puedes pagar por transferencia SPEI desde tu estado de cuenta.
              </div>
            ) : (
              <form id="form-tarjeta" onSubmit={pagar} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                <div>
                  <p className="sub-label">Nombre en la tarjeta</p>
                  <input style={estiloCampo} value={titular} onChange={(e) => setTitular(e.target.value)} autoComplete="cc-name" />
                </div>
                <div>
                  <p className="sub-label">Número de la tarjeta</p>
                  <input
                    style={estiloCampo}
                    value={numero}
                    onChange={(e) => setNumero(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    placeholder="0000 0000 0000 0000"
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <p className="sub-label">Mes</p>
                    <input
                      style={estiloCampo}
                      value={mes}
                      onChange={(e) => setMes(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      inputMode="numeric"
                      autoComplete="cc-exp-month"
                      placeholder="MM"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p className="sub-label">Año</p>
                    <input
                      style={estiloCampo}
                      value={anio}
                      onChange={(e) => setAnio(e.target.value.replace(/\D/g, "").slice(0, 2))}
                      inputMode="numeric"
                      autoComplete="cc-exp-year"
                      placeholder="AA"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p className="sub-label">CVV</p>
                    <input
                      style={estiloCampo}
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      type="password"
                      placeholder="•••"
                    />
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                  🔒 Pago seguro con Openpay. Nodus no guarda ni ve el número de tu tarjeta. Tu banco puede pedirte una verificación.
                </p>
                {tarjetas.length > 0 && (
                  <button
                    type="button"
                    className="tel-borrar-btn"
                    style={{ color: "#0d1b3e", fontWeight: 600, alignSelf: "flex-start" }}
                    disabled={procesando}
                    onClick={() => {
                      setError("");
                      setUsarOtra(false);
                    }}
                  >
                    ← Usar una tarjeta guardada
                  </button>
                )}
                <AceptoPolitica acepto={aceptaPolitica} onChange={setAceptaPolitica} deshabilitado={procesando} />
                {sandbox && (
                  <p style={{ fontSize: 12, color: "#a3701f", margin: 0 }}>Modo de pruebas: no se cobra dinero real.</p>
                )}
                {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}
                <button className="reservar-btn" type="submit" disabled={!listo || procesando || !aceptaPolitica}>
                  {procesando ? "Procesando…" : `Pagar $${detalle.monto.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`}
                </button>
              </form>
            )}
            {(retorno || !configurado) && error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
            {retorno && !verificando && !detalle.pagado && (
              <a className="pagar-btn-full" href={pagoId ? `/pagar-tarjeta?pagoId=${pagoId}` : `/pagar-tarjeta?facturaId=${facturaId}`}>
                Intentar de nuevo
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function PagarTarjetaPage() {
  return (
    <Suspense fallback={null}>
      <PagarTarjetaInner />
    </Suspense>
  );
}
