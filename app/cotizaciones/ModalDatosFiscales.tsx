"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cpCentro } from "@/lib/centros";
import {
  DATOS_PUBLICO_GENERAL,
  REGIMENES_FISCALES,
  USOS_CFDI,
  USO_CFDI_DEFAULT,
  esPublicoGeneral,
  normalizarDatosFiscales,
  normalizarRfc,
  validarDatosFiscales,
  type DatosFiscales,
  type TipoPersonaFiscal,
} from "@/lib/datosFiscales";

// Ventana que se abre al aceptar una cotización de Coworking / Oficina / Working
// Desk: pide los datos fiscales del cliente (para el contrato y para facturarle).
// Se llena con lo que ya se sepa de la venta o de la cuenta del cliente.
export default function ModalDatosFiscales({
  cotizacionComercialId,
  aceptando,
  error,
  onCancelar,
  onAceptar,
}: {
  cotizacionComercialId: string;
  aceptando: boolean;
  error: string;
  onCancelar: () => void;
  onAceptar: (fiscal: DatosFiscales) => void;
}) {
  const supabase = createClient();
  const [cargando, setCargando] = useState(true);
  const [tipo, setTipo] = useState<TipoPersonaFiscal>("fisica");
  const [nombreContacto, setNombreContacto] = useState("");
  const [centro, setCentro] = useState("");
  const [f, setF] = useState<DatosFiscales>({ rfc: "", nombre_fiscal: "", regimen_fiscal: "", cp_fiscal: "", uso_cfdi: USO_CFDI_DEFAULT });
  const [errorLocal, setErrorLocal] = useState("");

  useEffect(() => {
    (async () => {
      const { data: v } = await supabase
        .from("cotizaciones_comerciales")
        .select("tipo_persona, razon_social, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi, cliente_id, nombre_contesta_telefono, centro")
        .eq("id", cotizacionComercialId)
        .maybeSingle();
      const tipoPersona: TipoPersonaFiscal = v?.tipo_persona === "moral" ? "moral" : "fisica";
      setTipo(tipoPersona);
      setNombreContacto(v?.nombre_contesta_telefono || "");
      setCentro(v?.centro || "");

      // Si el cliente ya tiene cuenta, se aprovechan sus datos fiscales guardados.
      let p: Record<string, string | null> = {};
      if (v?.cliente_id) {
        const { data: perfil } = await supabase
          .from("profiles")
          .select("rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi")
          .eq("id", v.cliente_id)
          .maybeSingle();
        p = perfil || {};
      }
      setF({
        rfc: v?.rfc || p.rfc || "",
        nombre_fiscal: v?.nombre_fiscal || (tipoPersona === "moral" ? v?.razon_social : "") || p.nombre_fiscal || "",
        regimen_fiscal: v?.regimen_fiscal || p.regimen_fiscal || "",
        cp_fiscal: v?.cp_fiscal || p.cp_fiscal || "",
        uso_cfdi: v?.uso_cfdi || p.uso_cfdi || USO_CFDI_DEFAULT,
      });
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizacionComercialId]);

  function enviar() {
    const datos = normalizarDatosFiscales({ ...f, rfc: normalizarRfc(f.rfc), nombre_fiscal: f.nombre_fiscal.trim(), cp_fiscal: f.cp_fiscal.trim() });
    const msg = validarDatosFiscales(datos, tipo);
    setErrorLocal(msg);
    if (!msg) onAceptar(datos);
  }

  const regimenes = REGIMENES_FISCALES.filter((r) => r.aplica.includes(tipo));
  // Si el cliente no da datos fiscales, se le factura como "público en general" (solo personas físicas).
  const publico = esPublicoGeneral(f.rfc);
  function alternarPublicoGeneral() {
    setErrorLocal("");
    if (publico) {
      setF({ rfc: "", nombre_fiscal: "", regimen_fiscal: "", cp_fiscal: "", uso_cfdi: USO_CFDI_DEFAULT });
    } else {
      setF({ ...DATOS_PUBLICO_GENERAL, cp_fiscal: f.cp_fiscal || cpCentro(centro) });
    }
  }
  const estiloCampo = { width: "100%", border: "1px solid #eee", borderRadius: 10, padding: "9px 11px", fontSize: 14 } as const;

  return (
    <div className="modal-overlay" onClick={() => !aceptando && onCancelar()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="modal-nombre">Aceptar cotización · datos fiscales</p>
        <p className="modal-email">
          {nombreContacto ? `${nombreContacto} · ` : ""}Persona {tipo === "moral" ? "moral" : "física"}. Se piden ahora que el
          cliente aceptó: van en el contrato y sirven para facturarle.
        </p>

        {cargando ? (
          <p style={{ fontSize: 13, color: "#888" }}>Cargando…</p>
        ) : (
          <>
            {tipo === "fisica" && (
              <button
                type="button"
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 8 }}
                onClick={alternarPublicoGeneral}
              >
                {publico ? "✎ Capturar los datos fiscales del cliente" : "👤 El cliente no dio datos fiscales → público en general"}
              </button>
            )}
            {publico && (
              <div className="nota-info" style={{ lineHeight: 1.45 }}>
                Se le factura como <b>público en general</b> (RFC genérico del SAT). Esa factura <b>no le sirve al cliente para deducir</b>. Si
                después da sus datos, se pueden actualizar. Solo falta el código postal: el del centro que expide la factura.
              </div>
            )}
            <p className="sub-label" style={{ marginTop: 10 }}>
              RFC
            </p>
            <input
              style={estiloCampo}
              disabled={publico}
              value={f.rfc}
              onChange={(e) => setF({ ...f, rfc: e.target.value.toUpperCase() })}
              placeholder={tipo === "moral" ? "12 caracteres" : "13 caracteres"}
              maxLength={13}
            />
            <p className="sub-label" style={{ marginTop: 8 }}>
              {tipo === "moral" ? "Razón social" : "Nombre completo"} (como aparece en su constancia fiscal)
            </p>
            <input style={estiloCampo} disabled={publico} value={f.nombre_fiscal} onChange={(e) => setF({ ...f, nombre_fiscal: e.target.value })} />
            <p className="sub-label" style={{ marginTop: 8 }}>
              Régimen fiscal
            </p>
            <select style={estiloCampo} disabled={publico} value={f.regimen_fiscal} onChange={(e) => setF({ ...f, regimen_fiscal: e.target.value })}>
              <option value="">Selecciona…</option>
              {regimenes.map((r) => (
                <option key={r.clave} value={r.clave}>
                  {r.clave} · {r.nombre}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <p className="sub-label">{publico ? "Código postal del centro" : "Código postal fiscal"}</p>
                <input
                  style={estiloCampo}
                  value={f.cp_fiscal}
                  onChange={(e) => setF({ ...f, cp_fiscal: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                  inputMode="numeric"
                  placeholder="5 dígitos"
                />
              </div>
              <div style={{ flex: 1 }}>
                <p className="sub-label">Uso de la factura</p>
                <select style={estiloCampo} disabled={publico} value={f.uso_cfdi} onChange={(e) => setF({ ...f, uso_cfdi: e.target.value })}>
                  {USOS_CFDI.map((u) => (
                    <option key={u.clave} value={u.clave}>
                      {u.clave} · {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {(errorLocal || error) && <p style={{ color: "#A32D2D", fontSize: 13, margin: "8px 0 0" }}>{errorLocal || error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="tel-borrar-btn" onClick={onCancelar} disabled={aceptando}>
            Cancelar
          </button>
          <button className="btn-aceptar" onClick={enviar} disabled={aceptando || cargando}>
            {aceptando ? "Generando contrato…" : "✓ Aceptar y generar contrato"}
          </button>
        </div>
      </div>
    </div>
  );
}
