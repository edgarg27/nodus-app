"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { configOpenpay, prepararOpenpay } from "@/lib/openpayBrowser";
import { CONSENTIMIENTO_COBROS_TEXTO } from "@/lib/consentimientoCobros";

type Tarjeta = {
  id: string;
  marca: string | null;
  ultimos4: string | null;
  vence_mes: string | null;
  vence_anio: string | null;
  titular: string | null;
  cobro_automatico: boolean;
};

const etiquetaMarca = (m: string | null) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : "Tarjeta");

// Tarjetas guardadas del cliente y su cobro automático. La tarjeta se guarda en
// Openpay (Nodus no ve el número); aquí solo se ven la marca y los últimos 4.
export default function MisTarjetasPage() {
  const supabase = createClient();
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Activar cobro automático en una tarjeta que ya existe: pide aceptar la autorización.
  const [activando, setActivando] = useState<string | null>(null);
  const [aceptaActivar, setAceptaActivar] = useState(false);

  // Agregar tarjeta
  const [mostrarForm, setMostrarForm] = useState(false);
  const [titular, setTitular] = useState("");
  const [numero, setNumero] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [cvv, setCvv] = useState("");
  const [conAutopago, setConAutopago] = useState(false);
  const [aceptaNueva, setAceptaNueva] = useState(false);
  const [listo, setListo] = useState(false);
  const opRef = useRef<{ OP: any; deviceSessionId: string } | null>(null);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("tarjetas_guardadas")
      .select("id, marca, ultimos4, vence_mes, vence_anio, titular, cobro_automatico")
      .eq("activa", true)
      .order("created_at", { ascending: false });
    setTarjetas((data as Tarjeta[]) || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!mostrarForm || !configOpenpay.configurado) return;
    let cancelado = false;
    setListo(false);
    prepararOpenpay("form-nueva-tarjeta")
      .then((r) => {
        if (cancelado) return;
        opRef.current = r;
        setListo(true);
      })
      .catch(() => setError("No se pudo cargar el guardado seguro de tarjetas. Revisa tu conexión."));
    return () => {
      cancelado = true;
    };
  }, [mostrarForm]);

  async function cambiarAutopago(id: string, activar: boolean) {
    setOcupado(id);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/tarjetas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cobroAutomatico: activar, consentimiento: activar ? true : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar");
      setActivando(null);
      setAceptaActivar(false);
      setMensaje(activar ? "Cobro automático activado en esta tarjeta." : "Cobro automático desactivado.");
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar");
    }
    setOcupado(null);
  }

  async function eliminar(t: Tarjeta) {
    if (!confirm(`¿Eliminar la tarjeta terminación ${t.ultimos4}? Si tenía cobro automático, se cancela.`)) return;
    setOcupado(t.id);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/tarjetas/${t.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar");
      setMensaje("Tarjeta eliminada.");
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar");
    }
    setOcupado(null);
  }

  function guardarNueva(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    const ctx = opRef.current;
    if (!ctx) return;
    const { OP, deviceSessionId } = ctx;
    const num = numero.replace(/\s+/g, "");
    if (!titular.trim()) return setError("Escribe el nombre como aparece en la tarjeta");
    if (!OP.card.validateCardNumber(num)) return setError("El número de la tarjeta no es válido");
    if (!OP.card.validateExpiry(mes, anio)) return setError("La fecha de vencimiento no es válida");
    if (!OP.card.validateCVC(cvv, num)) return setError("El código de seguridad no es válido");
    if (conAutopago && !aceptaNueva) return setError("Para el cobro automático hay que aceptar la autorización");

    setOcupado("nueva");
    OP.token.create(
      { card_number: num, holder_name: titular.trim(), expiration_year: anio, expiration_month: mes, cvv2: cvv },
      async (respuesta: any) => {
        setNumero("");
        setCvv("");
        try {
          const res = await fetch("/api/tarjetas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenId: respuesta.data.id,
              deviceSessionId,
              cobroAutomatico: conAutopago,
              consentimiento: conAutopago ? true : undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "No se pudo guardar la tarjeta");
          setMensaje(conAutopago ? "Tarjeta guardada con cobro automático." : "Tarjeta guardada.");
          setMostrarForm(false);
          setTitular("");
          setMes("");
          setAnio("");
          setConAutopago(false);
          setAceptaNueva(false);
          await cargar();
        } catch (er: any) {
          setError(er?.message || "No se pudo guardar la tarjeta");
        }
        setOcupado(null);
      },
      (falla: any) => {
        setError(falla?.data?.description || "No se pudo validar la tarjeta. Revísala e inténtalo de nuevo.");
        setOcupado(null);
      }
    );
  }

  const estiloCampo = { width: "100%", border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 15 } as const;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/estado-cuenta">
          ← Regresar
        </a>
        <p className="rep-title">Mis tarjetas</p>
        <p className="rep-sub">Cobro automático de tu renta</p>
      </div>
      <div className="sub-content">
        <div className="nota-info">
          Con el cobro automático, cada mes cobramos tu renta a la tarjeta que elijas, sin que tengas que hacer nada. Si un
          cobro no se puede hacer, te avisamos y puedes pagar por SPEI o con otra tarjeta. Puedes cancelarlo cuando quieras.
        </div>

        {mensaje && <p style={{ color: "#0F6E56", fontSize: 13 }}>✓ {mensaje}</p>}
        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        {cargando ? (
          <div className="empty-card">Cargando…</div>
        ) : tarjetas.length === 0 ? (
          <div className="empty-card">Todavía no tienes tarjetas guardadas.</div>
        ) : (
          tarjetas.map((t) => (
            <div className="factura-card-full" key={t.id}>
              <div className="factura-top">
                <div>
                  <p className="factura-folio">
                    💳 {etiquetaMarca(t.marca)} •••• {t.ultimos4 || "----"}
                  </p>
                  <p className="factura-fecha">
                    Vence {t.vence_mes || "--"}/{t.vence_anio || "--"}
                    {t.titular ? ` · ${t.titular}` : ""}
                  </p>
                </div>
                <div className="factura-right">
                  <span className="factura-badge" style={{ background: t.cobro_automatico ? "#E1F5EE" : "#F0F0F0" }}>
                    <span className="factura-badge-text">{t.cobro_automatico ? "✓ Cobro automático" : "Sin cobro automático"}</span>
                  </span>
                </div>
              </div>

              {activando === t.id ? (
                <div style={{ marginTop: 8 }}>
                  <div className="nota-info" style={{ lineHeight: 1.5 }}>
                    {CONSENTIMIENTO_COBROS_TEXTO}
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "8px 0" }}>
                    <input type="checkbox" checked={aceptaActivar} onChange={(e) => setAceptaActivar(e.target.checked)} style={{ marginTop: 3 }} />
                    Acepto esta autorización de cobro automático
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="tel-borrar-btn" onClick={() => { setActivando(null); setAceptaActivar(false); }}>
                      Cancelar
                    </button>
                    <button className="btn-aceptar" disabled={!aceptaActivar || ocupado === t.id} onClick={() => cambiarAutopago(t.id, true)}>
                      {ocupado === t.id ? "Guardando…" : "Activar cobro automático"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {t.cobro_automatico ? (
                    <button className="tel-borrar-btn" disabled={ocupado === t.id} onClick={() => cambiarAutopago(t.id, false)}>
                      Desactivar cobro automático
                    </button>
                  ) : (
                    <button className="btn-aceptar" disabled={ocupado === t.id} onClick={() => { setActivando(t.id); setAceptaActivar(false); }}>
                      Activar cobro automático
                    </button>
                  )}
                  <button className="tel-borrar-btn" style={{ color: "#A32D2D" }} disabled={ocupado === t.id} onClick={() => eliminar(t)}>
                    🗑 Eliminar
                  </button>
                </div>
              )}
            </div>
          ))
        )}

        {!configOpenpay.configurado ? (
          <div className="nota-info">El guardado de tarjetas todavía no está disponible.</div>
        ) : !mostrarForm ? (
          <button className="reservar-btn" onClick={() => setMostrarForm(true)}>
            + Agregar tarjeta
          </button>
        ) : (
          <form id="form-nueva-tarjeta" onSubmit={guardarNueva} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="panel-section-label">Agregar tarjeta</p>
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
                <input style={estiloCampo} value={mes} onChange={(e) => setMes(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="MM" />
              </div>
              <div style={{ flex: 1 }}>
                <p className="sub-label">Año</p>
                <input style={estiloCampo} value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="AA" />
              </div>
              <div style={{ flex: 1 }}>
                <p className="sub-label">CVV</p>
                <input style={estiloCampo} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" placeholder="•••" />
              </div>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
              <input type="checkbox" checked={conAutopago} onChange={(e) => setConAutopago(e.target.checked)} style={{ marginTop: 3 }} />
              Usar esta tarjeta para el cobro automático de mi renta
            </label>
            {conAutopago && (
              <>
                <div className="nota-info" style={{ lineHeight: 1.5 }}>
                  {CONSENTIMIENTO_COBROS_TEXTO}
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <input type="checkbox" checked={aceptaNueva} onChange={(e) => setAceptaNueva(e.target.checked)} style={{ marginTop: 3 }} />
                  Acepto esta autorización de cobro automático
                </label>
              </>
            )}
            <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
              🔒 Tu tarjeta se guarda de forma segura en Openpay. Nodus no guarda ni ve el número.
              {configOpenpay.sandbox ? " Modo de pruebas: no se cobra dinero real." : ""}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setMostrarForm(false)}>
                Cancelar
              </button>
              <button className="btn-aceptar" type="submit" disabled={!listo || ocupado === "nueva"}>
                {ocupado === "nueva" ? "Guardando…" : "Guardar tarjeta"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
