"use client";

import { type ReactNode, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fechaLocal, hoyMexicoISO } from "@/lib/fechaMexico";
import {
  ESPACIOS_TOUR,
  actualizarTourDeActividad,
  borrarTourDeActividad,
  crearTourDeActividad,
  espacioSugerido,
} from "./tourDesdeSeguimiento";

// Ver migracion_prospectos_actividades.sql.
export type ActividadProspecto = {
  id: string;
  prospecto_id: string;
  tipo: string;
  tipo_otro: string | null;
  descripcion: string | null;
  fecha: string;
  completada: boolean;
  completada_en: string | null;
  completada_por: string | null;
  creado_por: string | null;
  created_at: string;
  // Solo tours: hora, espacio y el tour ligado en el módulo de Tours.
  hora?: string | null;
  tipo_espacio_interes?: string | null;
  tour_id?: string | null;
};

export const TIPOS_ACTIVIDAD: Record<string, { label: string; icono: string }> = {
  correo: { label: "Correo", icono: "✉️" },
  mensaje: { label: "Mensaje", icono: "💬" },
  llamada: { label: "Llamada", icono: "📞" },
  tour: { label: "Tour", icono: "🏢" },
  otro: { label: "Otro", icono: "📌" },
};

export function etiquetaActividad(a: Pick<ActividadProspecto, "tipo" | "tipo_otro">) {
  const t = TIPOS_ACTIVIDAD[a.tipo] || TIPOS_ACTIVIDAD.otro;
  return `${t.icono} ${a.tipo === "otro" && a.tipo_otro ? a.tipo_otro : t.label}`;
}

// "11:00:00" (columna time) → "11:00"
export function horaCorta(h: string | null | undefined) {
  return h ? h.slice(0, 5) : "";
}

