"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "operaciones"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const CATEGORIAS_SISTEMAS = ["Redes", "Switches", "Access Points", "Cableado estructurado", "Servidores", "Cámaras", "Firewall/Router", "Otro"];
const CATEGORIAS_OPERACIONES = ["Electricidad", "Aire acondicionado", "Plomería", "Mobiliario", "Limpieza profunda", "Otro"];

type Mantenimiento = {
  id: string;
  titulo: string;
  categoria: string | null;
  fecha: string;
  descripcion: string | null;
  realizado_por: string | null;
  notas: string | null;
  archivo_url: string | null;
  proximo_mantenimiento: string | null;
  notificado_proximo: boolean | null;
};

export default function MantenimientoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [registros, setRegistros] = useState<Mantenimiento[]>([]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);
  const categoriasDisponibles = miRol === "sistemas" ? CATEGORIAS_SISTEMAS : CATEGORIAS_OPERACIONES;
  const [exportandoTodo, setExportandoTodo] = useState(false);

  async function exportarTodosLosCentros() {
    setExportandoTodo(true);
    try {
      const resultados = await Promise.all(
        centrosDisponibles.map(async (c) => {
          const { data } = await supabase
            .from("mantenimientos")
            .select("*")
            .eq("centro", c)
            .order("fecha", { ascending: false });
          return [
            c,
            (data || []).map((r: Mantenimiento) => ({
              Fecha: r.fecha,
              Título: r.titulo,
              Categoría: r.categoria || "",
              "Realizó": r.realizado_por || "",
              Descripción: r.descripcion || "",
              Notas: r.notas || "",
              "Próximo mantenimiento": r.proximo_mantenimiento || "",
            })),
          ] as const;
        })
      );
      exportarExcelPorCentro("mantenimientos", Object.fromEntries(resultados));
    } finally {
      setExportandoTodo(false);
    }
  }

  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    titulo: "",
    categoria: "",
    fecha: new Date().toISOString().split("T")[0],
    descripcion: "",
    realizado_por: "",
    notas: "",
    proximo_mantenimiento: "",
  });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

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
    const rol = profile?.rol || "";
    setMiRol(rol);
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      const c = profile?.centro || CENTROS_SUGERIDOS[0];
      setCentro(c);
      await fetchRegistros(c);
    } else {
      const c = profile?.centro || null;
      setCentro(c);
      if (c) await fetchRegistros(c);
    }
    setLoading(false);
  }

  async function cambiarCentro(c: string) {
    setCentro(c);
    setLoading(true);
    await fetchRegistros(c);
    setLoading(false);
  }

  async function fetchRegistros(c: string) {
    const { data } = await supabase
      .from("mantenimientos")
      .select("*")
      .eq("centro", c)
      .order("fecha", { ascending: false });
    setRegistros(data || []);
    checkProximosMantenimientos(data || [], c);
  }

  // Si algún registro tiene "próximo mantenimiento" dentro de los próximos 7
  // días (o ya vencido) y todavía no se avisó, manda una notificación una
  // sola vez y marca el registro para no repetirla en cada visita.
  async function checkProximosMantenimientos(lista: Mantenimiento[], c: string) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const enUnaSemana = new Date(hoy);
    enUnaSemana.setDate(hoy.getDate() + 7);

    const pendientes = lista.filter((r) => {
      if (!r.proximo_mantenimiento || r.notificado_proximo) return false;
      const fechaProximo = new Date(r.proximo_mantenimiento + "T00:00:00");
      return fechaProximo <= enUnaSemana;
    });

    for (const r of pendientes) {
      const vencido = new Date(r.proximo_mantenimiento + "T00:00:00") < hoy;
      await supabase.from("notificaciones").insert({
        centro: c,
        tipo: "proximo_mantenimiento",
        mensaje: `🔧 ${vencido ? "Venció" : "Se acerca"} el próximo mantenimiento de "${r.titulo}" (${new Date(
          r.proximo_mantenimiento + "T00:00:00"
        ).toLocaleDateString("es-MX")})`,
      });
      await supabase.from("mantenimientos").update({ notificado_proximo: true }).eq("id", r.id);
    }

    if (pendientes.length > 0) {
      setRegistros((prev) =>
        prev.map((r) => (pendientes.some((p) => p.id === r.id) ? { ...r, notificado_proximo: true } : r))
      );
    }
  }

  async function guardarMantenimiento(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!centro || !form.titulo.trim()) {
      setError("Ponle un título al mantenimiento");
      return;
    }
    setGuardando(true);

    let archivoUrl: string | null = null;
    if (archivo) {
      const fileName = `${centro}-${Date.now()}.${archivo.name.split(".").pop() || "pdf"}`;
      const { error: upErr } = await supabase.storage
        .from("mantenimientos")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (upErr) {
        setError("No se pudo subir el archivo: " + upErr.message);
        setGuardando(false);
        return;
      }
      archivoUrl = supabase.storage.from("mantenimientos").getPublicUrl(fileName).data.publicUrl;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("mantenimientos").insert({
      centro,
      titulo: form.titulo,
      categoria: form.categoria,
      fecha: form.fecha,
      descripcion: form.descripcion || null,
      realizado_por: form.realizado_por || null,
      notas: form.notas || null,
      archivo_url: archivoUrl,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      registrado_por: user?.id,
    });

    setForm({
      titulo: "",
      categoria: categoriasDisponibles[0],
      fecha: new Date().toISOString().split("T")[0],
      descripcion: "",
      realizado_por: "",
      notas: "",
      proximo_mantenimiento: "",
    });
    setArchivo(null);
    setMostrarForm(false);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchRegistros(centro);
  }

  async function borrarMantenimiento(id: string) {
    if (!confirm("¿Borrar este registro de mantenimiento?")) return;
    await supabase.from("mantenimientos").delete().eq("id", id);
    if (centro) fetchRegistros(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Mantenimiento</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => cambiarCentro(e.target.value)}>
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
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Historial ({registros.length})
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-exportar"
                  disabled={exportandoTodo}
                  onClick={() =>
                    esGlobal
                      ? exportarTodosLosCentros()
                      : exportarExcel(
                          `mantenimientos-${centro}`,
                          registros.map((r) => ({
                            Fecha: r.fecha,
                            Título: r.titulo,
                            Categoría: r.categoria || "",
                            "Realizó": r.realizado_por || "",
                            Descripción: r.descripcion || "",
                            Notas: r.notas || "",
                            "Próximo mantenimiento": r.proximo_mantenimiento || "",
                          }))
                        )
                  }
                >
                  {exportandoTodo ? "Generando..." : esGlobal ? "📥 Excel (todos los centros)" : "📥 Excel"}
                </button>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarForm((v) => !v)}
                >
                  {mostrarForm ? "Cancelar" : "+ Registrar"}
                </button>
              </div>
            </div>

            {mostrarForm && (
              <form className="form-card" onSubmit={guardarMantenimiento}>
                <div className="tel-form-grid">
                  <input
                    placeholder="Título (ej. Cambio de filtro AC)"
                    value={form.titulo}
                    onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  />
                  <select
                    value={form.categoria}
                    onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                  >
                    {categoriasDisponibles.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  />
                  <input
                    placeholder="Lo realizó (persona/proveedor)"
                    value={form.realizado_por}
                    onChange={(e) => setForm({ ...form, realizado_por: e.target.value })}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Descripción"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Notas (opcional)"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                />
                <p className="sub-label">Próximo mantenimiento (opcional)</p>
                <input
                  type="date"
                  value={form.proximo_mantenimiento}
                  onChange={(e) => setForm({ ...form, proximo_mantenimiento: e.target.value })}
                />
                <p style={{ fontSize: 11, color: "#aaa", margin: 0 }}>
                  Si la pones, te avisamos por notificación cuando falten 7 días o menos.
                </p>
                <p className="sub-label">Reporte/foto (opcional)</p>
                <input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
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
                  <span className="btn-enviar-text">Guardar mantenimiento</span>
                </button>
              </form>
            )}

            {registros.length === 0 ? (
              <div className="empty-card">Sin mantenimientos registrados</div>
            ) : (
              registros.map((r) => (
                <div className="mtto-card" key={r.id}>
                  <div className="mtto-fecha-badge">
                    {new Date(r.fecha + "T00:00:00").toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>{r.titulo}</p>
                    <p style={{ fontSize: 12, color: "#888", margin: "2px 0 0" }}>
                      {r.categoria || "Sin categoría"}
                      {r.realizado_por ? ` · ${r.realizado_por}` : ""}
                    </p>
                    {r.descripcion && (
                      <p style={{ fontSize: 13, color: "#555", margin: "6px 0 0" }}>{r.descripcion}</p>
                    )}
                    {r.notas && <p style={{ fontSize: 12, color: "#aaa", margin: "4px 0 0" }}>{r.notas}</p>}
                    {r.proximo_mantenimiento &&
                      (() => {
                        const hoy = new Date();
                        hoy.setHours(0, 0, 0, 0);
                        const fechaProximo = new Date(r.proximo_mantenimiento + "T00:00:00");
                        const vencido = fechaProximo < hoy;
                        const diasFaltan = Math.round((fechaProximo.getTime() - hoy.getTime()) / 86400000);
                        const cerca = !vencido && diasFaltan <= 7;
                        return (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: vencido ? "#FCEBEB" : cerca ? "#FEF6D8" : "#E1F5EE",
                              color: vencido ? "#A32D2D" : cerca ? "#8A6D00" : "#0F6E56",
                            }}
                          >
                            🔧 {vencido ? "Venció" : "Próximo"}:{" "}
                            {fechaProximo.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" })}
                          </span>
                        );
                      })()}
                    {r.archivo_url && (
                      <a
                        className="ver-pdf-btn"
                        href={r.archivo_url}
                        target="_blank"
                        download
                        style={{ marginTop: 8, display: "inline-block" }}
                      >
                        📥 Ver archivo
                      </a>
                    )}
                  </div>
                  <button className="tel-borrar-btn" onClick={() => borrarMantenimiento(r.id)}>
                    🗑
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
