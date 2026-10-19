"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rolPuede } from "@/lib/permisosApi";
import { REGIMENES_FISCALES, usosParaTipo, avisosDatosFiscales, normalizarRfc } from "@/lib/datosFiscales";

// Configuración fiscal: los datos fiscales de cada cliente (los que se capturaron al ligar su contrato). Finanzas los
// revisa y los corrige si vienen con errores o si la empresa los cambió.

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type ClienteFiscal = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  nombre_fiscal: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  cp_fiscal: string | null;
  uso_cfdi: string | null;
  porContrato?: boolean;
};

export default function ConfiguracionFiscalPage() {
  const supabase = createClient();
  const [rol, setRol] = useState("");
  const [centro, setCentro] = useState("");
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [soloConPendientes, setSoloConPendientes] = useState(false);
  const [editando, setEditando] = useState<ClienteFiscal | null>(null);
  const [form, setForm] = useState({ rfc: "", nombre_fiscal: "", regimen_fiscal: "", cp_fiscal: "", uso_cfdi: "G03" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const esGlobal = ROLES_GLOBALES.includes(rol);
  const puedeEditar = rolPuede(rol, "facturaEmitir");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
      setRol(yo?.rol || "");
      setCentro(yo?.centro || CENTROS[0]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar(c: string) {
    setCargando(true);
    const res = await fetch("/api/facturas/clientes?centro=" + encodeURIComponent(c));
    const data = await res.json().catch(() => ({}));
    setClientes((data.clientes as ClienteFiscal[]) || []);
    setCargando(false);
  }

  useEffect(() => {
    if (centro) cargar(centro);
  }, [centro]);

  const estadoDe = (c: ClienteFiscal): { tipo: string; texto: string; detalle?: string } => {
    const completos = !!(c.rfc && c.nombre_fiscal && c.regimen_fiscal && c.cp_fiscal);
    if (!completos) return { tipo: "roja", texto: "Faltan datos" };
    const avisos = avisosDatosFiscales(c);
    if (avisos.length > 0) return { tipo: "ambar", texto: "Revisar", detalle: avisos[0] };
    return { tipo: "verde", texto: "Completos" };
  };

  const visibles = useMemo(() => {
    const q = sinAcentos(busqueda.trim());
    return clientes.filter((c) => {
      if (q && !sinAcentos([c.nombre, c.email, c.empresa, c.nombre_fiscal, c.rfc].filter(Boolean).join(" ")).includes(q)) return false;
      if (soloConPendientes && estadoDe(c).tipo === "verde") return false;
      return true;
    });
  }, [clientes, busqueda, soloConPendientes]);

  function abrir(c: ClienteFiscal) {
    setEditando(c);
    setForm({ rfc: c.rfc || "", nombre_fiscal: c.nombre_fiscal || "", regimen_fiscal: c.regimen_fiscal || "", cp_fiscal: c.cp_fiscal || "", uso_cfdi: c.uso_cfdi || "G03" });
    setError("");
  }

  const tipoForm = normalizarRfc(form.rfc).length === 12 ? "moral" : "fisica";
  const avisosForm = avisosDatosFiscales({ rfc: form.rfc, nombre_fiscal: form.nombre_fiscal, regimen_fiscal: form.regimen_fiscal });

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    setError("");
    const res = await fetch("/api/facturas/datos-fiscales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editando.id, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) return setError(data.error || "No se pudo guardar");
    setEditando(null);
    setAviso(`✓ Datos fiscales de ${data.datos?.nombre_fiscal || "el cliente"} actualizados. Las próximas facturas salen con estos datos.`);
    cargar(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Facturación
        </a>
        <p className="rep-title">Configuración fiscal</p>
        <p className="rep-sub">Datos fiscales de los clientes (los que se capturaron al ligar su contrato)</p>
      </div>

      <div className="rep-content rep-content-completo">
        <div className="ft-card">
          <div className="ft-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <label className="ft-campo">
              <span>Centro</span>
              <select value={centro} disabled={!esGlobal} onChange={(e) => setCentro(e.target.value)}>
                {(esGlobal ? CENTROS : [centro]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="ft-campo">
              <span>Buscar</span>
              <input placeholder="Cliente, razón social o RFC..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
            <label className="ft-campo" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 26 }}>
              <input type="checkbox" style={{ width: "auto", height: "auto" }} checked={soloConPendientes} onChange={(e) => setSoloConPendientes(e.target.checked)} />
              <span>Solo los que faltan o hay que revisar</span>
            </label>
          </div>
          {!puedeEditar && <p style={{ fontSize: 12, color: "#888", margin: "0 20px 14px" }}>Puedes consultar; solo finanzas y administración pueden cambiar los datos.</p>}
        </div>

        {aviso && (
          <div className="form-card" style={{ marginTop: 10, fontSize: 13 }}>
            {aviso}
            <button className="tel-borrar-btn" style={{ marginLeft: 8 }} onClick={() => setAviso("")}>
              Cerrar
            </button>
          </div>
        )}

        <div className="ft-card ft-resultados">
          {cargando ? (
            <div className="ft-vacio">Cargando...</div>
          ) : visibles.length === 0 ? (
            <div className="ft-vacio">Ningún cliente coincide</div>
          ) : (
            <div className="ft-tabla-wrap" style={{ borderTop: "none" }}>
              <table className="ft-tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Razón social</th>
                    <th>RFC</th>
                    <th>Régimen</th>
                    <th>C.P.</th>
                    <th>Uso CFDI</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((c) => {
                    const e = estadoDe(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <b>{c.nombre}</b>
                          <span className="fac-sub">{c.email}</span>
                          {c.porContrato && <span className="fac-sub">Contrato en este centro</span>}
                        </td>
                        <td>{c.nombre_fiscal || "—"}</td>
                        <td className="ft-nowrap">{c.rfc || "—"}</td>
                        <td>{c.regimen_fiscal || "—"}</td>
                        <td className="ft-nowrap">{c.cp_fiscal || "—"}</td>
                        <td className="ft-nowrap">{c.uso_cfdi || "—"}</td>
                        <td>
                          <span className={"ft-chip ft-chip-" + e.tipo} title={e.detalle || ""}>
                            {e.texto}
                          </span>
                        </td>
                        <td>
                          {puedeEditar && (
                            <button type="button" className="ft-btn-sec" onClick={() => abrir(c)}>
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editando && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !guardando && setEditando(null)}
        >
          <div className="form-card fac-facturar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="fac-facturar-cerrar" aria-label="Cerrar" disabled={guardando} onClick={() => setEditando(null)}>
              ×
            </button>
            <h2 className="fac-facturar-titulo">Datos fiscales</h2>
            <p className="fac-facturar-sub">
              {editando.nombre} · {editando.email}
            </p>
            <div className="fac-facturar-fila">
              <label>RFC *</label>
              <div>
                <input type="text" maxLength={13} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} />
                <p className="fac-facturar-nota">{tipoForm === "moral" ? "12 caracteres: persona moral (empresa)" : "13 caracteres: persona física"}</p>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Razón social *</label>
              <div>
                <input type="text" maxLength={200} value={form.nombre_fiscal} onChange={(e) => setForm({ ...form, nombre_fiscal: e.target.value.toUpperCase() })} />
                <p className="fac-facturar-nota">Tal como aparece en la Constancia de Situación Fiscal, sin "S.A. DE C.V.".</p>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Régimen fiscal *</label>
              <div>
                <select value={form.regimen_fiscal} onChange={(e) => setForm({ ...form, regimen_fiscal: e.target.value })}>
                  <option value="">Elige el régimen</option>
                  {REGIMENES_FISCALES.filter((r) => r.aplica.includes(tipoForm)).map((r) => (
                    <option key={r.clave} value={r.clave}>
                      {r.clave} · {r.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>C.P. fiscal *</label>
              <div>
                <input type="text" inputMode="numeric" maxLength={5} value={form.cp_fiscal} onChange={(e) => setForm({ ...form, cp_fiscal: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
            <div className="fac-facturar-fila">
              <label>Uso del CFDI *</label>
              <div>
                <select value={form.uso_cfdi} onChange={(e) => setForm({ ...form, uso_cfdi: e.target.value })}>
                  {usosParaTipo(tipoForm).map((u) => (
                    <option key={u.clave} value={u.clave}>
                      {u.clave} · {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {avisosForm.length > 0 && <p style={{ fontSize: 12, color: "#854F0B", margin: "6px 0 0" }}>{avisosForm[0]}</p>}
            {error && <p style={{ fontSize: 13, color: "#A32D2D", margin: "8px 0 0" }}>{error}</p>}
            <p className="fac-facturar-nota">Aplica a las facturas que se emitan desde ahora. Las ya timbradas no cambian: si estaban mal, se cancelan y se vuelven a emitir.</p>
            <div className="fac-facturar-botones">
              <button type="button" className="btn-exportar fac-naranja" disabled={guardando} onClick={guardar}>
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