export function formatoFechaCorta(f: string) {
  return fechaLocal(f).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

// Pendiente cuya fecha ya pasó (comparando en horario de México).
export function estaAtrasada(a: Pick<ActividadProspecto, "completada" | "fecha">) {
  return !a.completada && a.fecha < hoyMexicoISO();
}

// Pendientes primero (la más próxima arriba), luego las completadas (la más reciente arriba).
export function ordenarActividades(lista: ActividadProspecto[]) {
  const pendientes = lista.filter((a) => !a.completada).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const hechas = lista
    .filter((a) => a.completada)
    .sort((a, b) => (b.completada_en || b.fecha).localeCompare(a.completada_en || a.fecha));
  return { pendientes, hechas };
}

type ProspectoSeguimiento = {
  id: string;
  nombre: string;
  centro?: string | null;
  estado: string;
  telefono?: string | null;
  email?: string | null;
  interes?: string | null;
};

type Formulario = {
  tipo: string;
  tipoOtro: string;
  descripcion: string;
  fecha: string;
  yaSeHizo: boolean;
  // Solo tours.
  hora: string;
  espacio: string;
};

const SUGERENCIA_PRIMERA = "Contactar al prospecto";

function formularioVacio(esPrimera: boolean, espacio = ""): Formulario {
  return {
    tipo: "",
    tipoOtro: "",
    descripcion: esPrimera ? SUGERENCIA_PRIMERA : "",
    fecha: hoyMexicoISO(),
    yaSeHizo: false,
    hora: "",
    espacio,
  };
}

function validar(f: Formulario): string | null {
  if (!f.tipo) return "Elige el tipo de actividad.";
  if (f.tipo === "otro" && !f.tipoOtro.trim()) return "Escribe cuál otro medio fue.";
  if (!f.fecha) return "Elige la fecha.";
  if (f.tipo === "tour" && !f.hora) return "Elige la hora del tour.";
  return null;
}

function datosParaGuardar(f: Formulario) {
  return {
    tipo: f.tipo,
    tipo_otro: f.tipo === "otro" ? f.tipoOtro.trim() : null,
    descripcion: f.descripcion.trim() || null,
    fecha: f.fecha,
    hora: f.tipo === "tour" ? f.hora : null,
    tipo_espacio_interes: f.tipo === "tour" ? f.espacio || null : null,
  };
}

// Si la tabla no existe todavía, la migración no se ha corrido en Supabase.
function mensajeError(mensaje: string, detalle?: string) {
  if (detalle && /prospecto_actividades/.test(detalle) && /does not exist|schema cache/i.test(detalle)) {
    return "Falta correr migracion_prospectos_actividades.sql en Supabase.";
  }
  return mensaje;
}

// Tipo, "¿cuál otro?", descripción, fecha (y hora/espacio si es tour) del formulario "Agregar actividad". La
// edición dentro de la tarjeta usa una versión compacta (ver renderEdicion).
function CamposActividad({
  form,
  onChange,
  etiquetaFecha,
  antesDeFecha,
}: {
  form: Formulario;
  onChange: (f: Formulario) => void;
  etiquetaFecha: string;
  antesDeFecha?: ReactNode;
}) {
  return (
    <>
      <div className="seg-tipos">
        {Object.entries(TIPOS_ACTIVIDAD).map(([clave, t]) => (
          <button
            key={clave}
            type="button"
            className={`seg-tipo${form.tipo === clave ? " seg-tipo-on" : ""}`}
            onClick={() => onChange({ ...form, tipo: clave })}
            aria-pressed={form.tipo === clave}
          >
            {t.icono} {t.label}
          </button>
        ))}
      </div>
      {form.tipo === "otro" && (
        <input
          type="text"
          placeholder="¿Cuál otro? (ej. Visita a su oficina)"
          value={form.tipoOtro}
          onChange={(e) => onChange({ ...form, tipoOtro: e.target.value })}
          autoFocus
        />
      )}
      <textarea
        placeholder="Descripción breve (ej. Le llamé, pidió cotización para 3 personas)"
        value={form.descripcion}
        onChange={(e) => onChange({ ...form, descripcion: e.target.value })}
      />
      {antesDeFecha}
      <label className="seg-label">
        {etiquetaFecha}
        <input type="date" value={form.fecha} onChange={(e) => onChange({ ...form, fecha: e.target.value })} />
      </label>
      {form.tipo === "tour" && (
        <div className="seg-edit-fila">
          <label className="seg-label">
            Hora del tour
            <input type="time" value={form.hora} onChange={(e) => onChange({ ...form, hora: e.target.value })} />
          </label>
          <label className="seg-label">
            Espacio de interés
            <select value={form.espacio} onChange={(e) => onChange({ ...form, espacio: e.target.value })}>
              <option value="">Sin especificar</option>
              {ESPACIOS_TOUR.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </>
  );
}

interface SeguimientoModalProps {
  prospecto: ProspectoSeguimiento;
  actividades: ActividadProspecto[];
  nombres: Record<string, string>;
  onActividadesChange: (actividades: ActividadProspecto[]) => void;
  // Al completar una actividad de un prospecto en "Nuevo" pasa solo a "Contactado".
  onContactado: () => void;
  onClose: () => void;
}

export default function SeguimientoModal({
  prospecto,
  actividades,
  nombres,
  onActividadesChange,
  onContactado,
  onClose,
}: SeguimientoModalProps) {
  const supabase = createClient();
  const espacioDelProspecto = espacioSugerido(prospecto.interes);
  const [form, setForm] = useState<Formulario>(() => formularioVacio(actividades.length === 0, espacioDelProspecto));
  // "+ Agregar actividad" arriba de la lista: se despliega al darle clic (abierto
  // de entrada si el prospecto todavía no tiene actividades).
  const [agregando, setAgregando] = useState(actividades.length === 0);
  // Resultado del correo de confirmación de la última actividad programada.
  const [avisoCorreo, setAvisoCorreo] = useState<{ ok: boolean; texto: string } | null>(null);
  // Resultado de agendar / actualizar / quitar el tour ligado en Tours.
  const [avisoTour, setAvisoTour] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edición dentro de la tarjeta de la actividad (una a la vez).
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Formulario | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState<string | null>(null);

  const { pendientes, hechas } = ordenarActividades(actividades);

  function marcarContactadoSiAplica() {
    if (prospecto.estado === "nuevo") onContactado();
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    const invalido = validar(form);
    setError(invalido);
    if (invalido) return;

    setGuardando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("prospecto_actividades")
      .insert({
        ...datosParaGuardar(form),
        prospecto_id: prospecto.id,
        creado_por: user?.id,
        ...(form.yaSeHizo ? { completada: true, completada_en: new Date().toISOString(), completada_por: user?.id } : {}),
      })
      .select()
      .single();
    if (err || !data) {
      setGuardando(false);
      setError(mensajeError("No se pudo guardar la actividad. Intenta de nuevo.", err?.message));
      return;
    }
    let nueva = data as ActividadProspecto;
    setAvisoTour(null);
    if (nueva.tipo === "tour") {
      const { tourId, error: errTour } = await crearTourDeActividad(supabase, prospecto, nueva, {
        realizada: form.yaSeHizo,
        usuarioId: user?.id,
      });
      if (tourId) {
        await supabase.from("prospecto_actividades").update({ tour_id: tourId }).eq("id", nueva.id);
        nueva = { ...nueva, tour_id: tourId };
        setAvisoTour({ ok: true, texto: "🏢 El tour también quedó agendado en Tours." });
      } else if (errTour) {
        setAvisoTour({ ok: false, texto: errTour });
      }
    }
    setGuardando(false);
    onActividadesChange([...actividades, nueva]);
    if (form.yaSeHizo) marcarContactadoSiAplica();
    else void mandarConfirmacion(nueva.id);
    setForm(formularioVacio(false, espacioDelProspecto));
    setAgregando(false);
  }

  // Confirmación por correo a quien la programó (ver
  // app/api/prospectos/actividad-programada). Si falla, la actividad ya quedó
  // guardada: solo se avisa.
  async function mandarConfirmacion(actividadId: string) {
    setAvisoCorreo(null);
    try {
      const respuesta = await fetch("/api/prospectos/actividad-programada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actividadId }),
      });
      const cuerpo = await respuesta.json().catch(() => null);
      if (respuesta.ok && cuerpo?.enviado) {
        setAvisoCorreo({ ok: true, texto: "📧 Te enviamos la confirmación a tu correo." });
      } else if (!respuesta.ok) {
        setAvisoCorreo({ ok: false, texto: "La actividad se guardó, pero no se pudo enviar el correo de confirmación." });
      }
    } catch {
      setAvisoCorreo({ ok: false, texto: "La actividad se guardó, pero no se pudo enviar el correo de confirmación." });
    }
  }

  function cancelarAgregar() {
    setAgregando(false);
    setError(null);
    setForm(formularioVacio(false, espacioDelProspecto));
  }

  function empezarEdicion(a: ActividadProspecto) {
    setConfirmandoBorrarId(null);
    setErrorEdicion(null);
    setEditandoId(a.id);
    setEdicion({
      tipo: a.tipo,
      tipoOtro: a.tipo_otro || "",
      descripcion: a.descripcion || "",
      fecha: a.fecha,
      yaSeHizo: false,
      hora: horaCorta(a.hora),
      espacio: a.tipo === "tour" ? a.tipo_espacio_interes || "" : espacioDelProspecto,
    });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setEdicion(null);
    setErrorEdicion(null);
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editandoId || !edicion) return;
    const invalido = validar(edicion);
    setErrorEdicion(invalido);
    if (invalido) return;

    setGuardandoEdicion(true);
    const antes = actividades.find((a) => a.id === editandoId);
    const datos = datosParaGuardar(edicion);
    const { data, error: err } = await supabase
      .from("prospecto_actividades")
      .update(datos)
      .eq("id", editandoId)
      .select()
      .single();
    if (err || !data) {
      setGuardandoEdicion(false);
      setErrorEdicion(mensajeError("No se pudo guardar el cambio. Intenta de nuevo.", err?.message));
      return;
    }

    // Mantener ligado el tour de Tours: se actualiza, se quita (si dejó de ser
    // tour) o se crea (si ahora es tour).
    let actualizada = data as ActividadProspecto;
    setAvisoTour(null);
    if (antes?.tour_id && datos.tipo === "tour") {
      const errTour = await actualizarTourDeActividad(
        supabase,
        antes.tour_id,
        { fecha: antes.fecha, hora: antes.hora ?? null },
        datos
      );
      setAvisoTour(errTour ? { ok: false, texto: errTour } : { ok: true, texto: "🏢 El tour también se actualizó en Tours." });
    } else if (antes?.tour_id) {
      const errTour = await borrarTourDeActividad(supabase, antes.tour_id);
      if (errTour) {
        setAvisoTour({ ok: false, texto: errTour });
      } else {
        await supabase.from("prospecto_actividades").update({ tour_id: null }).eq("id", actualizada.id);
        actualizada = { ...actualizada, tour_id: null };
        setAvisoTour({ ok: true, texto: "🏢 Se quitó el tour de Tours." });
      }
    } else if (datos.tipo === "tour") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { tourId, error: errTour } = await crearTourDeActividad(supabase, prospecto, actualizada, {
        realizada: false,
        usuarioId: user?.id,
      });
      if (tourId) {
        await supabase.from("prospecto_actividades").update({ tour_id: tourId }).eq("id", actualizada.id);
        actualizada = { ...actualizada, tour_id: tourId };
        setAvisoTour({ ok: true, texto: "🏢 El tour también quedó agendado en Tours." });
      } else if (errTour) {
        setAvisoTour({ ok: false, texto: errTour });
      }
    }
    setGuardandoEdicion(false);
    onActividadesChange(actividades.map((a) => (a.id === editandoId ? actualizada : a)));
    cancelarEdicion();
  }

  async function alternarCompletada(a: ActividadProspecto) {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const cambios = a.completada
      ? { completada: false, completada_en: null, completada_por: null }
      : { completada: true, completada_en: new Date().toISOString(), completada_por: user?.id ?? null };
    const { error: err } = await supabase.from("prospecto_actividades").update(cambios).eq("id", a.id);
    if (err) {
      setError(mensajeError("No se pudo actualizar la actividad. Intenta de nuevo.", err.message));
      return;
    }
    onActividadesChange(actividades.map((x) => (x.id === a.id ? { ...x, ...cambios } : x)));
    if (!a.completada) marcarContactadoSiAplica();
    if (editandoId === a.id) cancelarEdicion();
  }

  async function borrar(id: string) {
    setError(null);
    setConfirmandoBorrarId(null);
    setAvisoTour(null);
    // Primero el tour ligado: si no se puede quitar, la actividad no se borra
    // para que no quede un tour sin su actividad.
    const tourId = actividades.find((a) => a.id === id)?.tour_id;
    if (tourId) {
      const errTour = await borrarTourDeActividad(supabase, tourId);
      if (errTour) {
        setError(errTour);
        return;
      }
    }
    const { error: err } = await supabase.from("prospecto_actividades").delete().eq("id", id);
    if (err) {
      setError(mensajeError("No se pudo borrar la actividad. Intenta de nuevo.", err.message));
      return;
    }
    onActividadesChange(actividades.filter((a) => a.id !== id));
    if (editandoId === id) cancelarEdicion();
  }

  function renderEdicion(a: ActividadProspecto) {
    if (!edicion) return null;
    return (
      // Versión compacta: la tarjeta crece poco al editar (tipo y fecha en una
      // línea, descripción corta, botones chicos).
      <form key={a.id} className="seg-item seg-item-editando" onSubmit={guardarEdicion}>
        <div className="seg-edit">
          <div className="seg-edit-fila">
            <select
              aria-label="Tipo de actividad"
              value={edicion.tipo}
              onChange={(e) => setEdicion({ ...edicion, tipo: e.target.value })}
            >
              {Object.entries(TIPOS_ACTIVIDAD).map(([clave, t]) => (
                <option key={clave} value={clave}>
                  {t.icono} {t.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Fecha programada"
              value={edicion.fecha}
              onChange={(e) => setEdicion({ ...edicion, fecha: e.target.value })}
            />
          </div>
          {edicion.tipo === "tour" && (
            <div className="seg-edit-fila">
              <input
                type="time"
                aria-label="Hora del tour"
                value={edicion.hora}
                onChange={(e) => setEdicion({ ...edicion, hora: e.target.value })}
              />
              <select
                aria-label="Espacio de interés"
                value={edicion.espacio}
                onChange={(e) => setEdicion({ ...edicion, espacio: e.target.value })}
              >
                <option value="">Espacio: sin especificar</option>
                {ESPACIOS_TOUR.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          )}
          {edicion.tipo === "otro" && (
            <input
              type="text"
              placeholder="¿Cuál otro?"
              value={edicion.tipoOtro}
              onChange={(e) => setEdicion({ ...edicion, tipoOtro: e.target.value })}
              autoFocus
            />
          )}
          <textarea
            rows={2}
            placeholder="Descripción breve"
            value={edicion.descripcion}
            onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })}
          />
          {errorEdicion && <p className="seg-error">{errorEdicion}</p>}
          <div className="seg-edit-acciones">
            <button type="button" className="seg-btn-mini" onClick={cancelarEdicion}>
              Cancelar
            </button>
            <button type="submit" className="seg-btn-mini seg-btn-mini-primario" disabled={guardandoEdicion}>
              {guardandoEdicion ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  function renderActividad(a: ActividadProspecto) {
    if (editandoId === a.id) return renderEdicion(a);

    const atrasada = estaAtrasada(a);
    const quienCreo = a.creado_por ? nombres[a.creado_por] : null;
    const quienCompleto = a.completada_por ? nombres[a.completada_por] : null;
    return (
      <div key={a.id} className={`seg-item${a.completada ? " seg-item-hecha" : ""}${atrasada ? " seg-item-atrasada" : ""}`}>
        <button
          type="button"
          className={`seg-check${a.completada ? " seg-check-on" : ""}`}
          onClick={() => alternarCompletada(a)}
          aria-label={a.completada ? "Marcar como pendiente" : "Marcar como completada"}
          title={a.completada ? "Marcar como pendiente" : "Marcar como completada"}
        >
          {a.completada ? "✓" : ""}
        </button>
        <div className="seg-item-info">
          <p className="seg-item-tipo">{etiquetaActividad(a)}</p>
          {a.descripcion && <p className="seg-item-desc">{a.descripcion}</p>}
          <p className="seg-item-meta">
            📅 {formatoFechaCorta(a.fecha)}
            {a.hora ? ` · ${horaCorta(a.hora)}` : ""}
            {atrasada && <span className="seg-atrasada-chip">Atrasada</span>}
            {quienCreo ? ` · Registró: ${quienCreo}` : ""}
          </p>
          {a.tipo === "tour" && (a.tipo_espacio_interes || a.tour_id) && (
            <p className="seg-item-meta">
              {a.tipo_espacio_interes ? `Espacio: ${a.tipo_espacio_interes}` : ""}
              {a.tour_id && <span className="seg-en-tours-chip">🏢 Agendado en Tours</span>}
            </p>
          )}
          {a.completada && a.completada_en && (
            <p className="seg-item-meta seg-item-hecha-meta">
              ✔ Hecha el {new Date(a.completada_en).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
              {quienCompleto ? ` por ${quienCompleto}` : ""}
            </p>
          )}
        </div>
        {!a.completada && (
          <div className="seg-item-acciones">
            {confirmandoBorrarId === a.id ? (
              <>
                <span className="seg-item-meta">{a.tour_id ? "¿Borrar? También se quita de Tours" : "¿Borrar?"}</span>
                <button type="button" className="tel-borrar-btn" onClick={() => borrar(a.id)}>
                  Sí
                </button>
                <button
                  type="button"
                  className="tel-borrar-btn"
                  style={{ color: "#555" }}
                  onClick={() => setConfirmandoBorrarId(null)}
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button type="button" className="seg-accion" onClick={() => empezarEdicion(a)} title="Editar">
                  ✏️
                </button>
                <button type="button" className="seg-accion" onClick={() => setConfirmandoBorrarId(a.id)} title="Borrar">
                  🗑
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="seg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="seg-titulo">
        <div className="seg-header">
          <div>
            <p className="seg-header-titulo" id="seg-titulo">
              Seguimiento de prospecto
            </p>
            <p className="seg-header-sub">
              {prospecto.nombre}
              {prospecto.centro ? ` · ${prospecto.centro}` : ""}
            </p>
          </div>
          <button type="button" className="seg-cerrar" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="seg-body">
          {actividades.length > 0 && (
            <p className="seg-progreso">
              {hechas.length} de {actividades.length} {actividades.length === 1 ? "actividad completada" : "actividades completadas"}
            </p>
          )}

          {agregando ? (
            <form className="seg-form seg-form-arriba" onSubmit={agregar}>
              <div className="seg-form-titulo">
                <p className="seg-seccion" style={{ margin: 0 }}>
                  Nueva actividad
                </p>
                {actividades.length > 0 && (
                  <button type="button" className="seg-btn-mini" onClick={cancelarAgregar}>
                    Cancelar
                  </button>
                )}
              </div>
              <CamposActividad
                form={form}
                onChange={setForm}
                etiquetaFecha={form.yaSeHizo ? "Fecha en que se realizó" : "Fecha programada"}
                antesDeFecha={
                  <div className="seg-label" role="radiogroup" aria-label="Estado de la actividad">
                    Estado
                    <div className="seg-tipos">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!form.yaSeHizo}
                        className={`seg-tipo${!form.yaSeHizo ? " seg-tipo-on" : ""}`}
                        onClick={() => setForm({ ...form, yaSeHizo: false })}
                      >
                        🗓 Programada
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={form.yaSeHizo}
                        className={`seg-tipo${form.yaSeHizo ? " seg-tipo-realizada" : ""}`}
                        onClick={() => setForm({ ...form, yaSeHizo: true })}
                      >
                        ✓ Realizada
                      </button>
                    </div>
                  </div>
                }
              />

              {error && <p className="seg-error">{error}</p>}

              <button type="submit" className="btn-enviar" style={{ justifyContent: "center" }} disabled={guardando}>
                {guardando ? "Guardando…" : "+ Guardar actividad"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="seg-agregar"
              onClick={() => {
                setError(null);
                setAvisoCorreo(null);
                setAvisoTour(null);
                setAgregando(true);
              }}
            >
              + Agregar actividad
            </button>
          )}
          {error && !agregando && <p className="seg-error">{error}</p>}
          {avisoCorreo && !agregando && (
            <p className={avisoCorreo.ok ? "seg-aviso-correo" : "seg-error"}>{avisoCorreo.texto}</p>
          )}
          {avisoTour && !agregando && (
            <p className={avisoTour.ok ? "seg-aviso-correo" : "seg-error"}>{avisoTour.texto}</p>
          )}

          {pendientes.length > 0 && (
            <>
              <p className="seg-seccion">Pendientes</p>
              {pendientes.map(renderActividad)}
            </>
          )}
          {hechas.length > 0 && (
            <>
              <p className="seg-seccion">Completadas</p>
              {hechas.map(renderActividad)}
            </>
          )}
          {actividades.length === 0 && !agregando && (
            <p className="seg-vacio">Aún no hay actividades. Agrega la primera para empezar el seguimiento.</p>
          )}

        </div>
      </div>
    </div>
  );
}
