"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { empresasDistintas } from "@/lib/empresa";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

type Contacto = { id: string; empresa: string; nombre: string; fecha_nacimiento: string; email: string | null };
type Evento = { id: string; titulo: string; descripcion: string | null; fecha: string; hora: string | null; lugar: string | null };
type Pregunta = { id: string; texto: string; tipo: "rating" | "texto" };
type Encuesta = { id: string; titulo: string; descripcion: string | null; preguntas: Pregunta[]; created_at: string };
type Envio = {
  id: string;
  token: string;
  nombre_destinatario: string;
  email_destinatario: string;
  estado: string;
  cliente_id: string | null;
  contacto_id: string | null;
};
type ClientePortal = { id: string; nombre: string; email: string; empresa: string | null };

// Días hasta el próximo cumpleaños, comparando solo día+mes (recurrencia
// anual) — el año guardado en fecha_nacimiento es irrelevante aquí.
function diasHastaProximoCumple(fechaNacimiento: string): number {
  const hoy = new Date();
  const [, mes, dia] = fechaNacimiento.split("-").map(Number);
  let proximo = new Date(hoy.getFullYear(), mes - 1, dia);
  proximo.setHours(0, 0, 0, 0);
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (proximo < hoySinHora) proximo = new Date(hoy.getFullYear() + 1, mes - 1, dia);
  return Math.round((proximo.getTime() - hoySinHora.getTime()) / 86400000);
}

