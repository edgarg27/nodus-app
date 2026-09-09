"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";

type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  tipo: string | null;
  centro: string | null;
  proveedor_id: string | null;
  factura_url: string | null;
  comprobante_pago_url: string | null;
  registrado_por_nombre: string | null;
  created_at: string;
};

type Proveedor = { id: string; nombre: string };

// A diferencia de /tickets, aquí cada quien captura sus PROPIOS gastos —
// por eso sistemas también se queda scopeado a su centro (no es "global"
// en esta pantalla), a menos que sea de administración/cobranza.
const ROLES_GLOBALES = ["superadmin", "gerente", "cobranza"];

// Los gastos se dividen por área además de por centro: sistemas, el
// admin del centro y operaciones cada quien ve y registra solo los
// suyos (mismos valores que ya usa la gráfica "Gastos por departamento"
// del panel de cobranza).
const AREA_INFO: Record<string, { icono: string; label: string }> = {
  sistemas: { icono: "🖥️", label: "Sistemas" },
  operaciones: { icono: "🔧", label: "Operaciones" },
  admin: { icono: "🧑‍💼", label: "Administración" },
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function GastosPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [miId, setMiId] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [esGlobal, setEsGlobal] = useState(false);

  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [proveedorId, setProveedorId] = useState("");
  const [factura, setFactura] = useState<File[]>([]);
  const [comprobante, setComprobante] = useState<File[]>([]);

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("rol, centro, nombre")
      .eq("id", user.id)
      .single();
    const rolActual = profile?.rol || "";
    const centroActual = profile?.centro || null;
    const globalActual = ROLES_GLOBALES.includes(rolActual);
    setMiRol(rolActual);
    setMiCentro(centroActual);
    setMiId(user.id);
    setMiNombre(profile?.nombre || "");
    setEsGlobal(globalActual);

    let query = supabase.from("gastos").select("*").order("fecha", { ascending: false });
    if (!globalActual) {
      // Cada área ve solo lo suyo: mismo centro Y mismo tipo de gasto
      // (sistemas no ve los gastos de operaciones ni los del admin del
      // centro, aunque estén en el mismo lugar).
      if (centroActual) query = query.eq("centro", centroActual);
      if (AREA_INFO[rolActual]) query = query.eq("tipo", rolActual);
    }
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError("No se pudieron cargar los gastos.");
    } else {
      setGastos(data || []);
    }

    // Proveedores disponibles para vincular (de su propio centro)
    if (centroActual) {
      const { data: provs } = await supabase
        .from("proveedores")
        .select("id, nombre")
        .eq("centro", centroActual)
        .order("nombre");
      setProveedores(provs || []);
    }

    setLoading(false);
  }

  function resetForm() {
    setConcepto("");
    setCategoria("");
    setMonto("");
    setFecha(hoyISO());
    setProveedorId("");
    setFactura([]);
    setComprobante([]);
  }

  async function subirArchivo(archivo: File, prefijo: string) {
    const fileName = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
      archivo.name.split(".").pop() || "jpg"
    }`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
    if (uploadError) return null;
    const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function registrarGasto(e: React.FormEvent) {
    e.preventDefault();
    if (!concepto.trim() || !monto || !fecha || !miCentro) {
      setError("Completa concepto, monto, fecha — y que tu cuenta tenga un centro asignado");
      return;
    }
    setGuardando(true);
    setError("");

    const facturaUrl = factura[0] ? await subirArchivo(factura[0], "factura") : null;
    const comprobanteUrl = comprobante[0] ? await subirArchivo(comprobante[0], "pago") : null;

    let { error: insertError } = await supabase.from("gastos").insert({
      concepto: concepto.trim(),
      categoria: categoria.trim() || null,
      monto: Number(monto),
      fecha,
      tipo: miRol,
      centro: miCentro,
      proveedor_id: proveedorId || null,
      factura_url: facturaUrl,
      comprobante_pago_url: comprobanteUrl,
      registrado_por: miId,
      registrado_por_nombre: miNombre,
    });

    // Si todavía no corriste la migración que agrega estas columnas
    // nuevas a "gastos", reintenta con solo los campos que ya existían
    // para que el gasto por lo menos quede registrado.
    if (insertError && /(proveedor_id|factura_url|comprobante_pago_url|registrado_por)/i.test(insertError.message || "")) {
      ({ error: insertError } = await supabase.from("gastos").insert({
        concepto: concepto.trim(),
        categoria: categoria.trim() || null,
        monto: Number(monto),
        fecha,
        tipo: miRol,
        centro: miCentro,
      }));
    }

    if (insertError) {
      setError("No se pudo registrar el gasto. Intenta de nuevo.");
      setGuardando(false);
      return;
    }

    resetForm();
    setMostrarForm(false);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    fetchTodo();
  }

  const proveedorNombre = (id: string | null) => proveedores.find((p) => p.id === id)?.nombre;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Gastos</p>
        <p className="rep-sub">
          {esGlobal
            ? "Todos los centros y áreas"
            : `${AREA_INFO[miRol] ? AREA_INFO[miRol].icono + " " + AREA_INFO[miRol].label : ""} · ${
                miCentro || "Tu centro"
              }`}
        </p>
      </div>

      <div className="rep-content">
        <button className="btn-enviar" style={{ marginBottom: 4 }} onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Registrar gasto"}
        </button>

        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        {mostrarForm && (
          <form className="form-card" onSubmit={registrarGasto}>
            <div className="tel-form-grid">
              <input
                placeholder="Concepto (ej. Papelería, reparación...)"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                required
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Monto"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                required
              />
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              <input
                placeholder="Categoría (opcional)"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              />
            </div>

            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Sin proveedor (opcional)</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            {proveedores.length === 0 && (
              <p style={{ fontSize: 11, color: "#999", margin: 0 }}>
                Todavía no tienes proveedores registrados en tu centro —{" "}
                <a href="/proveedores" style={{ color: "#f07e3a" }}>
                  agrega uno aquí
                </a>
                .
              </p>
            )}

            <p className="sub-label">Factura</p>
            <FileDropzone
              files={factura}
              onChange={setFactura}
              maxFiles={1}
              accept="image/*,.pdf"
            />

            <p className="sub-label">Comprobante de pago</p>
            <FileDropzone
              files={comprobante}
              onChange={setComprobante}
              maxFiles={1}
              accept="image/*,.pdf"
            />

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
              <span className="btn-enviar-text">Guardar gasto</span>
            </button>
          </form>
        )}

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          {esGlobal
            ? "Gastos registrados"
            : `Mis gastos de ${AREA_INFO[miRol]?.label || "tu área"}`}{" "}
          ({gastos.length})
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
        ) : gastos.length === 0 ? (
          <div className="empty-card">Sin gastos registrados todavía</div>
        ) : (
          gastos.map((g) => (
            <div className="item-card" key={g.id}>
              <div className="item-card-info">
                <p className="item-card-titulo">{g.concepto}</p>
                <p className="item-card-sub">
                  {new Date(g.fecha).toLocaleDateString("es-MX")}
                  {g.categoria ? ` · ${g.categoria}` : ""}
                  {proveedorNombre(g.proveedor_id) ? ` · ${proveedorNombre(g.proveedor_id)}` : ""}
                </p>
                <p className="item-card-extra">
                  {g.centro || "—"}
                  {g.registrado_por_nombre ? ` · Registró: ${g.registrado_por_nombre}` : ""}
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  {g.factura_url && (
                    <a href={g.factura_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                      📎 Factura
                    </a>
                  )}
                  {g.comprobante_pago_url && (
                    <a
                      href={g.comprobante_pago_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, color: "#185FA5" }}
                    >
                      🧾 Comprobante de pago
                    </a>
                  )}
                </div>
              </div>
              <p className="item-card-monto">${Number(g.monto).toLocaleString("es-MX")}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
