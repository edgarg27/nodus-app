"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FormularioNuevaFactura from "../FormularioNuevaFactura";

export default function IntegrarClientePage() {
  const supabase = createClient();
  const [centro, setCentro] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: perfil } = await supabase.from("profiles").select("centro").eq("id", user.id).single();
      setCentro(perfil?.centro || "Bosques");
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Facturación
        </a>
        <p className="rep-title">Integrar por cliente</p>
        <p className="rep-sub">Elige al cliente, marca lo que se le cobra y timbra o deja integrada la factura</p>
      </div>

      <div className="rep-content rep-content-completo">
        {mensaje && (
          <div className="form-card" style={{ fontSize: 13 }}>
            <p style={{ margin: "0 0 8px" }}>{mensaje}</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600, padding: 0 }} href="/facturas-admin/estados-de-cuenta">
                Ver en Estados de cuenta
              </a>
              <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600, padding: 0 }} href="/facturas-admin/timbradas">
                Ver en Facturas timbradas
              </a>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0F6E56", fontWeight: 600, padding: 0 }}
                onClick={() => {
                  setMensaje("");
                  setVuelta((v) => v + 1);
                }}
              >
                + Integrar otra
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="empty-card">Cargando...</div>
        ) : !mensaje && centro ? (
          <FormularioNuevaFactura
            key={vuelta}
            centroInicial={centro}
            onCancelar={() => {
              window.location.href = "/facturas-admin";
            }}
            onListo={(m) => setMensaje(m)}
          />
        ) : null}
      </div>
    </div>
  );
}
