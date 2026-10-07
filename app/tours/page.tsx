"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tour = {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  fecha: string;
  hora: string | null;
  notas: string | null;
  tipo_espacio_interes: string | null;
  centro?: string | null;
};

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "atencion_cliente", "gerente_ventas"];
// Las cuentas globales no tienen centro fijo: eligen en el formulario a
// qué centro va el tour (antes no podían agendar y el aviso decía que
// faltaba nombre/fecha).
const CENTROS_TOUR = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const TIPOS_ESPACIO_INTERES = ["Coworking", "Oficina Privada", "Working Desk", "Sala de Juntas"];

function hoyISO() {
  return new Date().toISOString().split("T")[0];
}

export default function ToursPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [centro, setCentro] = useState<string | null>(null);
  const [miRol, setMiRol] = useState("");
  const [tours, setTours] = useState<Tour[]>([]);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    correo: "",
    fecha: hoyISO(),
    hora: "",
    tipoEspacioInteres: "",
    notas: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [centroTour, setCentroTour] = useState(CENTROS_TOUR[0]);
  const [borrandoTourId, setBorrandoTourId] = useState<string | null>(null);
  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    setMiRol(profile?.rol || "");
    const c = profile?.centro || null;
    setCentro(c);
    if (c) setCentroTour(c);
    // Los globales ven los tours de todos los centros aunque su perfil no
    // tenga centro.
    if (c || ROLES_GLOBALES.includes(profile?.rol || "")) await fetchTours(c, profile?.rol || "");
    setLoading(false);
  }

  async function fetchTours(c: string | null, rol: string) {
    let query = supabase.from("tours").select("*").order("fecha").order("hora");
    if (!ROLES_GLOBALES.includes(rol) && c) query = query.eq("centro", c);
    const { data } = await query;
    setTours(data || []);
  }

  // Búsqueda por nombre o teléfono — mismo patrón que /contratos.
  const [busquedaTours, setBusquedaTours] = useState("");
  const toursFiltrados = useMemo(() => {
    const q = busquedaTours.trim().toLowerCase();
    if (!q) return tours;
    return tours.filter(
      (t) => t.nombre.toLowerCase().includes(q) || (t.telefono || "").toLowerCase().includes(q)
    );
  }, [tours, busquedaTours]);

  const tourseHoy = useMemo(() => toursFiltrados.filter((t) => t.fecha === hoyISO()), [toursFiltrados]);
  const tourseProximos = useMemo(
    () => toursFiltrados.filter((t) => t.fecha > hoyISO()).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [toursFiltrados]
  );

  async function agregarTour(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const centroDestino = esGlobal ? centroTour : centro;
    if (!form.nombre.trim() || !form.fecha) {
      setError("Nombre y fecha son obligatorios");
      return;
    }
    if (!centroDestino) {
      setError("Tu cuenta no tiene un centro asignado; pide que te asignen uno.");
      return;
    }
    setGuardando(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: nuevo, error: insertError } = await supabase
      .from("tours")
      .insert({
        centro: centroDestino,
        nombre: form.nombre,
        telefono: form.telefono || null,
        correo: form.correo || null,
        fecha: form.fecha,
        hora: form.hora || null,
        tipo_espacio_interes: form.tipoEspacioInteres || null,
        notas: form.notas || null,
        registrado_por: user?.id,
      })
      .select()
      .single();

    if (insertError) {
      setError("No se pudo guardar el tour. Intenta de nuevo.");
      setGuardando(false);
      return;
    }

    // Si el tour es para hoy, se manda una notificación de una vez
    if (form.fecha === hoyISO() && nuevo) {
      await supabase.from("notificaciones").insert({
        centro: centroDestino,
        tipo: "nuevo_tour",
        mensaje: `Hoy tienes un tour que programaste: ${form.nombre}${form.hora ? ` a las ${form.hora}` : ""}.`,
      });
    }

    // Correo de confirmación — no bloquea el guardado del tour si falla
    // (ej. proveedor de correo sin configurar todavía).
    if (form.correo && nuevo) {
      fetch("/api/tours-confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourId: nuevo.id }),
      }).catch(() => {});
    }

    setForm({ nombre: "", telefono: "", correo: "", fecha: hoyISO(), hora: "", tipoEspacioInteres: "", notas: "" });
    setMostrarForm(false);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTours(centro, miRol);
  }

  async function borrarTour(id: string) {
    setBorrandoTourId(null);
    await supabase.from("tours").delete().eq("id", id);
    fetchTours(centro, miRol);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Tours</p>
        <p className="rep-sub">{esGlobal ? "Todos los centros" : centro || "Selecciona un centro"}</p>
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
            <div className="tours-hoy-card">
              <p className="tours-hoy-titulo">
                {tourseHoy.length === 0
                  ? "Hoy no tienes tours"
                  : `Hoy tienes ${tourseHoy.length} tour${tourseHoy.length > 1 ? "s" : ""}: ${tourseHoy
                      .map((t) => t.nombre)
                      .join(", ")}`}
              </p>
              {tourseHoy.length === 0 ? (
                <p className="tours-hoy-vacio">Cuando agendes uno, va a aparecer aquí.</p>
              ) : (
                tourseHoy.map((t) => (
                  <div className="tour-hoy-item" key={t.id}>
                    <span className="tour-hoy-nombre">{t.nombre}</span>
                    <span className="tour-hoy-hora">{t.hora || "Sin hora"}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Agendar tour
              </p>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => setMostrarForm((v) => !v)}
              >
                {mostrarForm ? "Cancelar" : "+ Agregar"}
              </button>
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={agregarTour}>
                <div className="tel-form-grid">
                  {esGlobal && (
                    <select value={centroTour} onChange={(e) => setCentroTour(e.target.value)} title="Centro del tour">
                      {CENTROS_TOUR.map((c) => (
                        <option key={c} value={c}>
                          🏢 {c}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    placeholder="Nombre de quien hace el tour"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  />
                  <input
                    placeholder="Teléfono (opcional)"
                    value={form.telefono}
                    onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                  />
                  <input
                    type="email"
                    placeholder="Correo (para confirmación y recordatorio)"
                    value={form.correo}
                    onChange={(e) => setForm({ ...form, correo: e.target.value })}
                  />
                  <select
                    value={form.tipoEspacioInteres}
                    onChange={(e) => setForm({ ...form, tipoEspacioInteres: e.target.value })}
                  >
                    <option value="">¿Qué espacio le interesó?</option>
                    {TIPOS_ESPACIO_INTERES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  />
                  <input
                    type="time"
                    value={form.hora}
                    onChange={(e) => setForm({ ...form, hora: e.target.value })}
                  />
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
                  <span className="btn-enviar-text">+ Agendar tour</span>
                </button>
              </form>
            )}

            <input
              placeholder="Buscar por nombre o teléfono..."
              value={busquedaTours}
              onChange={(e) => setBusquedaTours(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8 }}
            />

            <p className="panel-section-label" style={{ marginTop: 8 }}>
              Próximos tours ({tourseProximos.length})
            </p>
            {tourseProximos.length === 0 ? (
              <div className="empty-card">
                {busquedaTours ? "Sin tours que coincidan con la búsqueda" : "Sin tours próximos agendados"}
              </div>
            ) : (
              tourseProximos.map((t) => (
                <div className="tour-card" key={t.id}>
                  <div className="tour-fecha-badge">
                    {new Date(t.fecha + "T00:00:00").toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                    })}
                    {t.hora ? ` · ${t.hora}` : ""}
                  </div>
                  <div style={{ flex: 1, marginLeft: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>{t.nombre}</p>
                    {t.telefono && <p style={{ fontSize: 12, color: "#888", margin: 0 }}>{t.telefono}</p>}
                    {t.tipo_espacio_interes && (
                      <p style={{ fontSize: 12, color: "#0d1b3e", margin: 0 }}>📌 {t.tipo_espacio_interes}</p>
                    )}
                    {esGlobal && t.centro && <p style={{ fontSize: 12, color: "#888", margin: 0 }}>🏢 {t.centro}</p>}
                  </div>
                  <button className="tel-borrar-btn" onClick={() => setBorrandoTourId(t.id)}>
                    🗑
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {borrandoTourId && (
        <div className="modal-overlay" onClick={() => setBorrandoTourId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Borrar tour</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Borrar este tour?
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setBorrandoTourId(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => borrarTour(borrandoTourId)}>
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
