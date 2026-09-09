"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Prospecto = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  interes: string | null;
  estado: string;
  notas: string | null;
  created_at: string;
  centro?: string | null;
  medio?: string | null;
  // Mismos datos que se piden al dar de alta un cliente (ver
  // app/alta-cliente/page.tsx) — capturarlos aquí desde el inicio evita
  // volver a preguntarlos cuando el prospecto se convierte en cliente.
  empresa?: string | null;
  rfc?: string | null;
  dia_pago?: number | null;
  comentario_perdido?: string | null;
};

const ESTADOS_PROSPECTO: Record<string, { label: string; bg: string; color: string }> = {
  nuevo: { label: "Nuevo", bg: "#E6F1FB", color: "#185FA5" },
  contactado: { label: "Contactado", bg: "#FAEEDA", color: "#854F0B" },
  en_seguimiento: { label: "En seguimiento", bg: "#FFF3E8", color: "#F07E3A" },
  convertido: { label: "Convertido", bg: "#E1F5EE", color: "#0F6E56" },
  perdido: { label: "Perdido", bg: "#FCEBEB", color: "#A32D2D" },
};

// Mismas opciones que ya usa CotizarForm.tsx para "Medio de contacto" al cotizar.
const MEDIOS_PROSPECTO = ["Teléfono", "Redes sociales", "Referido", "Página web", "Otro"];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function ProspectosPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  const [prospectos, setProspectos] = useState<Prospecto[]>([]);
  const [formProspecto, setFormProspecto] = useState({
    nombre: "",
    telefono: "",
    email: "",
    interes: "",
    notas: "",
    medio: "",
    // El día de pago se quitó de aquí: se sigue preguntando hasta
    // alta-cliente, cuando ya hay un contrato de por medio.
    empresa: "",
    rfc: "",
    centroInteres: "",
  });

  const [prospectoPerdiendo, setProspectoPerdiendo] = useState<Prospecto | null>(null);
  const [comentarioPerdido, setComentarioPerdido] = useState("");

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro, nombre").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    let miCentro = profile?.centro || null;
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      miCentro = miCentro || CENTROS_SUGERIDOS[0];
    }
    setCentro(miCentro);
    setFormProspecto((f) => ({ ...f, centroInteres: miCentro || "" }));
    await cargarProspectos();
    setLoading(false);
  }

  async function cargarProspectos() {
    // Sin filtrar por centro a propósito — un prospecto puede interesarse en
    // cualquier Nodus, y cualquier admin debe poder ver y dar seguimiento a
    // todos los prospectos, no solo los de un centro.
    const { data } = await supabase.from("prospectos").select("*").order("created_at", { ascending: false });
    setProspectos(data || []);
  }

  async function agregarProspecto(e: React.FormEvent) {
    e.preventDefault();
    if (!formProspecto.nombre.trim() || !formProspecto.centroInteres) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("prospectos").insert({
      centro: formProspecto.centroInteres,
      nombre: formProspecto.nombre,
      telefono: formProspecto.telefono,
      email: formProspecto.email,
      interes: formProspecto.interes,
      notas: formProspecto.notas,
      medio: formProspecto.medio || null,
      empresa: formProspecto.empresa || null,
      rfc: formProspecto.rfc || null,
      registrado_por: user?.id,
    });
    setFormProspecto({
      nombre: "",
      telefono: "",
      email: "",
      interes: "",
      notas: "",
      medio: "",
      empresa: "",
      rfc: "",
      centroInteres: centro || "",
    });
    cargarProspectos();
  }

  async function cambiarEstadoProspecto(id: string, estado: string) {
    if (estado === "perdido") {
      const p = prospectos.find((x) => x.id === id) || null;
      setComentarioPerdido("");
      setProspectoPerdiendo(p);
      return;
    }
    await supabase.from("prospectos").update({ estado, comentario_perdido: null }).eq("id", id);
    setProspectos((prev) => prev.map((p) => (p.id === id ? { ...p, estado, comentario_perdido: null } : p)));
  }

  async function confirmarProspectoPerdido() {
    if (!prospectoPerdiendo) return;
    if (!comentarioPerdido.trim()) {
      alert("Escribe un comentario para marcarlo como Perdido.");
      return;
    }
    const id = prospectoPerdiendo.id;
    await supabase.from("prospectos").update({ estado: "perdido", comentario_perdido: comentarioPerdido.trim() }).eq("id", id);
    setProspectos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado: "perdido", comentario_perdido: comentarioPerdido.trim() } : p))
    );
    setProspectoPerdiendo(null);
    setComentarioPerdido("");
  }

  async function borrarProspecto(id: string) {
    if (!confirm("¿Borrar este prospecto?")) return;
    await supabase.from("prospectos").delete().eq("id", id);
    cargarProspectos();
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Prospectos</p>
        <p className="rep-sub">{centro || "Todos los centros"}</p>
      </div>

      <div className="rep-content">
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
        ) : (
          <>
            <p className="panel-section-label">Registrar prospecto</p>
            <form className="form-card" onSubmit={agregarProspecto}>
              <div className="tel-form-grid">
                <input
                  placeholder="Nombre"
                  value={formProspecto.nombre}
                  onChange={(e) => setFormProspecto({ ...formProspecto, nombre: e.target.value })}
                />
                <input
                  placeholder="Teléfono"
                  value={formProspecto.telefono}
                  onChange={(e) => setFormProspecto({ ...formProspecto, telefono: e.target.value })}
                />
                <input
                  placeholder="Correo"
                  value={formProspecto.email}
                  onChange={(e) => setFormProspecto({ ...formProspecto, email: e.target.value })}
                />
                <input
                  placeholder="Interés (ej. oficina 2 personas)"
                  value={formProspecto.interes}
                  onChange={(e) => setFormProspecto({ ...formProspecto, interes: e.target.value })}
                />
                <input
                  placeholder="Empresa"
                  value={formProspecto.empresa}
                  onChange={(e) => setFormProspecto({ ...formProspecto, empresa: e.target.value })}
                />
                <input
                  placeholder="RFC"
                  value={formProspecto.rfc}
                  onChange={(e) => setFormProspecto({ ...formProspecto, rfc: e.target.value })}
                />
                <select
                  value={formProspecto.medio}
                  onChange={(e) => setFormProspecto({ ...formProspecto, medio: e.target.value })}
                >
                  <option value="" hidden>
                    Medio de contacto
                  </option>
                  {MEDIOS_PROSPECTO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={formProspecto.centroInteres}
                  onChange={(e) => setFormProspecto({ ...formProspecto, centroInteres: e.target.value })}
                >
                  <option value="">Centro de interés</option>
                  {(esGlobal ? centrosDisponibles : centro ? [centro] : CENTROS_SUGERIDOS).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="Notas"
                value={formProspecto.notas}
                onChange={(e) => setFormProspecto({ ...formProspecto, notas: e.target.value })}
              />
              <button className="btn-enviar" type="submit">
                + Agregar prospecto
              </button>
            </form>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Todos los prospectos ({prospectos.length})
              </p>
              <button
                className="btn-exportar"
                onClick={() =>
                  exportarExcel(
                    "prospectos",
                    prospectos.map((p) => ({
                      Nombre: p.nombre,
                      Telefono: p.telefono || "",
                      Email: p.email || "",
                      Empresa: p.empresa || "",
                      RFC: p.rfc || "",
                      Interes: p.interes || "",
                      Medio: p.medio || "",
                      Centro: p.centro || "",
                      Estado: p.estado,
                      "Motivo perdido": p.comentario_perdido || "",
                      Notas: p.notas || "",
                    }))
                  )
                }
              >
                📥 Excel
              </button>
            </div>
            {prospectos.length === 0 ? (
              <div className="empty-card">Sin prospectos registrados</div>
            ) : (
              (() => {
                const porMes: Record<string, Prospecto[]> = {};
                prospectos.forEach((p) => {
                  const d = new Date(p.created_at);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  if (!porMes[key]) porMes[key] = [];
                  porMes[key].push(p);
                });
                const mesesOrdenados = Object.keys(porMes).sort().reverse();

                return mesesOrdenados.map((mesKey) => {
                  const [anio, mesNum] = mesKey.split("-");
                  const lista = [...porMes[mesKey]].sort((a, b) => {
                    const interesCmp = (a.interes || "").localeCompare(b.interes || "");
                    if (interesCmp !== 0) return interesCmp;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                  });
                  return (
                    <div key={mesKey}>
                      <p className="panel-section-label" style={{ marginTop: 12 }}>
                        📅 {MESES[Number(mesNum) - 1]} {anio} ({lista.length})
                      </p>
                      {lista.map((p) => {
                        const est = ESTADOS_PROSPECTO[p.estado] || ESTADOS_PROSPECTO.nuevo;
                        return (
                          <div className="item-card" key={p.id} style={{ marginBottom: 8 }}>
                            <div className="item-card-info">
                              <p className="item-card-titulo">{p.nombre}</p>
                              <p className="item-card-sub">
                                {p.telefono || ""} {p.email ? `· ${p.email}` : ""}
                              </p>
                              <p className="item-card-extra">
                                🏢 {p.centro || "—"} {p.medio ? `· 📞 ${p.medio}` : ""}
                              </p>
                              {p.empresa && <p className="item-card-extra">🏬 {p.empresa}</p>}
                              {p.interes && <p className="item-card-extra">Interés: {p.interes}</p>}
                              {p.estado === "perdido" && p.comentario_perdido && (
                                <p className="item-card-extra" style={{ color: "#A32D2D" }}>
                                  ❌ {p.comentario_perdido}
                                </p>
                              )}
                              <p className="item-card-extra" style={{ color: "#aaa" }}>
                                {new Date(p.created_at).toLocaleDateString("es-MX")}
                              </p>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                              <select
                                className="estado-select-prospecto"
                                style={{ background: est.bg, color: est.color }}
                                value={p.estado}
                                onChange={(e) => cambiarEstadoProspecto(p.id, e.target.value)}
                              >
                                {Object.entries(ESTADOS_PROSPECTO)
                                  .filter(([k]) => k !== "convertido")
                                  .map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v.label}
                                    </option>
                                  ))}
                              </select>
                              <a
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                href={`/registrar-plan?centro=${encodeURIComponent(p.centro || centro || "")}&prospectoNombre=${encodeURIComponent(
                                  p.nombre
                                )}&prospectoTelefono=${encodeURIComponent(p.telefono || "")}&prospectoEmail=${encodeURIComponent(
                                  p.email || ""
                                )}&prospectoInteres=${encodeURIComponent(p.interes || "")}`}
                              >
                                🧾 Cotizar
                              </a>
                              <a
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                href={`/alta-cliente?nombre=${encodeURIComponent(p.nombre)}&email=${encodeURIComponent(
                                  p.email || ""
                                )}&telefono=${encodeURIComponent(p.telefono || "")}&empresa=${encodeURIComponent(
                                  p.empresa || ""
                                )}&rfc=${encodeURIComponent(p.rfc || "")}&diaPago=${encodeURIComponent(
                                  p.dia_pago != null ? String(p.dia_pago) : ""
                                )}&prospectoId=${encodeURIComponent(p.id)}`}
                              >
                                👤 Nuevo cliente
                              </a>
                              <button className="tel-borrar-btn" onClick={() => borrarProspecto(p.id)}>
                                🗑
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()
            )}
          </>
        )}
      </div>

      {prospectoPerdiendo && (
        <div
          className="modal-overlay"
          onClick={() => {
            setProspectoPerdiendo(null);
            setComentarioPerdido("");
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Marcar como Perdido</p>
            <p className="modal-email">{prospectoPerdiendo.nombre}</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Por qué se perdió este prospecto o por qué ya no se le dio seguimiento?
            </p>
            <textarea
              autoFocus
              placeholder="Ej. Ya no contestó llamadas ni mensajes"
              value={comentarioPerdido}
              onChange={(e) => setComentarioPerdido(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="tel-borrar-btn"
                onClick={() => {
                  setProspectoPerdiendo(null);
                  setComentarioPerdido("");
                }}
              >
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarProspectoPerdido}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
