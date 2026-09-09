"use client";

import { useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

function SubirComprobanteInner() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const facturaId = params.get("facturaId") || "";
  const folio = params.get("folio") || "";
  const monto = params.get("monto") || "0";

  const [archivo, setArchivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [botonEnviado, setBotonEnviado] = useState(false);

  const confettiComprobante = useMemo(() => {
    if (!enviado) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enviado]);

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!archivo) {
      setError("Por favor adjunta tu comprobante de pago");
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sesión expirada, vuelve a iniciar sesión");
      setLoading(false);
      return;
    }

    const ext = archivo.name.split(".").pop() || "jpg";
    const fileName = `${user.id}/${facturaId}-${Date.now()}.${ext}`;

    let comprobanteUrl: string | null = null;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { contentType: archivo.type, upsert: true });

    if (!uploadError) {
      const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
      comprobanteUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("pagos").insert({
      factura_id: facturaId,
      user_id: user.id,
      monto: Number(monto),
      fecha_pago: new Date().toISOString().split("T")[0],
      estado: "en_revision",
      notas: "Comprobante enviado por cliente",
      comprobante_url: comprobanteUrl,
    });

    setLoading(false);

    if (insertError) {
      setError("No se pudo enviar el comprobante. Intenta de nuevo.");
      return;
    }

    setBotonEnviado(true);
    setTimeout(() => setBotonEnviado(false), 1800);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Comprobante enviado</p>
        </div>
        <div className="sub-content">
          <div className="exito-card">
            <div className="confetti">
              {confettiComprobante.map((c) => (
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
            <p className="exito-titulo">Comprobante enviado</p>
            <p className="exito-mensaje">
              Tu comprobante está en revisión. Te notificaremos cuando se confirme tu pago.
            </p>
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
        <p className="rep-title">Subir comprobante</p>
        <p className="rep-sub">
          Factura {folio} · ${Number(monto).toLocaleString("es-MX")}
        </p>
      </div>

      <div className="sub-content">
        <form className="form-card" onSubmit={handleEnviar}>
          <p className="sub-label">Adjunta tu comprobante (imagen o PDF)</p>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setArchivo(e.target.files?.[0] || null)}
          />
          {archivo && (
            <p style={{ fontSize: 12, color: "#888" }}>Seleccionado: {archivo.name}</p>
          )}
          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          <button
            className={"btn-enviar" + (loading ? " sending" : "") + (botonEnviado ? " sent" : "")}
            type="submit"
            disabled={loading}
          >
            <span className="btn-enviar-icon-wrapper">
              <svg
                className="btn-enviar-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path fill="none" d="M0 0h24v24H0z"></path>
                <path
                  fill="currentColor"
                  d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                ></path>
              </svg>
            </span>
            <span className="btn-enviar-check-wrapper">
              <svg
                className="btn-enviar-check"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>¡Listo!</span>
            </span>
            <span className="btn-enviar-text">Enviar comprobante</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SubirComprobantePage() {
  return (
    <Suspense fallback={null}>
      <SubirComprobanteInner />
    </Suspense>
  );
}
