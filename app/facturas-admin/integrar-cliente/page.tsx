"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FormularioNuevaFactura from "../FormularioNuevaFactura";
import IntegrarPorCliente from "../IntegrarPorCliente";

export default function IntegrarClientePage() {
  const supabase = createClient();
  const [centro, setCentro] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [vuelta, setVuelta] = useState(0);
  // "cliente": integrar con contrato y periodo (como ZORA). "libre": factura libre o venta a público en general.
  const [modo, setModo] = useState<"cliente" | "libre">("cliente");

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
        <p className="rep-sub">Elige al cliente y el periodo, revisa lo que se le cobra y deja integrada o timbra la factura</p>
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

        {!mensaje && (
          <div className="fac-pestanas" role="tablist">
            <button role="tab" aria-selected={modo === "cliente"} className={modo === "cliente" ? "activa" : ""} onClick={() => setModo("cliente")}>
              Por cliente y periodo
            </button>
            <button role="tab" aria-selected={modo === "libre"} className={modo === "libre" ? "activa" : ""} onClick={() => setModo("libre")}>
              Factura libre / Público en general
            </button>
          </div>
        )}

        {cargando ? (
          <div className="empty-card">Cargando...</div>
        ) : !mensaje && centro ? (
          modo === "cliente" ? (
            <IntegrarPorCliente
              key={"c" + vuelta}
              centroInicial={centro}
              onIntegrada={(id) => {
                window.location.href = "/facturas-admin/estados-de-cuenta/" + id;
              }}
            />
          ) : (
            <FormularioNuevaFactura
              key={"l" + vuelta}
              centroInicial={centro}
              onCancelar={() => {
                window.location.href = "/facturas-admin";
              }}
              onListo={(m) => setMensaje(m)}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
