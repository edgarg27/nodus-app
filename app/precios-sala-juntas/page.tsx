"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

// Tabla independiente de `precios_sala_juntas` (esa es la tarifa plana usada
// para horas extra fuera de un contrato). Esta es la lista de precios por
// tamaño de sala que usa el admin/superadmin para cotizar sala de juntas a
// un cliente nuevo, con 3 tarifas fijas por tamaño (no lineales).
type PrecioSala = {
  id: string;
  centro: string;
  tamano: string;
  precio_hora: number;
  precio_medio_dia: number;
  precio_dia: number;
};

const FORM_VACIO = {
  tamano: "",
  precio_hora: "",
  precio_medio_dia: "",
  precio_dia: "",
};

function fmt(v: number) {
  return `$${Number(v || 0).toLocaleString("es-MX")}`;
}

export default function PreciosSalaJuntasPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [precios, setPrecios] = useState<PrecioSala[]>([]);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchPrecios(centro);
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

  async function fetchPrecios(c: string) {
    setLoading(true);
    const { data } = await supabase
      .from("precios_cotizacion_sala_juntas")
      .select("*")
      .eq("centro", c)
      .order("tamano");
    setPrecios(data || []);
    setLoading(false);
  }

  function abrirNuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setError("");
    setMostrarForm(true);
  }

  function abrirEditar(p: PrecioSala) {
    setEditandoId(p.id);
    setForm({
      tamano: p.tamano,
      precio_hora: String(p.precio_hora ?? ""),
      precio_medio_dia: String(p.precio_medio_dia ?? ""),
      precio_dia: String(p.precio_dia ?? ""),
    });
    setError("");
    setMostrarForm(true);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!centro || !form.tamano.trim()) {
      setError("Indica el tamaño de la sala (ej. 6 px, 10 px, 20 px)");
      return;
    }
    if (!form.precio_hora && !form.precio_medio_dia && !form.precio_dia) {
      setError("Define al menos una tarifa");
      return;
    }
    setError("");
    setGuardando(true);

    const payload = {
      centro,
      tamano: form.tamano.trim(),
      precio_hora: Number(form.precio_hora) || 0,
      precio_medio_dia: Number(form.precio_medio_dia) || 0,
      precio_dia: Number(form.precio_dia) || 0,
    };

    let dbError = null;
    if (editandoId) {
      ({ error: dbError } = await supabase.from("precios_cotizacion_sala_juntas").update(payload).eq("id", editandoId));
    } else {
      ({ error: dbError } = await supabase.from("precios_cotizacion_sala_juntas").insert(payload));
    }

    setGuardando(false);
    if (dbError) {
      setError("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    setMostrarForm(false);
    setEditandoId(null);
    setForm(FORM_VACIO);
    fetchPrecios(centro);
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar este tamaño de sala?")) return;
    await supabase.from("precios_cotizacion_sala_juntas").delete().eq("id", id);
    if (centro) fetchPrecios(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Precios Sala de Juntas</p>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                🗓️ Tamaños de sala en {centro} ({precios.length})
              </p>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => (mostrarForm ? setMostrarForm(false) : abrirNuevo())}
              >
                {mostrarForm ? "Cancelar" : "+ Nuevo tamaño"}
              </button>
            </div>

            <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>
              Estos precios son los que usa el admin al cotizar sala de juntas a un cliente nuevo desde
              &quot;Cotizar&quot;. No afectan la tarifa de horas extra de contratos existentes.
            </p>

            {mostrarForm && (
              <form className="form-card" onSubmit={guardar} style={{ marginTop: 10 }}>
                <p className="sub-label">Tamaño de la sala</p>
                <input
                  type="text"
                  placeholder="Ej. 6 px, 10 px, 20 px, 30 px"
                  value={form.tamano}
                  onChange={(e) => setForm({ ...form, tamano: e.target.value })}
                />
                <p className="sub-label" style={{ marginTop: 8 }}>
                  Tarifas (deja vacío lo que no aplique)
                </p>
                <div className="tel-form-grid">
                  <div>
                    <p className="sub-label">1 hora</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_hora}
                      onChange={(e) => setForm({ ...form, precio_hora: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">4-6 horas</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_medio_dia}
                      onChange={(e) => setForm({ ...form, precio_medio_dia: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">1 día (10 horas)</p>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="N/A"
                      value={form.precio_dia}
                      onChange={(e) => setForm({ ...form, precio_dia: e.target.value })}
                    />
                  </div>
                </div>
                {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}
                <button className="btn-enviar" type="submit" disabled={guardando} style={{ marginTop: 10 }}>
                  <span className="btn-enviar-text">
                    {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "+ Guardar tamaño"}
                  </span>
                </button>
              </form>
            )}

            {precios.length === 0 ? (
              <div className="empty-card">Sin tamaños de sala registrados en {centro}</div>
            ) : (
              precios.map((p) => (
                <div className="contrato-card-admin" key={p.id}>
                  <div className="contrato-card-top">
                    <div>
                      <p className="contrato-cliente-nombre">{p.tamano}</p>
                      <p className="contrato-detalle">
                        1 hora: {fmt(p.precio_hora)} · 4-6 horas: {fmt(p.precio_medio_dia)} · 1 día: {fmt(p.precio_dia)}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => abrirEditar(p)}>
                      ✎ Editar
                    </button>
                    <button className="tel-borrar-btn" onClick={() => borrar(p.id)}>
                      🗑 Eliminar
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}