export default function ExperienciaClientePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [miId, setMiId] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [tab, setTab] = useState<"calendario" | "cumpleanos" | "eventos" | "encuestas">("calendario");

  const esGlobal = ROLES_GLOBALES.includes(miRol);
  // El apartado de Encuestas es solo para superadmin — el resto de roles
  // (incluyendo "admin" de centro) ni siquiera ve la pestaña.
  const puedeVerEncuestas = miRol === "superadmin";

  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [empresasDisponibles, setEmpresasDisponibles] = useState<string[]>([]);
  const [encuestas, setEncuestas] = useState<Encuesta[]>([]);
  const [clientesPortal, setClientesPortal] = useState<ClientePortal[]>([]);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setMiId(user.id);
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    const [{ data: contactosData }, { data: eventosData }, { data: perfilesCentro }, { data: encuestasData }, { data: clientesData }] =
      await Promise.all([
        supabase.from("clientes").select("*").eq("centro", c).order("nombre"),
        supabase.from("eventos_centro").select("*").eq("centro", c).order("fecha"),
        supabase.from("profiles").select("empresa").eq("centro", c).eq("rol", "cliente"),
        supabase.from("encuestas").select("*").eq("centro", c).order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, nombre, email, empresa").eq("centro", c).eq("rol", "cliente").order("nombre"),
      ]);
    setContactos(contactosData || []);
    setEventos(eventosData || []);
    setEmpresasDisponibles(empresasDistintas(perfilesCentro || []));
    setEncuestas(encuestasData || []);
    setClientesPortal(clientesData || []);
    setLoading(false);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Experiencia de Cliente</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content">
        {!centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : loading ? (
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
            <div className="centro-tabs" style={{ marginBottom: 12 }}>
              {[
                { id: "calendario", label: "📅 Calendario" },
                { id: "cumpleanos", label: "🎂 Cumpleaños" },
                { id: "eventos", label: "🎪 Eventos" },
                ...(puedeVerEncuestas ? [{ id: "encuestas", label: "📋 Encuestas" }] : []),
              ].map((t) => (
                <button key={t.id} className={"centro-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id as any)}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "calendario" && <TabCalendario contactos={contactos} eventos={eventos} />}
            {tab === "cumpleanos" && (
              <TabCumpleanos
                contactos={contactos}
                empresasDisponibles={empresasDisponibles}
                centro={centro}
                miId={miId}
                onCambio={() => fetchTodo(centro)}
              />
            )}
            {tab === "eventos" && <TabEventos eventos={eventos} centro={centro} miId={miId} onCambio={() => fetchTodo(centro)} />}
            {tab === "encuestas" && puedeVerEncuestas && (
              <TabEncuestas
                encuestas={encuestas}
                centro={centro}
                miId={miId}
                clientesPortal={clientesPortal}
                contactos={contactos}
                onCambio={() => fetchTodo(centro)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================= Calendario =============================

function TabCalendario({ contactos, eventos }: { contactos: Contacto[]; eventos: Evento[] }) {
  const hoy = new Date();
  const [mesVisto, setMesVisto] = useState(hoy.getMonth());
  const [anioVisto, setAnioVisto] = useState(hoy.getFullYear());
  const [diaAbierto, setDiaAbierto] = useState<number | null>(null);

  const primerDiaSemana = new Date(anioVisto, mesVisto, 1).getDay();
  const diasEnMes = new Date(anioVisto, mesVisto + 1, 0).getDate();

  const cumplesPorDia = useMemo(() => {
    const map: Record<number, Contacto[]> = {};
    contactos.forEach((c) => {
      const [, mes, dia] = c.fecha_nacimiento.split("-").map(Number);
      if (mes - 1 === mesVisto) {
        map[dia] = map[dia] || [];
        map[dia].push(c);
      }
    });
    return map;
  }, [contactos, mesVisto]);

  const eventosPorDia = useMemo(() => {
    const map: Record<number, Evento[]> = {};
    eventos.forEach((e) => {
      const [anio, mes, dia] = e.fecha.split("-").map(Number);
      if (mes - 1 === mesVisto && anio === anioVisto) {
        map[dia] = map[dia] || [];
        map[dia].push(e);
      }
    });
    return map;
  }, [eventos, mesVisto, anioVisto]);

  function cambiarMes(delta: number) {
    let m = mesVisto + delta;
    let a = anioVisto;
    if (m < 0) {
      m = 11;
      a--;
    } else if (m > 11) {
      m = 0;
      a++;
    }
    setMesVisto(m);
    setAnioVisto(a);
    setDiaAbierto(null);
  }

  const celdas: (number | null)[] = [...Array(primerDiaSemana).fill(null), ...Array.from({ length: diasEnMes }, (_, i) => i + 1)];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => cambiarMes(-1)}>
          ‹ Anterior
        </button>
        <p className="panel-section-label" style={{ margin: 0 }}>
          {MESES[mesVisto]} {anioVisto}
        </p>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => cambiarMes(1)}>
          Siguiente ›
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#999", fontWeight: 600 }}>
            {d}
          </div>
        ))}
        {celdas.map((dia, i) => {
          const tieneCumples = dia && cumplesPorDia[dia]?.length > 0;
          const tieneEventos = dia && eventosPorDia[dia]?.length > 0;
          return (
            <div
              key={i}
              onClick={() => dia && (tieneCumples || tieneEventos) && setDiaAbierto(diaAbierto === dia ? null : dia)}
              style={{
                minHeight: 44,
                borderRadius: 8,
                background: dia ? "#F7F7F7" : "transparent",
                padding: 4,
                cursor: dia && (tieneCumples || tieneEventos) ? "pointer" : "default",
                border: diaAbierto === dia ? "2px solid #0d1b3e" : "1px solid transparent",
              }}
            >
              {dia && (
                <>
                  <p style={{ fontSize: 12, margin: 0, color: "#555" }}>{dia}</p>
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {tieneCumples && <span style={{ fontSize: 11 }}>🎂</span>}
                    {tieneEventos && <span style={{ fontSize: 11 }}>🎪</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {diaAbierto && (
        <div className="form-card" style={{ marginTop: 12 }}>
          <p className="sub-label">
            {diaAbierto} de {MESES[mesVisto]}
          </p>
          {(cumplesPorDia[diaAbierto] || []).map((c) => (
            <p className="contrato-detalle" key={c.id}>
              🎂 {c.nombre} — {c.empresa}
            </p>
          ))}
          {(eventosPorDia[diaAbierto] || []).map((e) => (
            <p className="contrato-detalle" key={e.id}>
              🎪 {e.titulo} {e.hora ? `· ${e.hora}` : ""} {e.lugar ? `· ${e.lugar}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================= Cumpleaños =============================

function TabCumpleanos({
  contactos,
  empresasDisponibles,
  centro,
  miId,
  onCambio,
}: {
  contactos: Contacto[];
  empresasDisponibles: string[];
  centro: string;
  miId: string;
  onCambio: () => void;
}) {
  const supabase = createClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({ empresa: "", nombre: "", fecha_nacimiento: "", email: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const ordenados = useMemo(
    () => [...contactos].sort((a, b) => diasHastaProximoCumple(a.fecha_nacimiento) - diasHastaProximoCumple(b.fecha_nacimiento)),
    [contactos]
  );

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.empresa || !form.nombre.trim() || !form.fecha_nacimiento) {
      setError("Completa empresa, nombre y fecha de nacimiento");
      return;
    }
    setGuardando(true);
    const { error: insertError } = await supabase.from("clientes").insert({
      centro,
      empresa: form.empresa,
      nombre: form.nombre.trim(),
      fecha_nacimiento: form.fecha_nacimiento,
      email: form.email.trim() || null,
      created_by: miId,
    });
    setGuardando(false);
    if (insertError) {
      setError("No se pudo guardar el contacto");
      return;
    }
    setForm({ empresa: "", nombre: "", fecha_nacimiento: "", email: "" });
    setMostrarForm(false);
    onCambio();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este contacto?")) return;
    await supabase.from("clientes").delete().eq("id", id);
    onCambio();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="panel-section-label" style={{ margin: 0 }}>
          🎂 Contactos ({contactos.length})
        </p>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Nuevo contacto"}
        </button>
      </div>

      {mostrarForm && (
        <form className="form-card" onSubmit={guardar}>
          {empresasDisponibles.length === 0 ? (
            <p style={{ fontSize: 13, color: "#A32D2D" }}>
              Todavía no hay ninguna empresa capturada en este centro — da de alta un cliente desde /alta-cliente primero.
            </p>
          ) : (
            <>
              <p className="sub-label">Empresa</p>
              <select value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })}>
                <option value="">Selecciona una empresa</option>
                {empresasDisponibles.map((emp) => (
                  <option key={emp} value={emp}>
                    {emp}
                  </option>
                ))}
              </select>
              <p className="sub-label">Nombre</p>
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              <p className="sub-label">Fecha de nacimiento</p>
              <input
                type="date"
                value={form.fecha_nacimiento}
                onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })}
              />
              <p className="sub-label">Correo (opcional)</p>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
              <button className={"btn-enviar" + (guardando ? " sending" : "")} type="submit" disabled={guardando}>
                <span className="btn-enviar-text">+ Guardar contacto</span>
              </button>
            </>
          )}
        </form>
      )}

      {ordenados.length === 0 ? (
        <div className="empty-card">Sin contactos registrados en {centro}</div>
      ) : (
        ordenados.map((c) => {
          const dias = diasHastaProximoCumple(c.fecha_nacimiento);
          return (
            <div className="contrato-card-admin" key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p className="contrato-cliente-nombre">{c.nombre}</p>
                  <p className="contrato-detalle">{c.empresa}</p>
                  <p className="contrato-detalle">
                    {dias === 0 ? "🎉 ¡Hoy!" : dias === 1 ? "Mañana" : `En ${dias} días`}
                  </p>
                </div>
                <button className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={() => eliminar(c.id)}>
                  Eliminar
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ============================= Eventos =============================

function TabEventos({
  eventos,
  centro,
  miId,
  onCambio,
}: {
  eventos: Evento[];
  centro: string;
  miId: string;
  onCambio: () => void;
}) {
  const supabase = createClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({ titulo: "", descripcion: "", fecha: "", hora: "", lugar: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.titulo.trim() || !form.fecha) {
      setError("Completa título y fecha");
      return;
    }
    setGuardando(true);
    const { error: insertError } = await supabase.from("eventos_centro").insert({
      centro,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      fecha: form.fecha,
      hora: form.hora.trim() || null,
      lugar: form.lugar.trim() || null,
      created_by: miId,
    });
    setGuardando(false);
    if (insertError) {
      setError("No se pudo guardar el evento");
      return;
    }
    setForm({ titulo: "", descripcion: "", fecha: "", hora: "", lugar: "" });
    setMostrarForm(false);
    onCambio();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este evento?")) return;
    await supabase.from("eventos_centro").delete().eq("id", id);
    onCambio();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="panel-section-label" style={{ margin: 0 }}>
          🎪 Eventos ({eventos.length})
        </p>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Nuevo evento"}
        </button>
      </div>

      {mostrarForm && (
        <form className="form-card" onSubmit={guardar}>
          <p className="sub-label">Título</p>
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          <div className="tel-form-grid">
            <div>
              <p className="sub-label">Fecha</p>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <div>
              <p className="sub-label">Hora (opcional)</p>
              <input placeholder="17:00" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} />
            </div>
            <div>
              <p className="sub-label">Lugar (opcional)</p>
              <input value={form.lugar} onChange={(e) => setForm({ ...form, lugar: e.target.value })} />
            </div>
          </div>
          <p className="sub-label">Descripción (opcional)</p>
          <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          <button className={"btn-enviar" + (guardando ? " sending" : "")} type="submit" disabled={guardando}>
            <span className="btn-enviar-text">+ Guardar evento</span>
          </button>
        </form>
      )}

      {eventos.length === 0 ? (
        <div className="empty-card">Sin eventos registrados en {centro}</div>
      ) : (
        eventos.map((e) => (
          <div className="contrato-card-admin" key={e.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p className="contrato-cliente-nombre">{e.titulo}</p>
                <p className="contrato-detalle">
                  {e.fecha} {e.hora ? `· ${e.hora}` : ""} {e.lugar ? `· ${e.lugar}` : ""}
                </p>
                {e.descripcion && <p className="contrato-detalle">{e.descripcion}</p>}
              </div>
              <button className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={() => eliminar(e.id)}>
                Eliminar
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============================= Encuestas =============================

function TabEncuestas({
  encuestas,
  centro,
  miId,
  clientesPortal,
  contactos,
  onCambio,
}: {
  encuestas: Encuesta[];
  centro: string;
  miId: string;
  clientesPortal: ClientePortal[];
  contactos: Contacto[];
  onCambio: () => void;
}) {
  const supabase = createClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<{ titulo: string; descripcion: string; preguntas: Pregunta[] }>({
    titulo: "",
    descripcion: "",
    preguntas: [],
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function agregarPregunta(tipo: "rating" | "texto") {
    setForm({
      ...form,
      preguntas: [...form.preguntas, { id: crypto.randomUUID(), texto: "", tipo }],
    });
  }

  function actualizarPregunta(id: string, texto: string) {
    setForm({ ...form, preguntas: form.preguntas.map((p) => (p.id === id ? { ...p, texto } : p)) });
  }

  function quitarPregunta(id: string) {
    setForm({ ...form, preguntas: form.preguntas.filter((p) => p.id !== id) });
  }

  function empezarEdicion(enc: Encuesta) {
    setEditandoId(enc.id);
    setForm({ titulo: enc.titulo, descripcion: enc.descripcion || "", preguntas: enc.preguntas });
    setMostrarForm(true);
  }

  function cancelarForm() {
    setMostrarForm(false);
    setEditandoId(null);
    setForm({ titulo: "", descripcion: "", preguntas: [] });
    setError("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.titulo.trim() || form.preguntas.length === 0 || form.preguntas.some((p) => !p.texto.trim())) {
      setError("Completa el título y todas las preguntas (agrega al menos una)");
      return;
    }
    setGuardando(true);

    if (editandoId) {
      const { error: updateError } = await supabase
        .from("encuestas")
        .update({ titulo: form.titulo.trim(), descripcion: form.descripcion.trim() || null, preguntas: form.preguntas })
        .eq("id", editandoId);
      setGuardando(false);
      if (updateError) {
        setError("No se pudo guardar la encuesta");
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("encuestas").insert({
        centro,
        titulo: form.titulo.trim(),
        descripcion: form.descripcion.trim() || null,
        preguntas: form.preguntas,
        created_by: miId,
      });
      setGuardando(false);
      if (insertError) {
        setError("No se pudo guardar la encuesta");
        return;
      }
    }

    cancelarForm();
    onCambio();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta encuesta? También se borrarán sus envíos y respuestas.")) return;
    await supabase.from("encuestas").delete().eq("id", id);
    onCambio();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="panel-section-label" style={{ margin: 0 }}>
          📋 Encuestas ({encuestas.length})
        </p>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => (mostrarForm ? cancelarForm() : setMostrarForm(true))}>
          {mostrarForm ? "Cancelar" : "+ Nueva encuesta"}
        </button>
      </div>

      {mostrarForm && (
        <form className="form-card" onSubmit={guardar}>
          <p className="sub-label">Título</p>
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          <p className="sub-label">Descripción (opcional)</p>
          <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />

          <p className="sub-label" style={{ marginTop: 8 }}>
            Preguntas
          </p>
          {form.preguntas.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#999", minWidth: 60 }}>{p.tipo === "rating" ? "1-5" : "Texto"}</span>
              <input
                style={{ flex: 1 }}
                placeholder={`Pregunta ${i + 1}`}
                value={p.texto}
                onChange={(e) => actualizarPregunta(p.id, e.target.value)}
              />
              <button type="button" className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={() => quitarPregunta(p.id)}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="tel-borrar-btn" style={{ color: "#0d1b3e" }} onClick={() => agregarPregunta("rating")}>
              + Pregunta 1-5
            </button>
            <button type="button" className="tel-borrar-btn" style={{ color: "#0d1b3e" }} onClick={() => agregarPregunta("texto")}>
              + Pregunta de texto
            </button>
          </div>

          {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}
          <button className={"btn-enviar" + (guardando ? " sending" : "")} type="submit" disabled={guardando} style={{ marginTop: 8 }}>
            <span className="btn-enviar-text">{editandoId ? "Guardar cambios" : "+ Crear encuesta"}</span>
          </button>
        </form>
      )}

      {encuestas.length === 0 ? (
        <div className="empty-card">Sin encuestas creadas en {centro}</div>
      ) : (
        encuestas.map((enc) => (
          <TarjetaEncuesta
            key={enc.id}
            encuesta={enc}
            clientesPortal={clientesPortal}
            contactos={contactos}
            onEditar={() => empezarEdicion(enc)}
            onEliminar={() => eliminar(enc.id)}
          />
        ))
      )}
    </div>
  );
}

function TarjetaEncuesta({
  encuesta,
  clientesPortal,
  contactos,
  onEditar,
  onEliminar,
}: {
  encuesta: Encuesta;
  clientesPortal: ClientePortal[];
  contactos: Contacto[];
  onEditar: () => void;
  onEliminar: () => void;
}) {
  const supabase = createClient();
  const [expandida, setExpandida] = useState(false);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [cargandoEnvios, setCargandoEnvios] = useState(false);
  const [seleccionPortal, setSeleccionPortal] = useState<Set<string>>(new Set());
  const [seleccionContactos, setSeleccionContactos] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [copiadoToken, setCopiadoToken] = useState<string | null>(null);

  async function cargarEnvios() {
    setCargandoEnvios(true);
    const { data } = await supabase
      .from("encuestas_envios")
      .select("id, token, nombre_destinatario, email_destinatario, estado, cliente_id, contacto_id")
      .eq("encuesta_id", encuesta.id)
      .order("enviado_en", { ascending: false });
    setEnvios(data || []);
    setCargandoEnvios(false);
  }

  function toggleExpandida() {
    if (!expandida) cargarEnvios();
    setExpandida(!expandida);
  }

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function enviar() {
    if (seleccionPortal.size === 0 && seleccionContactos.size === 0) return;
    setEnviando(true);

    const destinatarios: { nombre: string; email: string; cliente_id: string | null; contacto_id: string | null }[] = [];
    clientesPortal
      .filter((c) => seleccionPortal.has(c.id))
      .forEach((c) => destinatarios.push({ nombre: c.nombre, email: c.email, cliente_id: c.id, contacto_id: null }));
    contactos
      .filter((c) => seleccionContactos.has(c.id) && c.email)
      .forEach((c) => destinatarios.push({ nombre: c.nombre, email: c.email as string, cliente_id: null, contacto_id: c.id }));

    for (const d of destinatarios) {
      const { data: nuevoEnvio, error: insertError } = await supabase
        .from("encuestas_envios")
        .insert({
          encuesta_id: encuesta.id,
          cliente_id: d.cliente_id,
          contacto_id: d.contacto_id,
          nombre_destinatario: d.nombre,
          email_destinatario: d.email,
        })
        .select("id, token")
        .single();

      if (insertError || !nuevoEnvio) continue;

      if (d.cliente_id) {
        await supabase.from("notificaciones").insert({
          user_id: d.cliente_id,
          tipo: "encuesta_pendiente",
          mensaje: `📝 Tienes una nueva encuesta pendiente: "${encuesta.titulo}"`,
        });
      }

      const link = `${window.location.origin}/encuesta/${nuevoEnvio.token}`;
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            tipo: "comunicado",
            destinatarios: [d.email],
            asunto: `Encuesta: ${encuesta.titulo}`,
            cuerpo: `<p>Hola ${d.nombre},</p><p>Nos gustaría conocer tu opinión. Responde aquí:</p><p><a href="${link}">${link}</a></p>`,
          },
        });
      } catch {
        // best-effort — el envío ya quedó guardado, se puede reenviar el link manualmente
      }
    }

    setEnviando(false);
    setSeleccionPortal(new Set());
    setSeleccionContactos(new Set());
    cargarEnvios();
  }

  function copiarLink(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/encuesta/${token}`);
    setCopiadoToken(token);
    setTimeout(() => setCopiadoToken(null), 1500);
  }

  return (
    <div className="contrato-card-admin">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="contrato-cliente-nombre">{encuesta.titulo}</p>
          {encuesta.descripcion && <p className="contrato-detalle">{encuesta.descripcion}</p>}
          <p className="contrato-detalle">{encuesta.preguntas.length} pregunta(s)</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={onEditar}>
            ✎ Editar
          </button>
          <button className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={onEliminar}>
            🗑 Eliminar
          </button>
        </div>
      </div>

      <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 8 }} onClick={toggleExpandida}>
        {expandida ? "Ocultar envíos" : "Ver / mandar envíos"}
      </button>

      {expandida && (
        <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
          {cargandoEnvios ? (
            <p style={{ fontSize: 12, color: "#888" }}>Cargando...</p>
          ) : (
            <>
              {envios.length === 0 ? (
                <p style={{ fontSize: 12, color: "#aaa" }}>Sin envíos todavía.</p>
              ) : (
                envios.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                    <span style={{ fontSize: 12, color: "#555" }}>
                      {e.nombre_destinatario} · {e.estado === "pendiente" ? "⏳ Pendiente" : "✓ Respondida"}
                    </span>
                    {e.estado === "pendiente" && (
                      <button className="tel-borrar-btn" style={{ color: "#0d1b3e" }} onClick={() => copiarLink(e.token)}>
                        {copiadoToken === e.token ? "✓ Copiado" : "📋 Copiar link"}
                      </button>
                    )}
                  </div>
                ))
              )}

              <p className="sub-label" style={{ marginTop: 12 }}>
                Mandar a nuevos destinatarios
              </p>
              <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
                {clientesPortal.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0" }}>
                    <input
                      type="checkbox"
                      checked={seleccionPortal.has(c.id)}
                      onChange={() => toggle(seleccionPortal, c.id, setSeleccionPortal)}
                    />
                    {c.nombre} ({c.email})
                  </label>
                ))}
                {contactos
                  .filter((c) => c.email)
                  .map((c) => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0" }}>
                      <input
                        type="checkbox"
                        checked={seleccionContactos.has(c.id)}
                        onChange={() => toggle(seleccionContactos, c.id, setSeleccionContactos)}
                      />
                      {c.nombre} ({c.email}) · sin cuenta
                    </label>
                  ))}
              </div>
              <button
                className={"btn-enviar" + (enviando ? " sending" : "")}
                type="button"
                disabled={enviando || (seleccionPortal.size === 0 && seleccionContactos.size === 0)}
                style={{ marginTop: 8 }}
                onClick={enviar}
              >
                <span className="btn-enviar-text">Enviar encuesta</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
