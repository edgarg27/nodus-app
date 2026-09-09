"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Proveedor = {
  id: string;
  nombre: string;
  centro: string;
  categoria: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  created_at: string;
};

// Mismo criterio que en /tickets y /cobranza: estos roles ven todos los
// centros, el resto solo ve el suyo.
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza"];

// Misma lista que usa /alta-cliente para que un proveedor quede
// registrado con el mismo nombre de centro que usa el resto del sistema.
const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

export default function ProveedoresPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [esGlobal, setEsGlobal] = useState(false);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    nombre: "",
    centro: "",
    categoria: "",
    contacto: "",
    telefono: "",
    email: "",
    notas: "",
  });

  useEffect(() => {
    fetchTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTodo() {
    setLoading(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rolActual = profile?.rol || "";
    const centroActual = profile?.centro || null;
    const globalActual = ROLES_GLOBALES.includes(rolActual);
    setMiRol(rolActual);
    setMiCentro(centroActual);
    setEsGlobal(globalActual);
    setForm((f) => ({ ...f, centro: centroActual || "" }));

    let query = supabase.from("proveedores").select("*").order("nombre");
    if (!globalActual && centroActual) {
      query = query.eq("centro", centroActual);
    }
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(
        /proveedores/i.test(fetchError.message || "")
          ? "Todavía no se ha creado la tabla de proveedores en la base de datos (falta correr la migración)."
          : "No se pudieron cargar los proveedores."
      );
    } else {
      setProveedores(data || []);
    }
    setLoading(false);
  }

  const porCentro = useMemo(() => {
    if (!esGlobal) return null;
    const grupos: Record<string, Proveedor[]> = {};
    proveedores.forEach((p) => {
      const key = p.centro || "Sin centro";
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(p);
    });
    return Object.keys(grupos)
      .sort()
      .map((centro) => ({ centro, proveedores: grupos[centro] }));
  }, [proveedores, esGlobal]);

  async function crearProveedor(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.centro.trim()) return;
    setGuardando(true);
    setError("");

    const { error: insertError } = await supabase.from("proveedores").insert({
      nombre: form.nombre.trim(),
      centro: form.centro.trim(),
      categoria: form.categoria.trim() || null,
      contacto: form.contacto.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      notas: form.notas.trim() || null,
    });

    if (insertError) {
      setError(
        /proveedores/i.test(insertError.message || "")
          ? "Todavía no se ha creado la tabla de proveedores en la base de datos (falta correr la migración)."
          : "No se pudo guardar el proveedor. Intenta de nuevo."
      );
      setGuardando(false);
      return;
    }

    setForm({ nombre: "", centro: miCentro || "", categoria: "", contacto: "", telefono: "", email: "", notas: "" });
    setMostrarForm(false);
    setGuardando(false);
    fetchTodo();
  }

  function renderProveedor(p: Proveedor) {
    return (
      <div className="item-card" key={p.id}>
        <div className="item-card-info">
          <p className="item-card-titulo">🏭 {p.nombre}</p>
          <p className="item-card-sub">
            {[p.categoria, p.contacto].filter(Boolean).join(" · ") || "Sin categoría / contacto"}
          </p>
          <p className="item-card-extra">
            {p.centro}
            {p.telefono ? ` · ${p.telefono}` : ""}
            {p.email ? ` · ${p.email}` : ""}
          </p>
          {p.notas && <p className="item-card-sub" style={{ marginTop: 4 }}>{p.notas}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Proveedores</p>
        <p className="rep-sub">{esGlobal ? "Todos los centros" : miCentro || "Tu centro"}</p>
      </div>

      <div className="rep-content">
        <button className="btn-enviar" style={{ marginBottom: 4 }} onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Nuevo proveedor"}
        </button>

        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        {mostrarForm && (
          <form className="form-card" onSubmit={crearProveedor}>
            <div className="tel-form-grid">
              <input
                placeholder="Nombre del proveedor"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
              />
              <select
                value={form.centro}
                onChange={(e) => setForm({ ...form, centro: e.target.value })}
                required
              >
                <option value="" disabled>
                  Selecciona un centro
                </option>
                {CENTROS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {form.centro && !CENTROS.includes(form.centro) && (
                  <option value={form.centro}>{form.centro}</option>
                )}
              </select>
              <input
                placeholder="Categoría (ej. Mantenimiento, Limpieza)"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              />
              <input
                placeholder="Persona de contacto"
                value={form.contacto}
                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
              />
              <input
                placeholder="Teléfono"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
              <input
                type="email"
                placeholder="Correo"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <textarea
              placeholder="Notas (opcional)"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
            />
            <button className="btn-enviar" type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar proveedor"}
            </button>
          </form>
        )}

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          Proveedores registrados ({proveedores.length})
        </p>
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
        ) : proveedores.length === 0 ? (
          <div className="empty-card">Sin proveedores registrados todavía</div>
        ) : porCentro ? (
          porCentro.map(({ centro, proveedores: proveedoresDelCentro }) => (
            <div key={centro} style={{ marginBottom: 16 }}>
              <p className="panel-section-label" style={{ marginTop: 12 }}>
                🏢 {centro} ({proveedoresDelCentro.length})
              </p>
              {proveedoresDelCentro.map((p) => renderProveedor(p))}
            </div>
          ))
        ) : (
          proveedores.map((p) => renderProveedor(p))
        )}
      </div>
    </div>
  );
}
