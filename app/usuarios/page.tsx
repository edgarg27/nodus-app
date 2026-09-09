"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Usuario = {
  id: string;
  nombre: string | null;
  email: string | null;
  rol: string | null;
  centro: string | null;
};

const ROLES_STAFF = [
  { id: "admin", label: "Admin" },
  { id: "superadmin", label: "Superadmin" },
  { id: "gerente", label: "Gerente" },
  { id: "sistemas", label: "Sistemas" },
  { id: "operaciones", label: "Operaciones" },
  { id: "cobranza", label: "Cobranza" },
  { id: "atencion_cliente", label: "Atención al Cliente" },
  { id: "diseno", label: "Diseño" },
];

const ROL_ICONO: Record<string, string> = {
  admin: "🧑‍💼",
  superadmin: "👑",
  gerente: "👑",
  sistemas: "🖥️",
  operaciones: "🔧",
  cobranza: "💰",
  atencion_cliente: "🎧",
  diseno: "🎨",
};

export default function UsuariosPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [form, setForm] = useState({
    nombre: "",
    email: "",
    rol: "admin",
    centro: "",
    usarPassword: false,
    password: "",
  });

  useEffect(() => {
    fetchTodo();
  }, []);

  async function fetchTodo() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: perfil } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
    setMiRol(perfil?.rol || "");

    const { data } = await supabase
      .from("profiles")
      .select("id, nombre, email, rol, centro")
      .neq("rol", "cliente")
      .order("rol")
      .order("nombre");
    setUsuarios(data || []);
    setLoading(false);
  }

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    setGuardando(true);

    const res = await fetch("/api/gestion-usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: form.nombre,
        email: form.email,
        rol: form.rol,
        centro: form.centro || null,
        password: form.usarPassword ? form.password : undefined,
      }),
    });
    const data = await res.json();
    setGuardando(false);

    if (!res.ok) {
      setError(data.error || "No se pudo crear la cuenta");
      return;
    }

    setMensaje(
      form.usarPassword
        ? `✓ Cuenta creada. Ya puede entrar con ${form.email} y la contraseña que pusiste.`
        : `✓ Cuenta creada. Le llegó un correo a ${form.email} para que ponga su contraseña.`
    );
    setForm({ nombre: "", email: "", rol: "admin", centro: "", usarPassword: false, password: "" });
    setMostrarForm(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTodo();
  }

  async function borrarUsuario(u: Usuario) {
    if (!confirm(`¿Borrar la cuenta de ${u.nombre || u.email}? Esto es permanente y no se puede deshacer.`)) return;
    setBorrando(u.id);
    setError("");
    const res = await fetch("/api/gestion-usuarios", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    });
    const data = await res.json();
    setBorrando(null);
    if (!res.ok) {
      setError(data.error || "No se pudo borrar la cuenta");
      return;
    }
    fetchTodo();
  }

  const sinPermiso = !loading && miRol !== "superadmin" && miRol !== "gerente";

  return (
    <div className="rep-page">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Gestión de Usuarios</p>
        <p className="rep-sub">Cuentas de staff (no clientes)</p>
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
        ) : sinPermiso ? (
          <div className="empty-card">Solo superadmin o gerente pueden entrar aquí.</div>
        ) : (
          <>
            <button className="btn-enviar" style={{ marginBottom: 12 }} onClick={() => setMostrarForm((v) => !v)}>
              {mostrarForm ? "Cancelar" : "+ Nueva cuenta de staff"}
            </button>

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
            {mensaje && <p style={{ color: "#0F6E56", fontSize: 13 }}>{mensaje}</p>}

            {mostrarForm && (
              <form className="form-card" onSubmit={crearUsuario} style={{ marginBottom: 16 }}>
                <div className="tel-form-grid">
                  <input
                    placeholder="Nombre completo"
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    required
                  />
                  <input
                    type="email"
                    placeholder="Correo"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                  <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
                    {ROLES_STAFF.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Centro (opcional para roles globales)"
                    value={form.centro}
                    onChange={(e) => setForm({ ...form, centro: e.target.value })}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" }}>
                  <input
                    type="checkbox"
                    checked={form.usarPassword}
                    onChange={(e) => setForm({ ...form, usarPassword: e.target.checked })}
                  />
                  Ponerle la contraseña yo mismo (en vez de mandarle invitación por correo)
                </label>

                {form.usarPassword && (
                  <input
                    type="password"
                    placeholder="Contraseña"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={form.usarPassword}
                  />
                )}

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
                  <span className="btn-enviar-text">Crear cuenta</span>
                </button>
              </form>
            )}

            <p className="panel-section-label">Cuentas de staff ({usuarios.length})</p>
            {usuarios.length === 0 ? (
              <div className="empty-card">Sin cuentas registradas</div>
            ) : (
              usuarios.map((u) => (
                <div className="item-card" key={u.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">
                      {ROL_ICONO[u.rol || ""] || "👤"} {u.nombre || "Sin nombre"}
                    </p>
                    <p className="item-card-sub">{u.email}</p>
                    <p className="item-card-extra">
                      {ROLES_STAFF.find((r) => r.id === u.rol)?.label || u.rol || "—"}
                      {u.centro ? ` · ${u.centro}` : ""}
                    </p>
                  </div>
                  <button className="tel-borrar-btn" onClick={() => borrarUsuario(u)} disabled={borrando === u.id}>
                    {borrando === u.id ? "..." : "🗑 Borrar"}
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
