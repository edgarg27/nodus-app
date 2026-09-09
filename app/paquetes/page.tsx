"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

type Paquete = {
  id: string;
  centro: string;
  nombre: string;
  descripcion: string | null;
  incluye_horas_sala_juntas: number | null;
  horas_bolsa: number | null;
  tipo_espacio: string | null;
  precio_hora: number | null;
  precio_dia: number | null;
  precio_semana: number | null;
  precio_mes: number | null;
  bloquea_reasignacion: boolean;
};

// Vínculo de la oficina hacia el paquete (no al revés): una oficina tiene
// un único paquete por defecto (o ninguno), pero varias oficinas pueden
// compartir el mismo paquete — por eso el FK vive en `oficinas`, sin
// restricción de unicidad.
type OficinaResumen = { id: string; numero: string; tipo: string; paquete_default_id: string | null };

// Tabla independiente de `paquetes`, sin FK visible desde aquí más allá de
// su propio id. Los paquetes numerados (#1, #2...) ya están precargados
// vía seed/migración — esta pantalla solo los edita, no crea ni borra.
type CoffeeBreakPaquete = {
  id: string;
  numero: number;
  nombre: string;
  precio_persona: number;
  alimentos: string;
  bebidas: string;
  minimo_personas: number;
  activo: boolean;
  promocion_activa: boolean;
  descuento_porcentaje: number;
  promocion_hasta: string | null;
  promocion_texto: string | null;
};

const FORM_VACIO = {
  nombre: "",
  descripcion: "",
  incluye_horas_sala_juntas: "",
  horas_bolsa: "",
  tipo_espacio: "",
  precio_hora: "",
  precio_dia: "",
  precio_semana: "",
  precio_mes: "",
  bloquea_reasignacion: true,
  oficinasVinculadas: [] as string[],
};

const FORM_COFFEE_VACIO = {
  numero: "",
  nombre: "",
  precio_persona: "",
  minimo_personas: "1",
  alimentos: "",
  bebidas: "",
  activo: true,
  promocion_activa: false,
  descuento_porcentaje: "",
  promocion_hasta: "",
  promocion_texto: "",
};

function fmtTarifa(v: number | null) {
  return v != null ? `$${Number(v).toLocaleString("es-MX")}` : "N/A";
}

