"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcelHojas } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import SeguimientoModal, {
  type ActividadProspecto,
  estaAtrasada,
  etiquetaActividad,
  formatoFechaCorta,
  ordenarActividades,
} from "./SeguimientoModal";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
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
  registrado_por?: string | null;
};

const ESTADOS_PROSPECTO: Record<string, { label: string; bg: string; color: string }> = {
  nuevo: { label: "Nuevo", bg: "#E6F1FB", color: "#185FA5" },
  contactado: { label: "Contactado", bg: "#FAEEDA", color: "#854F0B" },
  en_seguimiento: { label: "En seguimiento", bg: "#FFF3E8", color: "#F07E3A" },
  convertido: { label: "Convertido", bg: "#E1F5EE", color: "#0F6E56" },
  perdido: { label: "Perdido", bg: "#FCEBEB", color: "#A32D2D" },
};

// Mismas opciones que ya usa CotizarForm.tsx para "Medio de contacto" al cotizar.
const MEDIOS_PROSPECTO = ["Teléfono", "Redes sociales", "Referido", "Página web", "Venta en piso", "Otro"];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function ProspectosPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [nombrePorRegistradoPor, setNombrePorRegistradoPor] = useState<Record<string, string>>({});

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
  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState<string | null>(null);
  const [comentarioPerdido, setComentarioPerdido] = useState("");
  const [avisoExito, setAvisoExito] = useState(false);
  const [nombreRegistrado, setNombreRegistrado] = useState("");
  const [actividadesPorProspecto, setActividadesPorProspecto] = useState<Record<string, ActividadProspecto[]>>({});
  const [seguimientoDe, setSeguimientoDe] = useState<Prospecto | null>(null);

  // Filtros del seguimiento (tipo CRM). Por omisión, el centro de quien entra.
  const [fCentro, setFCentro] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fContacto, setFContacto] = useState<"" | "sin_contactar" | "contactados" | "atrasados">("");
  const [fPersona, setFPersona] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [fBuscar, setFBuscar] = useState("");

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
    setMiNombre(profile?.nombre || "");
    let miCentro = profile?.centro || null;
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      miCentro = miCentro || CENTROS_SUGERIDOS[0];
    }
    setCentro(miCentro);
    // El admin de un centro abre viendo su centro; los roles globales, todos.
    setFCentro(ROLES_GLOBALES.includes(rol) ? "" : profile?.centro || "");
    setFormProspecto((f) => ({ ...f, centroInteres: miCentro || "" }));
    await cargarProspectos();
    setLoading(false);
  }

  async function cargarProspectos() {
    // Sin filtrar por centro a propósito — un prospecto puede interesarse en
    // cualquier Nodus, y cualquier admin debe poder ver y dar seguimiento a
    // todos los prospectos, no solo los de un centro.
    const { data } = await supabase.from("prospectos").select("*").order("created_at", { ascending: false });
    const lista = data || [];
    setProspectos(lista);
    await marcarSeguimientoAutomatico(lista);

    // Actividades de seguimiento (ver migracion_prospectos_actividades.sql). Si la
    // migración aún no se corrió, la consulta falla y la lista solo sale vacía.
    let actividades: ActividadProspecto[] = [];
    if (lista.length > 0) {
      const { data: filas } = await supabase
        .from("prospecto_actividades")
        .select("*")
        .in("prospecto_id", lista.map((p) => p.id));
      actividades = filas || [];
    }
    const porProspecto: Record<string, ActividadProspecto[]> = {};
    actividades.forEach((a) => {
      (porProspecto[a.prospecto_id] ||= []).push(a);
    });
    setActividadesPorProspecto(porProspecto);

    const idsRegistro = Array.from(
      new Set(
        [
          ...lista.map((p) => p.registrado_por),
          ...actividades.flatMap((a) => [a.creado_por, a.completada_por]),
        ].filter((id): id is string => !!id)
      )
    );
    if (idsRegistro.length > 0) {
      const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", idsRegistro);
      setNombrePorRegistradoPor(Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre])));
    }
  }

  // Un prospecto que ya tiene al menos una cotización ligada (ver
  // prospecto_id en cotizaciones_comerciales, precargado desde el botón
  // "🧾 Cotizar") pasa solo a "en_seguimiento" — nunca si ya está
  // convertido o perdido, eso son decisiones manuales del staff.
  async function marcarSeguimientoAutomatico(lista: Prospecto[]) {
    const candidatos = lista.filter((p) => p.estado === "nuevo" || p.estado === "contactado");
    if (candidatos.length === 0) return;
    const { data: cotizaciones } = await supabase
      .from("cotizaciones_comerciales")
      .select("prospecto_id")
      .in("prospecto_id", candidatos.map((p) => p.id));
    const idsConCotizacion = new Set((cotizaciones || []).map((c) => c.prospecto_id).filter(Boolean));
    const idsAActualizar = candidatos.filter((p) => idsConCotizacion.has(p.id)).map((p) => p.id);
    if (idsAActualizar.length === 0) return;
    await supabase.from("prospectos").update({ estado: "en_seguimiento" }).in("id", idsAActualizar);
    setProspectos((prev) =>
      prev.map((p) => (idsAActualizar.includes(p.id) ? { ...p, estado: "en_seguimiento" } : p))
    );
  }

  async function agregarProspecto(e: React.FormEvent) {
    e.preventDefault();
    if (!formProspecto.nombre.trim() || !formProspecto.centroInteres) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("prospectos").insert({
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
    if (insertError) {
      alert("No se pudo guardar el prospecto. Intenta de nuevo.");
      return;
    }
    setNombreRegistrado(formProspecto.nombre);
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
    setAvisoExito(true);
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

  // Mismo cambio que hace el select de estado, sin pasar por "perdido".
  async function marcarContactado(id: string) {
    await supabase.from("prospectos").update({ estado: "contactado" }).eq("id", id).eq("estado", "nuevo");
    setProspectos((prev) => prev.map((p) => (p.id === id && p.estado === "nuevo" ? { ...p, estado: "contactado" } : p)));
    setSeguimientoDe((p) => (p && p.id === id && p.estado === "nuevo" ? { ...p, estado: "contactado" } : p));
  }

  // Para la tarjeta y el Excel: avance y siguiente actividad pendiente.
  function resumenSeguimiento(prospectoId: string) {
    const lista = actividadesPorProspecto[prospectoId] || [];
    const { pendientes, hechas } = ordenarActividades(lista);
    return {
      total: lista.length,
      hechas: hechas.length,
      proxima: pendientes[0] || null,
      ultimaHecha: hechas[0] || null,
      hayAtrasadas: pendientes.some(estaAtrasada),
    };
  }

  // Ficha de seguimiento de cada prospecto: si ya se le contactó, cuándo, cómo y quién, y cuántos días lleva sin
  // contacto. "Contactado" = tiene al menos una actividad hecha o ya se movió de "Nuevo".
  const hoy = hoyMexicoISO();
  const fichas = useMemo(() => {
    const diasDesde = (iso: string) => Math.max(0, Math.round((Date.parse(hoy + "T12:00:00") - Date.parse(iso.slice(0, 10) + "T12:00:00")) / 86400000));
    const mapa: Record<string, ReturnType<typeof resumenSeguimiento> & {
      contactado: boolean;
      atrasadas: number;
      ultimoContactoFecha: string | null;
      ultimoContactoPor: string;
      diasSinContacto: number;
      personas: Set<string>;
    }> = {};
    for (const p of prospectos) {
      const lista = actividadesPorProspecto[p.id] || [];
      const seg = resumenSeguimiento(p.id);
      const u = seg.ultimaHecha;
      const ultimoContactoFecha = u ? (u.completada_en || u.fecha).slice(0, 10) : null;
      mapa[p.id] = {
        ...seg,
        contactado: seg.hechas > 0 || ["contactado", "en_seguimiento", "convertido"].includes(p.estado),
        atrasadas: lista.filter(estaAtrasada).length,
        ultimoContactoFecha,
        ultimoContactoPor: u ? nombrePorRegistradoPor[u.completada_por || u.creado_por || ""] || "" : "",
        diasSinContacto: diasDesde(ultimoContactoFecha || p.created_at),
        personas: new Set(
          [p.registrado_por, ...lista.flatMap((a) => [a.creado_por, a.completada_por])].filter((x): x is string => !!x)
        ),
      };
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectos, actividadesPorProspecto, nombrePorRegistradoPor, hoy]);

  const prospectosFiltrados = useMemo(() => {
    const q = fBuscar.trim().toLowerCase();
    return prospectos.filter((p) => {
      const f = fichas[p.id];
      if (!f) return false;
      if (fCentro && p.centro !== fCentro) return false;
      if (fEstado && p.estado !== fEstado) return false;
      if (fContacto === "sin_contactar" && f.contactado) return false;
      if (fContacto === "contactados" && !f.contactado) return false;
      if (fContacto === "atrasados" && f.atrasadas === 0) return false;
      if (fPersona && !f.personas.has(fPersona)) return false;
      const registro = p.created_at.slice(0, 10);
      if (fDesde && registro < fDesde) return false;
      if (fHasta && registro > fHasta) return false;
      if (q && ![p.nombre, p.telefono, p.email, p.empresa, p.rfc, p.interes].some((v) => (v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [prospectos, fichas, fCentro, fEstado, fContacto, fPersona, fDesde, fHasta, fBuscar]);

  const kpis = useMemo(() => {
    const cuenta = (fn: (p: Prospecto) => boolean) => prospectosFiltrados.filter(fn).length;
    return {
      total: prospectosFiltrados.length,
      sinContactar: cuenta((p) => !fichas[p.id]?.contactado),
      atrasados: cuenta((p) => (fichas[p.id]?.atrasadas || 0) > 0),
      enSeguimiento: cuenta((p) => p.estado === "en_seguimiento" || p.estado === "contactado"),
      convertidos: cuenta((p) => p.estado === "convertido"),
      perdidos: cuenta((p) => p.estado === "perdido"),
    };
  }, [prospectosFiltrados, fichas]);

  // Quienes registraron prospectos o les dieron seguimiento (para el filtro).
  const personasSeguimiento = useMemo(
    () =>
      Object.entries(nombrePorRegistradoPor)
        .filter(([id]) => Object.values(fichas).some((f) => f.personas.has(id)))
        .sort((a, b) => a[1].localeCompare(b[1], "es")),
    [nombrePorRegistradoPor, fichas]
  );

  function limpiarFiltros() {
    setFCentro("");
    setFEstado("");
    setFContacto("");
    setFPersona("");
    setFDesde("");
    setFHasta("");
    setFBuscar("");
  }

  // Excel con dos hojas: una fila por prospecto (a quién se contactó y a quién no) y una por actividad de
  // seguimiento (qué se hizo, cuándo y quién), con los filtros que estén puestos.
  function exportarSeguimiento() {
    const nombre = (id: string | null | undefined) => (id && nombrePorRegistradoPor[id]) || "";
    const tipoTexto = (a: ActividadProspecto) => etiquetaActividad(a).replace(/^\S+\s/, "");
    const filasProspectos = prospectosFiltrados.map((p) => {
      const f = fichas[p.id];
      return {
        "Fecha de registro": p.created_at.slice(0, 10),
        Registró: nombre(p.registrado_por),
        Centro: p.centro || "",
        Nombre: p.nombre,
        Empresa: p.empresa || "",
        Teléfono: p.telefono || "",
        Correo: p.email || "",
        Medio: p.medio || "",
        Interés: p.interes || "",
        Estado: ESTADOS_PROSPECTO[p.estado]?.label || p.estado,
        "¿Contactado?": f.contactado ? "Sí" : "No",
        "Último contacto": f.ultimoContactoFecha || "",
        "Cómo": f.ultimaHecha ? tipoTexto(f.ultimaHecha) : "",
        "Contactó": f.ultimoContactoPor,
        "Días sin contacto": f.diasSinContacto,
        "Actividades hechas": f.hechas,
        "Actividades pendientes": f.total - f.hechas,
        Atrasadas: f.atrasadas,
        "Próxima actividad": f.proxima ? `${tipoTexto(f.proxima)}${f.proxima.descripcion ? ` · ${f.proxima.descripcion}` : ""}` : "",
        "Fecha próxima": f.proxima?.fecha || "",
        "Motivo perdido": p.comentario_perdido || "",
        Notas: p.notas || "",
      };
    });
    const filasActividades = prospectosFiltrados.flatMap((p) =>
      [...(actividadesPorProspecto[p.id] || [])]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((a) => ({
          Prospecto: p.nombre,
          Empresa: p.empresa || "",
          Centro: p.centro || "",
          Tipo: tipoTexto(a),
          Descripción: a.descripcion || "",
          "Fecha programada": a.fecha,
          Estado: a.completada ? "Hecha" : estaAtrasada(a) ? "Atrasada" : "Pendiente",
          Registró: nombre(a.creado_por),
          "Registrada el": a.created_at.slice(0, 10),
          "Hecha por": a.completada ? nombre(a.completada_por) : "",
          "Hecha el": a.completada_en ? a.completada_en.slice(0, 10) : "",
        }))
    );
    exportarExcelHojas(`seguimiento-prospectos-${(fCentro || "todos").replace(/\s+/g, "_")}-${hoy}`, {
      Prospectos: filasProspectos,
      Seguimiento: filasActividades,
    });
  }

  // Los nombres de quien registra o palomea una actividad nueva pueden no estar
  // cargados todavía (p. ej. la primera vez que alguien usa el seguimiento).
  async function completarNombres(lista: ActividadProspecto[]) {
    const faltan = Array.from(
      new Set(lista.flatMap((a) => [a.creado_por, a.completada_por]).filter((id): id is string => !!id && !nombrePorRegistradoPor[id]))
    );
    if (faltan.length === 0) return;
    const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", faltan);
    setNombrePorRegistradoPor((prev) => ({ ...prev, ...Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre])) }));
  }

  async function borrarProspecto(id: string) {
    setConfirmandoBorrarId(null);
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
              <div className="registrado-por">
                <span className="registrado-por-lbl">Registrado por</span>
                <span className="registrado-por-chip">
                  <span className="registrado-por-avatar">{(miNombre.trim()[0] || "?").toUpperCase()}</span>
                  {miNombre || "—"}
                </span>
              </div>
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

            <div className="crm-cab">
              <p className="panel-section-label" style={{ margin: 0 }}>
                Seguimiento de prospectos ({prospectosFiltrados.length}
                {prospectosFiltrados.length !== prospectos.length ? ` de ${prospectos.length}` : ""})
              </p>
              <button className="btn-exportar" onClick={exportarSeguimiento}>
                📥 Excel del seguimiento
              </button>
            </div>

            <div className="crm-kpis">
              {(
                [
                  ["Prospectos", kpis.total, () => (setFContacto(""), setFEstado("")), !fContacto && !fEstado, ""],
                  ["Sin contactar", kpis.sinContactar, () => setFContacto(fContacto === "sin_contactar" ? "" : "sin_contactar"), fContacto === "sin_contactar", "crm-kpi-roja"],
                  ["Con atrasadas", kpis.atrasados, () => setFContacto(fContacto === "atrasados" ? "" : "atrasados"), fContacto === "atrasados", "crm-kpi-ambar"],
                  ["En seguimiento", kpis.enSeguimiento, () => setFEstado(fEstado === "en_seguimiento" ? "" : "en_seguimiento"), fEstado === "en_seguimiento", ""],
                  ["Convertidos", kpis.convertidos, () => setFEstado(fEstado === "convertido" ? "" : "convertido"), fEstado === "convertido", "crm-kpi-verde"],
                  ["Perdidos", kpis.perdidos, () => setFEstado(fEstado === "perdido" ? "" : "perdido"), fEstado === "perdido", ""],
                ] as [string, number, () => void, boolean, string][]
              ).map(([lbl, n, alClic, activa, clase]) => (
                <button key={lbl} type="button" className={`crm-kpi ${clase}${activa ? " activa" : ""}`} onClick={alClic}>
                  <span className="crm-kpi-val">{n}</span>
                  <span className="crm-kpi-lbl">{lbl}</span>
                </button>
              ))}
            </div>

            <div className="form-card crm-filtros">
              <input placeholder="Buscar nombre, empresa, teléfono, correo..." value={fBuscar} onChange={(e) => setFBuscar(e.target.value)} />
              <select value={fCentro} onChange={(e) => setFCentro(e.target.value)}>
                <option value="">Todos los centros</option>
                {CENTROS_SUGERIDOS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="">Todos los estados</option>
                {Object.entries(ESTADOS_PROSPECTO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <select value={fContacto} onChange={(e) => setFContacto(e.target.value as typeof fContacto)}>
                <option value="">Contactados y sin contactar</option>
                <option value="contactados">Solo contactados</option>
                <option value="sin_contactar">Solo sin contactar</option>
                <option value="atrasados">Con actividades atrasadas</option>
              </select>
              <select value={fPersona} onChange={(e) => setFPersona(e.target.value)}>
                <option value="">Cualquier persona</option>
                {personasSeguimiento.map(([id, n]) => (
                  <option key={id} value={id}>
                    Registró o dio seguimiento: {n}
                  </option>
                ))}
              </select>
              <label>
                <span>Registrados desde</span>
                <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
              </label>
              <label>
                <span>hasta</span>
                <input type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
              </label>
              <button type="button" className="tel-borrar-btn" onClick={limpiarFiltros}>
                Limpiar filtros
              </button>
            </div>
            {prospectosFiltrados.length === 0 ? (
              <div className="empty-card">{prospectos.length === 0 ? "Sin prospectos registrados" : "Ningún prospecto coincide con los filtros"}</div>
            ) : (
              (() => {
                const porMes: Record<string, Prospecto[]> = {};
                prospectosFiltrados.forEach((p) => {
                  const d = new Date(p.created_at);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  if (!porMes[key]) porMes[key] = [];
                  porMes[key].push(p);
                });
                const mesesOrdenados = Object.keys(porMes).sort().reverse();

                return mesesOrdenados.map((mesKey) => {
                  const [anio, mesNum] = mesKey.split("-");
                  const lista = [...porMes[mesKey]].sort((a, b) => {
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                  });
                  return (
                    <div key={mesKey}>
                      <p className="panel-section-label" style={{ marginTop: 12 }}>
                        📅 {MESES[Number(mesNum) - 1]} {anio} ({lista.length})
                      </p>
                      {lista.map((p) => {
                        const est = ESTADOS_PROSPECTO[p.estado] || ESTADOS_PROSPECTO.nuevo;
                        const seg = resumenSeguimiento(p.id);
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
                                {p.registrado_por && nombrePorRegistradoPor[p.registrado_por]
                                  ? ` · Registró: ${nombrePorRegistradoPor[p.registrado_por]}`
                                  : ""}
                              </p>
                              {(() => {
                                const f = fichas[p.id];
                                if (!f) return null;
                                if (f.ultimaHecha && f.ultimoContactoFecha)
                                  return (
                                    <p className="item-card-extra">
                                      <span className="seg-proximo">Último contacto:</span> {etiquetaActividad(f.ultimaHecha)} ·{" "}
                                      {formatoFechaCorta(f.ultimoContactoFecha)}
                                      {f.ultimoContactoPor ? ` · por ${f.ultimoContactoPor}` : ""}
                                      {f.diasSinContacto > 0 ? ` (hace ${f.diasSinContacto} día${f.diasSinContacto === 1 ? "" : "s"})` : " (hoy)"}
                                    </p>
                                  );
                                if (!f.contactado && p.estado !== "perdido")
                                  return (
                                    <p className="item-card-extra crm-sin-contacto">
                                      Sin contactar · registrado hace {f.diasSinContacto} día{f.diasSinContacto === 1 ? "" : "s"}
                                    </p>
                                  );
                                return null;
                              })()}
                              {seg.proxima && (
                                <p className="item-card-extra">
                                  <span className="seg-proximo">Próximo:</span> {etiquetaActividad(seg.proxima)} ·{" "}
                                  {formatoFechaCorta(seg.proxima.fecha)}
                                  {estaAtrasada(seg.proxima) && <span className="seg-proximo-atrasada">Atrasada</span>}
                                </p>
                              )}
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
                              <button
                                className="seg-btn-tarjeta"
                                onClick={() => setSeguimientoDe(p)}
                                title={seg.hayAtrasadas ? "Tiene actividades atrasadas" : undefined}
                              >
                                {seg.hayAtrasadas && <span className="seg-btn-alerta" aria-hidden="true" />}
                                📋 Seguimiento{seg.total > 0 ? ` (${seg.hechas}/${seg.total})` : ""}
                              </button>
                              <a
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600, textDecoration: "none" }}
                                href={`/registrar-plan?centro=${encodeURIComponent(p.centro || centro || "")}&prospectoId=${encodeURIComponent(
                                  p.id
                                )}&prospectoNombre=${encodeURIComponent(
                                  p.nombre
                                )}&prospectoTelefono=${encodeURIComponent(p.telefono || "")}&prospectoEmail=${encodeURIComponent(
                                  p.email || ""
                                )}&prospectoInteres=${encodeURIComponent(p.interes || "")}&prospectoRfc=${encodeURIComponent(
                                  p.rfc || ""
                                )}`}
                              >
                                🧾 Cotizar
                              </a>
                              {/* Los prospectos se ven y se les da seguimiento desde cualquier centro,
                                  pero solo los borra su propio centro (migracion_prospectos_compartidos.sql). */}
                              {(esGlobal || p.centro === centro) && (
                                <button className="tel-borrar-btn" onClick={() => setConfirmandoBorrarId(p.id)}>
                                  🗑
                                </button>
                              )}
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

      {confirmandoBorrarId && (
        <div className="modal-overlay" onClick={() => setConfirmandoBorrarId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Borrar prospecto</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Borrar este prospecto? Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoBorrarId(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => borrarProspecto(confirmandoBorrarId)}>
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {avisoExito && (
        <div className="modal-overlay" onClick={() => setAvisoExito(false)}>
          <div className="invitado-exito-card" onClick={(e) => e.stopPropagation()}>
            <div className="invitado-exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="invitado-exito-titulo">¡Se agregó con éxito!</p>
            <p className="invitado-exito-mensaje">
              {nombreRegistrado ? `${nombreRegistrado} se registró como prospecto.` : "El prospecto se registró correctamente."}
            </p>
            <button className="invitado-exito-btn" onClick={() => setAvisoExito(false)}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {seguimientoDe && (
        <SeguimientoModal
          prospecto={seguimientoDe}
          actividades={actividadesPorProspecto[seguimientoDe.id] || []}
          nombres={nombrePorRegistradoPor}
          onActividadesChange={(lista) => {
            setActividadesPorProspecto((prev) => ({ ...prev, [seguimientoDe.id]: lista }));
            completarNombres(lista);
          }}
          onContactado={() => marcarContactado(seguimientoDe.id)}
          onClose={() => setSeguimientoDe(null)}
        />
      )}

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
