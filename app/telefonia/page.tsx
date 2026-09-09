"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcelPorCentro } from "@/lib/exportExcel";

type Extension = {
  id: string;
  centro: string;
  extension: string;
  did: string | null;
  departamento: string | null;
  asignado_a: string | null;
  tipo: string;
  notas: string | null;
  activo: boolean;
  user_id: string | null;
};

type ClienteOpcion = {
  id: string;
  nombre: string;
  empresa: string | null;
};

type CentroInternet = {
  id: string;
  centro: string;
  proveedor_principal: string | null;
  velocidad_principal: string | null;
  proveedor_respaldo: string | null;
  velocidad_respaldo: string | null;
  notas: string | null;
};

const CENTROS_SUGERIDOS = ["Puerta Bajío 2", "Piso 8", "Punto 45", "San Telmo", "Bosques"];
const ROLES_GLOBALES_TEL = ["sistemas", "superadmin", "gerente"];

export default function TelefoniaPage() {
  const supabase = createClient();

  const [extensiones, setExtensiones] = useState<Extension[]>([]);
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [internet, setInternet] = useState<CentroInternet[]>([]);
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const puedeEditarInternet = miRol === "sistemas" || (miRol === "superadmin" || miRol === "gerente");
  const puedeEditarTelefonia = miRol === "admin" || (miRol === "superadmin" || miRol === "gerente");
  const esGlobalTel = ROLES_GLOBALES_TEL.includes(miRol);
  const [centrosColapsados, setCentrosColapsados] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [editandoInternet, setEditandoInternet] = useState<string | null>(null);
  const [formInternet, setFormInternet] = useState<Partial<CentroInternet>>({});

  const [form, setForm] = useState({
    centro: "",
    extension: "",
    did: "",
    departamento: "",
    asignado_a: "",
    cliente_id: "",
    tipo: "interna",
    notas: "",
  });

  useEffect(() => {
    fetchTodo();
  }, []);

  useEffect(() => {
    if (!esGlobalTel && miCentro) {
      setForm((f) => ({ ...f, centro: miCentro }));
    }
  }, [esGlobalTel, miCentro]);

  async function fetchTodo() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let centroActual: string | null = null;
    let rolActual = "";
    if (user) {
      const { data: miProfile } = await supabase
        .from("profiles")
        .select("rol, centro")
        .eq("id", user.id)
        .single();
      rolActual = miProfile?.rol || "";
      setMiRol(rolActual);
      centroActual = miProfile?.centro || null;
      setMiCentro(centroActual);
    }
    const esGlobalActual = ROLES_GLOBALES_TEL.includes(rolActual);

    let clientesQuery = supabase.from("profiles").select("id, nombre, empresa").eq("rol", "cliente").order("nombre");
    if (!esGlobalActual && centroActual) clientesQuery = clientesQuery.eq("centro", centroActual);

    const [{ data: exts }, { data: clis }, { data: net }] = await Promise.all([
      supabase.from("extensiones").select("*").order("centro").order("extension"),
      clientesQuery,
      supabase.from("centros_internet").select("*").order("centro"),
    ]);
    setExtensiones(exts || []);
    setClientes(clis || []);
    setInternet(net || []);
    setLoading(false);
  }

  const porCentro = useMemo(() => {
    const map: Record<string, Extension[]> = {};
    extensiones.forEach((e) => {
      if (!map[e.centro]) map[e.centro] = [];
      map[e.centro].push(e);
    });
    return map;
  }, [extensiones]);

  const centros = Object.keys(porCentro).sort();

  async function handleAgregar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.centro.trim() || !form.extension.trim()) {
      setError("Centro y extensión son obligatorios");
      return;
    }
    setGuardando(true);
    const clienteElegido = clientes.find((c) => c.id === form.cliente_id);
    const { error: insertError } = await supabase.from("extensiones").insert({
      centro: form.centro.trim(),
      extension: form.extension.trim(),
      did: form.did.trim() || null,
      departamento: form.departamento.trim() || null,
      asignado_a: form.asignado_a.trim() || clienteElegido?.nombre || null,
      user_id: form.cliente_id || null,
      tipo: form.tipo,
      notas: form.notas.trim() || null,
      activo: true,
    });
    setGuardando(false);
    if (insertError) {
      setError("No se pudo guardar. Revisa que la extensión no esté duplicada.");
      return;
    }
    if (form.did.trim()) {
      await supabase.from("notificaciones").insert({
        centro: form.centro.trim(),
        tipo: "nuevo_did",
        mensaje: `☎️ Nuevo DID (${form.did.trim()}) agregado en ${form.centro.trim()} — ext. ${form.extension.trim()}`,
      });
    }
    setForm({
      centro: form.centro,
      extension: "",
      did: "",
      departamento: "",
      asignado_a: "",
      cliente_id: "",
      tipo: "interna",
      notas: "",
    });
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTodo();
  }

  async function toggleActivo(ext: Extension) {
    await supabase.from("extensiones").update({ activo: !ext.activo }).eq("id", ext.id);
    fetchTodo();
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar este registro?")) return;
    await supabase.from("extensiones").delete().eq("id", id);
    fetchTodo();
  }

  function abrirEdicionInternet(centro: string) {
    const existente = internet.find((i) => i.centro === centro);
    setFormInternet(
      existente || {
        centro,
        proveedor_principal: "",
        velocidad_principal: "",
        proveedor_respaldo: "",
        velocidad_respaldo: "",
        notas: "",
      }
    );
    setEditandoInternet(centro);
  }

  async function guardarInternet() {
    if (!formInternet.centro) return;
    await supabase.from("centros_internet").upsert(
      {
        centro: formInternet.centro,
        proveedor_principal: formInternet.proveedor_principal || null,
        velocidad_principal: formInternet.velocidad_principal || null,
        proveedor_respaldo: formInternet.proveedor_respaldo || null,
        velocidad_respaldo: formInternet.velocidad_respaldo || null,
        notas: formInternet.notas || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "centro" }
    );
    setEditandoInternet(null);
    fetchTodo();
  }

  const empresasDisponibles = Array.from(
    new Set(clientes.map((c) => c.empresa).filter((e): e is string => !!e))
  ).sort();

  const todosLosCentros = esGlobalTel
    ? Array.from(new Set([...CENTROS_SUGERIDOS, ...centros, ...internet.map((i) => i.centro)])).sort()
    : miCentro
    ? [miCentro]
    : [];

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Telefonía</p>
        <p className="rep-sub">Extensiones, DID e internet por centro</p>
      </div>

      <div className="rep-content">
        {/* ---------- Internet por centro ---------- */}
        <p className="panel-section-label">🌐 Internet por centro</p>
        {todosLosCentros.map((centro) => {
          const info = internet.find((i) => i.centro === centro);
          const editando = editandoInternet === centro;
          return (
            <div className="rep-ocupacion-card" key={centro}>
              {editando ? (
                <>
                  <div className="rep-ocupacion-header">
                    <span className="rep-ocupacion-centro">🏢 {centro}</span>
                  </div>
                  <div className="tel-form-grid">
                    <input
                      placeholder="Proveedor principal (ej. Alestra)"
                      value={formInternet.proveedor_principal || ""}
                      onChange={(e) =>
                        setFormInternet({ ...formInternet, proveedor_principal: e.target.value })
                      }
                    />
                    <input
                      placeholder="Velocidad principal (ej. 500 Mb)"
                      value={formInternet.velocidad_principal || ""}
                      onChange={(e) =>
                        setFormInternet({ ...formInternet, velocidad_principal: e.target.value })
                      }
                    />
                    <input
                      placeholder="Proveedor de respaldo (ej. Telmex)"
                      value={formInternet.proveedor_respaldo || ""}
                      onChange={(e) =>
                        setFormInternet({ ...formInternet, proveedor_respaldo: e.target.value })
                      }
                    />
                    <input
                      placeholder="Velocidad de respaldo (ej. 100 Mb)"
                      value={formInternet.velocidad_respaldo || ""}
                      onChange={(e) =>
                        setFormInternet({ ...formInternet, velocidad_respaldo: e.target.value })
                      }
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Notas (ej. failover por Netwatch)"
                    value={formInternet.notas || ""}
                    onChange={(e) => setFormInternet({ ...formInternet, notas: e.target.value })}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 13,
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-enviar" onClick={guardarInternet}>
                      Guardar
                    </button>
                    <button
                      className="tel-borrar-btn"
                      style={{ color: "#888" }}
                      onClick={() => setEditandoInternet(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rep-ocupacion-header">
                    <span className="rep-ocupacion-centro">🏢 {centro}</span>
                    {puedeEditarInternet && (
                      <button
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        onClick={() => abrirEdicionInternet(centro)}
                      >
                        {info ? "Editar" : "+ Agregar"}
                      </button>
                    )}
                  </div>
                  {info ? (
                    <div className="rep-ocupacion-detalle" style={{ flexWrap: "wrap", gap: 10 }}>
                      <span>
                        🟢 Principal: <b>{info.proveedor_principal || "—"}</b>{" "}
                        {info.velocidad_principal ? `(${info.velocidad_principal})` : ""}
                      </span>
                      <span>
                        🟠 Respaldo: <b>{info.proveedor_respaldo || "—"}</b>{" "}
                        {info.velocidad_respaldo ? `(${info.velocidad_respaldo})` : ""}
                      </span>
                      {info.notas && <span>📝 {info.notas}</span>}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                      Sin información capturada
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* ---------- Extensiones ---------- */}
        {puedeEditarTelefonia && (
          <>
            <p className="panel-section-label" style={{ marginTop: 12 }}>
              Agregar extensión
            </p>
            <form className="form-card" onSubmit={handleAgregar}>
          <div className="tel-form-grid">
            {esGlobalTel ? (
              <>
                <input
                  list="centros-list"
                  placeholder="Centro"
                  value={form.centro}
                  onChange={(e) => setForm({ ...form, centro: e.target.value })}
                />
                <datalist id="centros-list">
                  {CENTROS_SUGERIDOS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            ) : (
              <input value={miCentro || ""} disabled title="Solo puedes agregar a tu propio centro" />
            )}
            <input
              placeholder="Extensión (ej. 101)"
              value={form.extension}
              onChange={(e) => setForm({ ...form, extension: e.target.value })}
            />
            <input
              placeholder="DID (opcional)"
              value={form.did}
              onChange={(e) => setForm({ ...form, did: e.target.value })}
            />
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option value="interna">Interna</option>
              <option value="did">DID directo</option>
            </select>
            <input
              placeholder="Departamento / área"
              value={form.departamento}
              onChange={(e) => setForm({ ...form, departamento: e.target.value })}
            />
            <select
              value={form.cliente_id}
              onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}
            >
              <option value="">Asignar a cliente (opcional)</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <input
              list="empresas-list"
              placeholder="Empresa, área o nombre libre"
              value={form.asignado_a}
              onChange={(e) => setForm({ ...form, asignado_a: e.target.value })}
            />
            <datalist id="empresas-list">
              {empresasDisponibles.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </div>
          <input
            type="text"
            placeholder="Notas (opcional)"
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
          />
          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          <button
            className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
            type="submit"
            disabled={guardando}
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
            <span className="btn-enviar-text">+ Agregar extensión</span>
          </button>
        </form>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <p className="panel-section-label" style={{ margin: 0 }}>
            Registro por centro ({extensiones.length} extensiones)
          </p>
          <button
            className="btn-exportar"
            onClick={() => {
              const porCentroExport: Record<string, Record<string, any>[]> = {};
              extensiones.forEach((e) => {
                const key = e.centro || "Sin centro";
                if (!porCentroExport[key]) porCentroExport[key] = [];
                porCentroExport[key].push({
                  Extension: e.extension,
                  DID: e.did || "",
                  Tipo: e.tipo,
                  Departamento: e.departamento || "",
                  "Asignado a": e.asignado_a || "",
                  Notas: e.notas || "",
                  Activo: e.activo ? "Sí" : "No",
                });
              });
              exportarExcelPorCentro("extensiones", porCentroExport);
            }}
          >
            📥 Excel
          </button>
        </div>

        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : centros.length === 0 ? (
          <div className="empty-card">Aún no hay extensiones registradas</div>
        ) : (
          centros.map((centro) => {
            const lista = porCentro[centro];
            const colapsado = centrosColapsados[centro];
            return (
              <div className="tel-centro-card" key={centro}>
                <div
                  className="tel-centro-header"
                  onClick={() =>
                    setCentrosColapsados((prev) => ({ ...prev, [centro]: !prev[centro] }))
                  }
                >
                  <p className="tel-centro-nombre">🏢 {centro}</p>
                  <span className="tel-centro-count">
                    {lista.length} extensión(es) {colapsado ? "▸" : "▾"}
                  </span>
                </div>
                {!colapsado && (
                  <table className="tel-tabla">
                    <thead>
                      <tr>
                        <th>Ext.</th>
                        <th>DID</th>
                        <th>Tipo</th>
                        <th>Departamento</th>
                        <th>Asignado a</th>
                        <th>Notas</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((ext) => (
                        <tr key={ext.id} className={ext.activo ? "" : "tel-inactivo"}>
                          <td>
                            <span className="tel-ext-badge">{ext.extension}</span>
                          </td>
                          <td>{ext.did || "—"}</td>
                          <td>
                            <span
                              className="tel-tipo-badge"
                              style={{
                                background: ext.tipo === "did" ? "#E6F1FB" : "#FAEEDA",
                                color: ext.tipo === "did" ? "#185FA5" : "#854F0B",
                              }}
                            >
                              {ext.tipo === "did" ? "DID" : "Interna"}
                            </span>
                          </td>
                          <td>{ext.departamento || "—"}</td>
                          <td>
                            {ext.asignado_a || "—"}
                            {ext.user_id && (
                              <span style={{ color: "#0F6E56", fontSize: 11 }}> · vinculado</span>
                            )}
                          </td>
                          <td style={{ color: "#888", fontSize: 12 }}>{ext.notas || "—"}</td>
                          <td style={{ display: "flex", gap: 8 }}>
                            {puedeEditarTelefonia && (
                              <>
                                <button
                                  className="tel-borrar-btn"
                                  style={{ color: "#888" }}
                                  onClick={() => toggleActivo(ext)}
                                  title={ext.activo ? "Marcar inactiva" : "Marcar activa"}
                                >
                                  {ext.activo ? "⏸" : "▶"}
                                </button>
                                <button className="tel-borrar-btn" onClick={() => borrar(ext.id)}>
                                  🗑
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