export default function PaquetesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [tiposEspacio, setTiposEspacio] = useState<string[]>([]);
  const [oficinas, setOficinas] = useState<OficinaResumen[]>([]);
  const [tab, setTab] = useState<"espacios" | "coffee">("espacios");

  // ---- Coffee Break ----
  const [coffeeBreakPaquetes, setCoffeeBreakPaquetes] = useState<CoffeeBreakPaquete[]>([]);
  const [coffeeLoading, setCoffeeLoading] = useState(false);
  const [guardandoCoffeeId, setGuardandoCoffeeId] = useState<string | null>(null);
  const [coffeeError, setCoffeeError] = useState("");
  const [editandoCoffeeId, setEditandoCoffeeId] = useState<string | null>(null);
  const [mostrarFormCoffee, setMostrarFormCoffee] = useState(false);
  const [formCoffee, setFormCoffee] = useState(FORM_COFFEE_VACIO);
  const [creandoCoffee, setCreandoCoffee] = useState(false);

  useEffect(() => {
    if (tab === "coffee" && coffeeBreakPaquetes.length === 0) fetchCoffeeBreak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function fetchCoffeeBreak() {
    setCoffeeLoading(true);
    const { data } = await supabase.from("coffee_break_paquetes").select("*").order("numero", { ascending: true });
    setCoffeeBreakPaquetes(data || []);
    setCoffeeLoading(false);
  }

  function actualizarCampoCoffee(id: string, campo: keyof CoffeeBreakPaquete, valor: any) {
    setCoffeeBreakPaquetes((prev) => prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  async function guardarCoffee(p: CoffeeBreakPaquete) {
    setGuardandoCoffeeId(p.id);
    setCoffeeError("");
    const { error: dbError } = await supabase
      .from("coffee_break_paquetes")
      .update({
        precio_persona: Number(p.precio_persona) || 0,
        alimentos: p.alimentos,
        bebidas: p.bebidas,
        minimo_personas: Number(p.minimo_personas) || 1,
        activo: p.activo,
        promocion_activa: p.promocion_activa,
        descuento_porcentaje: Number(p.descuento_porcentaje) || 0,
        promocion_hasta: p.promocion_hasta || null,
        promocion_texto: p.promocion_texto || null,
      })
      .eq("id", p.id);
    setGuardandoCoffeeId(null);
    if (dbError) {
      setCoffeeError("No se pudo guardar el paquete. Intenta de nuevo.");
      return;
    }
    setEditandoCoffeeId(null);
  }

  function cancelarEdicionCoffee() {
    setEditandoCoffeeId(null);
    setCoffeeError("");
    fetchCoffeeBreak();
  }

  function abrirNuevoCoffee() {
    const siguienteNumero =
      coffeeBreakPaquetes.length > 0 ? Math.max(...coffeeBreakPaquetes.map((p) => p.numero)) + 1 : 1;
    setFormCoffee({ ...FORM_COFFEE_VACIO, numero: String(siguienteNumero) });
    setCoffeeError("");
    setMostrarFormCoffee(true);
  }

  async function crearCoffee(e: React.FormEvent) {
    e.preventDefault();
    if (!formCoffee.nombre.trim()) {
      setCoffeeError("Ponle un nombre al paquete");
      return;
    }
    if (!formCoffee.numero || Number(formCoffee.numero) <= 0) {
      setCoffeeError("Asigna un número de paquete válido");
      return;
    }
    setCoffeeError("");
    setCreandoCoffee(true);
    const { error: dbError } = await supabase.from("coffee_break_paquetes").insert({
      numero: Number(formCoffee.numero),
      nombre: formCoffee.nombre.trim(),
      precio_persona: Number(formCoffee.precio_persona) || 0,
      alimentos: formCoffee.alimentos.trim(),
      bebidas: formCoffee.bebidas.trim(),
      minimo_personas: Number(formCoffee.minimo_personas) || 1,
      activo: formCoffee.activo,
      promocion_activa: formCoffee.promocion_activa,
      descuento_porcentaje: Number(formCoffee.descuento_porcentaje) || 0,
      promocion_hasta: formCoffee.promocion_hasta || null,
      promocion_texto: formCoffee.promocion_texto.trim() || null,
    });
    setCreandoCoffee(false);
    if (dbError) {
      setCoffeeError("No se pudo crear el paquete. Intenta de nuevo.");
      return;
    }
    setMostrarFormCoffee(false);
    setFormCoffee(FORM_COFFEE_VACIO);
    fetchCoffeeBreak();
  }

  async function borrarCoffee(id: string) {
    if (!confirm("¿Borrar este paquete de coffee break? Esta acción no se puede deshacer.")) return;
    setCoffeeError("");
    const { error: dbError } = await supabase.from("coffee_break_paquetes").delete().eq("id", id);
    if (dbError) {
      setCoffeeError("No se pudo borrar el paquete. Intenta de nuevo.");
      return;
    }
    fetchCoffeeBreak();
  }

  const esGlobal = ROLES_GLOBALES.includes(miRol);
  // Solo superadmin puede crear/editar/borrar paquetes — el resto de roles
  // (incluyendo "admin" de centro) únicamente los visualiza.
  const puedeGestionarPaquetes = miRol === "superadmin";

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchPaquetes(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
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

  async function fetchPaquetes(c: string) {
    setLoading(true);
    const [{ data }, { data: oficinasData }] = await Promise.all([
      supabase.from("paquetes").select("*").eq("centro", c).order("nombre"),
      supabase.from("oficinas").select("id, numero, tipo, paquete_default_id").eq("centro", c).order("numero"),
    ]);
    setPaquetes(data || []);
    setOficinas(oficinasData || []);
    setTiposEspacio(Array.from(new Set((oficinasData || []).map((o) => o.tipo).filter(Boolean))).sort());
    setLoading(false);
  }

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const paquetePorId: Record<string, Paquete> = {};
  paquetes.forEach((p) => {
    paquetePorId[p.id] = p;
  });

  // Oficinas del mismo tipo que el paquete que se está editando/creando —
  // la consistencia de tipo se garantiza aquí, no en tiempo de cotización.
  const oficinasDelTipoForm = oficinas.filter((o) => o.tipo === form.tipo_espacio);

  function abrirNuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setError("");
    setMostrarForm(true);
  }

  function abrirEditar(p: Paquete) {
    setEditandoId(p.id);
    setForm({
      nombre: p.nombre,
      descripcion: p.descripcion || "",
      incluye_horas_sala_juntas: String(p.incluye_horas_sala_juntas || 0),
      horas_bolsa: String(p.horas_bolsa || 0),
      tipo_espacio: p.tipo_espacio || "",
      precio_hora: p.precio_hora != null ? String(p.precio_hora) : "",
      precio_dia: p.precio_dia != null ? String(p.precio_dia) : "",
      precio_semana: p.precio_semana != null ? String(p.precio_semana) : "",
      precio_mes: p.precio_mes != null ? String(p.precio_mes) : "",
      bloquea_reasignacion: p.bloquea_reasignacion,
      oficinasVinculadas: oficinas.filter((o) => o.paquete_default_id === p.id).map((o) => o.id),
    });
    setError("");
    setMostrarForm(true);
  }

  function toggleOficinaVinculada(id: string) {
    setForm((f) => ({
      ...f,
      oficinasVinculadas: f.oficinasVinculadas.includes(id)
        ? f.oficinasVinculadas.filter((x) => x !== id)
        : [...f.oficinasVinculadas, id],
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!centro || !form.nombre.trim()) {
      setError("Ponle un nombre al paquete");
      return;
    }
    if (!form.tipo_espacio.trim()) {
      setError("Elige el tipo de espacio al que pertenece este paquete");
      return;
    }
    const tarifaHora = form.precio_hora ? Number(form.precio_hora) : null;
    const tarifaDia = form.precio_dia ? Number(form.precio_dia) : null;
    const tarifaSemana = form.precio_semana ? Number(form.precio_semana) : null;
    const tarifaMes = form.precio_mes ? Number(form.precio_mes) : null;
    if (tarifaHora == null && tarifaDia == null && tarifaSemana == null && tarifaMes == null) {
      setError("Define al menos una tarifa (hora, día, semana o mes)");
      return;
    }
    setError("");
    setGuardando(true);

    const payload = {
      centro,
      nombre: form.nombre.trim(),
      // columna legada "precio" (NOT NULL): se rellena con la primera tarifa disponible.
      precio: tarifaMes ?? tarifaSemana ?? tarifaDia ?? tarifaHora ?? 0,
      descripcion: form.descripcion.trim() || null,
      incluye_horas_sala_juntas: Number(form.incluye_horas_sala_juntas) || 0,
      horas_bolsa: Number(form.horas_bolsa) || 0,
      tipo_espacio: form.tipo_espacio.trim(),
      precio_hora: tarifaHora,
      precio_dia: tarifaDia,
      precio_semana: tarifaSemana,
      precio_mes: tarifaMes,
      bloquea_reasignacion: form.bloquea_reasignacion,
    };

    let paqueteGuardadoId = editandoId;
    let dbError = null;
    if (editandoId) {
      ({ error: dbError } = await supabase.from("paquetes").update(payload).eq("id", editandoId));
    } else {
      const { data: nuevo, error: insertError } = await supabase.from("paquetes").insert(payload).select("id").single();
      dbError = insertError;
      paqueteGuardadoId = nuevo?.id || null;
    }

    if (!dbError && paqueteGuardadoId) {
      // Sincroniza oficinas.paquete_default_id con lo que quedó marcado en
      // el checklist — una oficina puede "robarse" de otro paquete (no hay
      // restricción de unicidad), así que soltar/vincular son dos updates
      // en lote independientes.
      const idsAntes = new Set(oficinas.filter((o) => o.paquete_default_id === paqueteGuardadoId).map((o) => o.id));
      const idsAhora = new Set(form.oficinasVinculadas);
      const paraSoltar = Array.from(idsAntes).filter((id) => !idsAhora.has(id));
      const paraVincular = Array.from(idsAhora).filter((id) => !idsAntes.has(id));
      if (paraSoltar.length > 0) await supabase.from("oficinas").update({ paquete_default_id: null }).in("id", paraSoltar);
      if (paraVincular.length > 0)
        await supabase.from("oficinas").update({ paquete_default_id: paqueteGuardadoId }).in("id", paraVincular);
    }

    setGuardando(false);
    if (dbError) {
      setError("No se pudo guardar el paquete. Intenta de nuevo.");
      return;
    }

    setMostrarForm(false);
    setEditandoId(null);
    setForm(FORM_VACIO);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchPaquetes(centro);
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar este paquete?")) return;
    await supabase.from("paquetes").delete().eq("id", id);
    if (centro) fetchPaquetes(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Paquetes</p>
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
        <div className="centro-tabs" style={{ marginBottom: 12 }}>
          <button className={"centro-tab" + (tab === "espacios" ? " active" : "")} onClick={() => setTab("espacios")}>
            📦 Espacios
          </button>
          <button className={"centro-tab" + (tab === "coffee" ? " active" : "")} onClick={() => setTab("coffee")}>
            ☕ Coffee Break
          </button>
        </div>

        {tab === "coffee" ? (
          coffeeLoading ? (
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className="panel-section-label" style={{ margin: 0 }}>
                  ☕ Paquetes de Coffee Break ({coffeeBreakPaquetes.length})
                </p>
                {puedeGestionarPaquetes && (
                  <button
                    className="tel-borrar-btn"
                    style={{ color: "#0d1b3e", fontWeight: 600 }}
                    onClick={() => (mostrarFormCoffee ? setMostrarFormCoffee(false) : abrirNuevoCoffee())}
                  >
                    {mostrarFormCoffee ? "Cancelar" : "+ Nuevo paquete"}
                  </button>
                )}
              </div>

              {mostrarFormCoffee && (
                <form className="form-card" onSubmit={crearCoffee} style={{ marginTop: 10, marginBottom: 12 }}>
                  <div className="tel-form-grid">
                    <div>
                      <p className="sub-label">Número de paquete</p>
                      <input
                        type="number"
                        min={1}
                        value={formCoffee.numero}
                        onChange={(e) => setFormCoffee({ ...formCoffee, numero: e.target.value })}
                      />
                    </div>
                    <div>
                      <p className="sub-label">Precio por persona</p>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={formCoffee.precio_persona}
                        onChange={(e) => setFormCoffee({ ...formCoffee, precio_persona: e.target.value })}
                      />
                    </div>
                    <div>
                      <p className="sub-label">Mínimo de personas</p>
                      <input
                        type="number"
                        min={1}
                        value={formCoffee.minimo_personas}
                        onChange={(e) => setFormCoffee({ ...formCoffee, minimo_personas: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="sub-label" style={{ marginTop: 8 }}>
                    Nombre del paquete
                  </p>
                  <input
                    type="text"
                    placeholder="Ej. Paquete #5"
                    value={formCoffee.nombre}
                    onChange={(e) => setFormCoffee({ ...formCoffee, nombre: e.target.value })}
                  />
                  <p className="sub-label" style={{ marginTop: 8 }}>
                    Alimentos
                  </p>
                  <textarea
                    value={formCoffee.alimentos}
                    onChange={(e) => setFormCoffee({ ...formCoffee, alimentos: e.target.value })}
                  />
                  <p className="sub-label" style={{ marginTop: 8 }}>
                    Bebidas
                  </p>
                  <textarea
                    value={formCoffee.bebidas}
                    onChange={(e) => setFormCoffee({ ...formCoffee, bebidas: e.target.value })}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#555" }}>
                    <input
                      type="checkbox"
                      checked={formCoffee.activo}
                      onChange={(e) => setFormCoffee({ ...formCoffee, activo: e.target.checked })}
                    />
                    Activo (visible al reservar)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 13, color: "#555" }}>
                    <input
                      type="checkbox"
                      checked={formCoffee.promocion_activa}
                      onChange={(e) => setFormCoffee({ ...formCoffee, promocion_activa: e.target.checked })}
                    />
                    Promoción activa
                  </label>
                  {formCoffee.promocion_activa && (
                    <div className="tel-form-grid" style={{ marginTop: 6 }}>
                      <div>
                        <p className="sub-label">Descuento %</p>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={formCoffee.descuento_porcentaje}
                          onChange={(e) => setFormCoffee({ ...formCoffee, descuento_porcentaje: e.target.value })}
                        />
                      </div>
                      <div>
                        <p className="sub-label">Promoción hasta</p>
                        <input
                          type="date"
                          value={formCoffee.promocion_hasta}
                          onChange={(e) => setFormCoffee({ ...formCoffee, promocion_hasta: e.target.value })}
                        />
                      </div>
                      <div>
                        <p className="sub-label">Texto de la promoción</p>
                        <input
                          value={formCoffee.promocion_texto}
                          onChange={(e) => setFormCoffee({ ...formCoffee, promocion_texto: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                  {coffeeError && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{coffeeError}</p>}
                  <button className="btn-enviar" type="submit" disabled={creandoCoffee} style={{ marginTop: 10 }}>
                    <span className="btn-enviar-text">{creandoCoffee ? "Guardando..." : "+ Guardar paquete"}</span>
                  </button>
                </form>
              )}

              {!mostrarFormCoffee && coffeeError && <p style={{ color: "#A32D2D", fontSize: 13 }}>{coffeeError}</p>}

              {coffeeBreakPaquetes.length === 0 ? (
                <div className="empty-card">Sin paquetes de coffee break precargados</div>
              ) : (
                coffeeBreakPaquetes.map((p) => {
                  const editando = editandoCoffeeId === p.id;
                  return (
                    <div className="contrato-card-admin" key={p.id}>
                      {editando ? (
                        <>
                          <p className="contrato-cliente-nombre">
                            #{p.numero} · {p.nombre}
                          </p>
                          <div className="tel-form-grid" style={{ marginTop: 6 }}>
                            <div>
                              <p className="sub-label">Precio por persona</p>
                              <input
                                type="number"
                                step="0.01"
                                min={0}
                                value={p.precio_persona}
                                onChange={(e) => actualizarCampoCoffee(p.id, "precio_persona", e.target.value)}
                              />
                            </div>
                            <div>
                              <p className="sub-label">Mínimo de personas</p>
                              <input
                                type="number"
                                min={1}
                                value={p.minimo_personas}
                                onChange={(e) => actualizarCampoCoffee(p.id, "minimo_personas", e.target.value)}
                              />
                            </div>
                          </div>
                          <p className="sub-label">Alimentos</p>
                          <textarea value={p.alimentos} onChange={(e) => actualizarCampoCoffee(p.id, "alimentos", e.target.value)} />
                          <p className="sub-label">Bebidas</p>
                          <textarea value={p.bebidas} onChange={(e) => actualizarCampoCoffee(p.id, "bebidas", e.target.value)} />
                          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: "#555" }}>
                            <input
                              type="checkbox"
                              checked={p.activo}
                              onChange={(e) => actualizarCampoCoffee(p.id, "activo", e.target.checked)}
                            />
                            Activo (visible al reservar)
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 13, color: "#555" }}>
                            <input
                              type="checkbox"
                              checked={p.promocion_activa}
                              onChange={(e) => actualizarCampoCoffee(p.id, "promocion_activa", e.target.checked)}
                            />
                            Promoción activa
                          </label>
                          {p.promocion_activa && (
                            <div className="tel-form-grid" style={{ marginTop: 6 }}>
                              <div>
                                <p className="sub-label">Descuento %</p>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={p.descuento_porcentaje}
                                  onChange={(e) => actualizarCampoCoffee(p.id, "descuento_porcentaje", e.target.value)}
                                />
                              </div>
                              <div>
                                <p className="sub-label">Promoción hasta</p>
                                <input
                                  type="date"
                                  value={p.promocion_hasta || ""}
                                  onChange={(e) => actualizarCampoCoffee(p.id, "promocion_hasta", e.target.value)}
                                />
                              </div>
                              <div>
                                <p className="sub-label">Texto de la promoción</p>
                                <input
                                  value={p.promocion_texto || ""}
                                  onChange={(e) => actualizarCampoCoffee(p.id, "promocion_texto", e.target.value)}
                                />
                              </div>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button className="tel-borrar-btn" onClick={cancelarEdicionCoffee}>
                              Cancelar
                            </button>
                            <button
                              className="tel-borrar-btn"
                              style={{ color: "#0d1b3e", fontWeight: 600 }}
                              disabled={guardandoCoffeeId === p.id}
                              onClick={() => guardarCoffee(p)}
                            >
                              {guardandoCoffeeId === p.id ? "Guardando..." : "Guardar"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="contrato-card-top">
                            <div>
                              <p className="contrato-cliente-nombre">
                                #{p.numero} · {p.nombre} {!p.activo && "(inactivo)"}
                              </p>
                              <p className="contrato-detalle">
                                ${Number(p.precio_persona).toLocaleString("es-MX")}/persona · mínimo {p.minimo_personas}
                              </p>
                              <p className="contrato-detalle">🍽️ {p.alimentos}</p>
                              <p className="contrato-detalle">☕ {p.bebidas}</p>
                              {p.promocion_activa && (
                                <p className="contrato-detalle" style={{ color: "#a3701f" }}>
                                  🏷️ {p.descuento_porcentaje}% de descuento {p.promocion_texto ? `· ${p.promocion_texto}` : ""}
                                  {p.promocion_hasta ? ` · hasta ${p.promocion_hasta}` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                          {puedeGestionarPaquetes && (
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                              <button
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                onClick={() => setEditandoCoffeeId(p.id)}
                              >
                                ✎ Editar
                              </button>
                              <button className="tel-borrar-btn" onClick={() => borrarCoffee(p.id)}>
                                🗑 Eliminar
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )
        ) : !centro ? (
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                📦 Paquetes ({paquetes.length})
              </p>
              {puedeGestionarPaquetes && (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => (mostrarForm ? setMostrarForm(false) : abrirNuevo())}
                >
                  {mostrarForm ? "Cancelar" : "+ Nuevo paquete"}
                </button>
              )}
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={guardar}>
                <p className="sub-label">Nombre del paquete</p>
                <input
                  type="text"
                  placeholder="Ej. Paquete Coworking 10 días"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
                <div className="tel-form-grid">
                  <div>
                    <p className="sub-label">Tipo de espacio</p>
                    <input
                      list="tipos-espacio-datalist"
                      placeholder="Ej. Oficina privada"
                      value={form.tipo_espacio}
                      onChange={(e) => setForm({ ...form, tipo_espacio: e.target.value })}
                    />
                    <datalist id="tipos-espacio-datalist">
                      {tiposEspacio.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <p className="sub-label">Horas de sala de juntas incluidas</p>
                    <input
                      type="number"
                      min={0}
                      value={form.incluye_horas_sala_juntas}
                      onChange={(e) => setForm({ ...form, incluye_horas_sala_juntas: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Horas bolsa incluidas</p>
                    <input
                      type="number"
                      min={0}
                      value={form.horas_bolsa}
                      onChange={(e) => setForm({ ...form, horas_bolsa: e.target.value })}
                    />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>
                  El tipo de espacio debe coincidir con el tipo de una oficina real (ej. &quot;Oficina privada&quot;)
                  para que el paquete aparezca al cotizar ese tipo de espacio.
                </p>

                <p className="sub-label" style={{ marginTop: 8 }}>
                  Tarifas por modalidad (deja vacío lo que no aplique)
                </p>
                <div className="tel-form-grid">
                  <div>
                    <p className="sub-label">Por hora</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_hora}
                      onChange={(e) => setForm({ ...form, precio_hora: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Por día</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_dia}
                      onChange={(e) => setForm({ ...form, precio_dia: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Por semana</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_semana}
                      onChange={(e) => setForm({ ...form, precio_semana: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Por mes</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_mes}
                      onChange={(e) => setForm({ ...form, precio_mes: e.target.value })}
                    />
                  </div>
                </div>
                <textarea
                  placeholder="Descripción (opcional)"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8, minHeight: 60 }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "#555" }}>
                  <input
                    type="checkbox"
                    checked={form.bloquea_reasignacion}
                    onChange={(e) => setForm({ ...form, bloquea_reasignacion: e.target.checked })}
                  />
                  No permitir reasignar este paquete a un cliente que ya lo tiene en un contrato
                </label>
                <p style={{ fontSize: 11, color: "#aaa", margin: "2px 0 0" }}>
                  Desmárcalo para paquetes repetibles (ej. consumibles por día/hora) que un mismo cliente puede
                  volver a contratar aunque ya tenga uno registrado.
                </p>

                {form.tipo_espacio.trim() && (
                  <div style={{ marginTop: 10 }}>
                    <p className="sub-label">Oficinas que usan este paquete por defecto (opcional)</p>
                    {oficinasDelTipoForm.length === 0 ? (
                      <p style={{ fontSize: 11, color: "#999", margin: 0 }}>
                        Sin oficinas de tipo &quot;{form.tipo_espacio}&quot; registradas en {centro}.
                      </p>
                    ) : (
                      oficinasDelTipoForm.map((o) => {
                        const vinculadaAOtro =
                          o.paquete_default_id && o.paquete_default_id !== editandoId
                            ? paquetePorId[o.paquete_default_id]
                            : null;
                        return (
                          <label
                            key={o.id}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, color: "#333" }}
                          >
                            <input
                              type="checkbox"
                              checked={form.oficinasVinculadas.includes(o.id)}
                              onChange={() => toggleOficinaVinculada(o.id)}
                            />
                            {o.numero}
                            {vinculadaAOtro && (
                              <span style={{ fontSize: 11, color: "#a3701f" }}>
                                · actualmente en &quot;{vinculadaAOtro.nombre}&quot;
                              </span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                )}

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
                  <span className="btn-enviar-text">
                    {editandoId ? "Guardar cambios" : "+ Guardar paquete"}
                  </span>
                </button>
              </form>
            )}

            {paquetes.length === 0 ? (
              <div className="empty-card">Sin paquetes registrados en {centro}</div>
            ) : (
              paquetes.map((p) => (
                <div className="contrato-card-admin" key={p.id}>
                  <div className="contrato-card-top">
                    <div>
                      <p className="contrato-cliente-nombre">{p.nombre}</p>
                      <p className="contrato-detalle">{p.tipo_espacio || "Sin tipo de espacio asignado"}</p>
                      <p className="contrato-detalle">
                        Hora: {fmtTarifa(p.precio_hora)} · Día: {fmtTarifa(p.precio_dia)} · Semana: {fmtTarifa(p.precio_semana)} · Mes:{" "}
                        {fmtTarifa(p.precio_mes)}
                      </p>
                      {p.descripcion && <p className="contrato-detalle">{p.descripcion}</p>}
                      {(!!p.incluye_horas_sala_juntas || !!p.horas_bolsa) && (
                        <p className="contrato-detalle">
                          {!!p.incluye_horas_sala_juntas && `${p.incluye_horas_sala_juntas}h sala de juntas incluidas`}
                          {!!p.incluye_horas_sala_juntas && !!p.horas_bolsa && " · "}
                          {!!p.horas_bolsa && `${p.horas_bolsa}h bolsa incluidas`}
                        </p>
                      )}
                      <p className="contrato-detalle" style={{ color: p.bloquea_reasignacion ? "#a3701f" : "#0f6e56" }}>
                        {p.bloquea_reasignacion ? "🔒 Único por cliente" : "🔁 Repetible por cliente"}
                      </p>
                      {oficinas.some((o) => o.paquete_default_id === p.id) && (
                        <p className="contrato-detalle">
                          🔗 Oficinas por defecto:{" "}
                          {oficinas
                            .filter((o) => o.paquete_default_id === p.id)
                            .map((o) => o.numero)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                  {puedeGestionarPaquetes && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => abrirEditar(p)}>
                        ✎ Editar
                      </button>
                      <button className="tel-borrar-btn" onClick={() => borrar(p.id)}>
                        🗑 Eliminar
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
