"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Datos de pago de un proveedor (banco, titular, CLABE, cuenta, RFC): se capturan al
// registrarlo (CentroPanel, pestaña Proveedores) o después con este botón, y Contabilidad
// los ve en cada gasto por pagar (app/gastos/page.tsx). Columnas:
// migracion_proveedores_datos_pago.sql.

export type DatosPago = {
  banco?: string | null;
  titular_cuenta?: string | null;
  clabe?: string | null;
  numero_cuenta?: string | null;
  rfc?: string | null;
};

export const DATOS_PAGO_VACIOS = { banco: "", titular_cuenta: "", clabe: "", numero_cuenta: "", rfc: "" };

export const tieneDatosPago = (p: DatosPago) => !!(p.banco || p.titular_cuenta || p.clabe || p.numero_cuenta || p.rfc);

// Valida y limpia lo capturado: null en lo vacío; la CLABE debe ser de 18 dígitos.
export function limpiarDatosPago(d: typeof DATOS_PAGO_VACIOS): { datos: DatosPago; error: string | null } {
  const clabe = d.clabe.replace(/\s+/g, "");
  if (clabe && !/^\d{18}$/.test(clabe)) return { datos: {}, error: "La CLABE debe tener 18 dígitos." };
  return {
    datos: {
      banco: d.banco.trim() || null,
      titular_cuenta: d.titular_cuenta.trim() || null,
      clabe: clabe || null,
      numero_cuenta: d.numero_cuenta.replace(/\s+/g, "") || null,
      rfc: d.rfc.trim().toUpperCase() || null,
    },
    error: null,
  };
}

export const ERROR_FALTA_MIGRACION_PAGO = "Falta correr la migración migracion_proveedores_datos_pago.sql.";
export const esErrorColumnasPago = (msg: string | undefined) => /banco|titular_cuenta|clabe|numero_cuenta|rfc/i.test(msg || "");

// Los 5 campos (para el formulario de alta y para el modal de edición).
export function CamposDatosPago({ valor, onChange }: { valor: typeof DATOS_PAGO_VACIOS; onChange: (v: typeof DATOS_PAGO_VACIOS) => void }) {
  return (
    <div className="tel-form-grid">
      <input placeholder="Banco" value={valor.banco} onChange={(e) => onChange({ ...valor, banco: e.target.value })} />
      <input placeholder="Titular de la cuenta" value={valor.titular_cuenta} onChange={(e) => onChange({ ...valor, titular_cuenta: e.target.value })} />
      <input placeholder="CLABE (18 dígitos)" inputMode="numeric" maxLength={22} value={valor.clabe} onChange={(e) => onChange({ ...valor, clabe: e.target.value })} />
      <input placeholder="No. de cuenta o tarjeta" inputMode="numeric" value={valor.numero_cuenta} onChange={(e) => onChange({ ...valor, numero_cuenta: e.target.value })} />
      <input placeholder="RFC" value={valor.rfc} onChange={(e) => onChange({ ...valor, rfc: e.target.value })} />
    </div>
  );
}

// Renglón con los datos de pago (con botón para copiar la CLABE).
export function LineaDatosPago({ p }: { p: DatosPago }) {
  const [copiado, setCopiado] = useState(false);
  if (!tieneDatosPago(p)) return null;
  const partes = [
    p.banco,
    p.titular_cuenta ? `Titular: ${p.titular_cuenta}` : "",
    p.numero_cuenta ? `Cuenta: ${p.numero_cuenta}` : "",
    p.rfc ? `RFC: ${p.rfc}` : "",
  ].filter(Boolean);
  return (
    <p className="item-card-extra" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span>🏦 {partes.join(" · ")}</span>
      {p.clabe && (
        <span>
          {partes.length > 0 ? "· " : ""}CLABE <b style={{ letterSpacing: 0.5 }}>{p.clabe}</b>{" "}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(p.clabe!);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1500);
              } catch {}
            }}
            style={{ font: "inherit", fontSize: 11, color: "#185FA5", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600 }}
          >
            {copiado ? "✓ Copiada" : "Copiar"}
          </button>
        </span>
      )}
    </p>
  );
}

// Botón "Datos de pago" de la tarjeta del proveedor: abre un modal para capturarlos o corregirlos.
export function BotonDatosPago({ proveedor, onGuardado }: { proveedor: DatosPago & { id: string; nombre: string }; onGuardado: () => void }) {
  const supabase = createClient();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState(DATOS_PAGO_VACIOS);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function abrir() {
    setForm({
      banco: proveedor.banco || "",
      titular_cuenta: proveedor.titular_cuenta || "",
      clabe: proveedor.clabe || "",
      numero_cuenta: proveedor.numero_cuenta || "",
      rfc: proveedor.rfc || "",
    });
    setError("");
    setAbierto(true);
  }

  async function guardar() {
    const { datos, error: errValida } = limpiarDatosPago(form);
    if (errValida) return setError(errValida);
    setGuardando(true);
    const { error: errGuardar } = await supabase.from("proveedores").update(datos).eq("id", proveedor.id);
    setGuardando(false);
    if (errGuardar) return setError(esErrorColumnasPago(errGuardar.message) ? ERROR_FALTA_MIGRACION_PAGO : "No se pudo guardar. Intenta de nuevo.");
    setAbierto(false);
    onGuardado();
  }

  return (
    <>
      <button type="button" className="tel-borrar-btn" style={{ fontSize: 12 }} onClick={abrir} title="Datos de pago">
        🏦 {tieneDatosPago(proveedor) ? "Editar pago" : "Datos de pago"}
      </button>
      {abierto && (
        <div className="modal-overlay" onClick={() => !guardando && setAbierto(false)}>
          <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Datos de pago</p>
            <p className="modal-email">{proveedor.nombre} · Contabilidad los verá al pagarle.</p>
            <CamposDatosPago valor={form} onChange={setForm} />
            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setAbierto(false)} disabled={guardando}>
                Cancelar
              </button>
              <button type="button" className="btn-aceptar" onClick={guardar} disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
