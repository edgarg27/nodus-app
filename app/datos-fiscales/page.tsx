"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  REGIMENES_FISCALES,
  USOS_CFDI,
  USO_CFDI_DEFAULT,
  esPublicoGeneral,
  normalizarRfc,
  validarDatosFiscales,
  type TipoPersonaFiscal,
} from "@/lib/datosFiscales";

const estiloCampo = { width: "100%", border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 15 } as const;

// El cliente completa o corrige los datos con los que se le factura. Si entró como
// "público en general" (o nunca dio su RFC), aquí puede poner los suyos.
export default function DatosFiscalesPage() {
  const supabase = createClient();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState("");
  const [eraPublico, setEraPublico] = useState(false);
  const [tipo, setTipo] = useState<TipoPersonaFiscal>("fisica");
  const [f, setF] = useState({ rfc: "", nombre_fiscal: "", regimen_fiscal: "", cp_fiscal: "", uso_cfdi: USO_CFDI_DEFAULT });

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase
          .from("profiles")
          .select("rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi")
          .eq("id", user.id)
          .maybeSingle();
        const rfc = normalizarRfc(p?.rfc || "");
        const publico = !rfc || esPublicoGeneral(rfc);
        setEraPublico(publico);
        if (!publico) {
          setTipo(rfc.length === 12 ? "moral" : "fisica");
          setF({
            rfc,
            nombre_fiscal: p?.nombre_fiscal || "",
            regimen_fiscal: p?.regimen_fiscal || "",
            cp_fiscal: p?.cp_fiscal || "",
            uso_cfdi: p?.uso_cfdi || USO_CFDI_DEFAULT,
          });
        } else {
          // Con datos de público en general se deja el formulario vacío, salvo el código postal.
          setF((prev) => ({ ...prev, cp_fiscal: esPublicoGeneral(rfc) ? "" : p?.cp_fiscal || "" }));
        }
      }
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cambiarTipo(t: TipoPersonaFiscal) {
    setTipo(t);
    setF((prev) => ({ ...prev, regimen_fiscal: "" }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const datos = { ...f, rfc: normalizarRfc(f.rfc), nombre_fiscal: f.nombre_fiscal.trim(), cp_fiscal: f.cp_fiscal.trim() };
    const msg = validarDatosFiscales(datos, tipo);
    if (msg) return setError(msg);
    setGuardando(true);
    try {
      const res = await fetch("/api/datos-fiscales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...datos, tipo }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "No se pudieron guardar tus datos");
      else {
        setGuardado(true);
        setEraPublico(false);
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setGuardando(false);
  }

  const regimenes = REGIMENES_FISCALES.filter((r) => r.aplica.includes(tipo));

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mis datos fiscales</p>
        <p className="rep-sub">Con estos datos se emiten tus facturas</p>
      </div>
      <div className="sub-content">
        {cargando ? (
          <p style={{ color: "#888", fontSize: 13 }}>Cargando...</p>
        ) : (
          <form onSubmit={guardar} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {eraPublico && !guardado && (
              <div className="nota-info" style={{ lineHeight: 1.45 }}>
                Hoy tus facturas salen a <b>público en general</b> y no te sirven para deducir. Captura los datos de tu constancia de
                situación fiscal para que salgan a tu nombre.
              </div>
            )}
            {guardado && <div className="nota-info">✓ Listo, guardamos tus datos fiscales. Tus próximas facturas saldrán con ellos.</div>}

            <div>
              <p className="sub-label">Tipo de persona</p>
              <div style={{ display: "flex", gap: 8 }}>
                {(["fisica", "moral"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tipo === t ? "reservar-btn" : "tel-borrar-btn"}
                    style={tipo === t ? { flex: 1 } : { flex: 1, color: "#0d1b3e", border: "1px solid #ddd", background: "#fff", borderRadius: 10 }}
                    onClick={() => cambiarTipo(t)}
                  >
                    {t === "fisica" ? "Persona física" : "Persona moral"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="sub-label">RFC</p>
              <input
                style={estiloCampo}
                value={f.rfc}
                maxLength={13}
                placeholder={tipo === "moral" ? "12 caracteres" : "13 caracteres"}
                onChange={(e) => setF({ ...f, rfc: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <p className="sub-label">{tipo === "moral" ? "Razón social" : "Nombre completo"} (como aparece en tu constancia fiscal)</p>
              <input style={estiloCampo} value={f.nombre_fiscal} onChange={(e) => setF({ ...f, nombre_fiscal: e.target.value })} />
            </div>
            <div>
              <p className="sub-label">Régimen fiscal</p>
              <select style={estiloCampo} value={f.regimen_fiscal} onChange={(e) => setF({ ...f, regimen_fiscal: e.target.value })}>
                <option value="">Elige el régimen</option>
                {regimenes.map((r) => (
                  <option key={r.clave} value={r.clave}>
                    {r.clave} · {r.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Código postal fiscal</p>
              <input
                style={estiloCampo}
                value={f.cp_fiscal}
                inputMode="numeric"
                maxLength={5}
                onChange={(e) => setF({ ...f, cp_fiscal: e.target.value.replace(/\D/g, "").slice(0, 5) })}
              />
            </div>
            <div>
              <p className="sub-label">Uso de la factura</p>
              <select style={estiloCampo} value={f.uso_cfdi} onChange={(e) => setF({ ...f, uso_cfdi: e.target.value })}>
                {USOS_CFDI.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.clave} · {u.nombre}
                  </option>
                ))}
              </select>
            </div>
            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}
            <button className="reservar-btn" type="submit" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar mis datos fiscales"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
