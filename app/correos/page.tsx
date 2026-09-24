"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";
import { construirHtmlComunicado } from "@/lib/comunicado";

type Cliente = { id: string; nombre: string; email: string; empresa: string | null; numero_oficina: string | null };

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const BUCKET_IMAGENES = "comunicados";

type Resultado = { clientes: number; omitidos: number; fallidos: number; desde: string; usaSuCorreo: boolean };

export default function CorreosPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [miEmail, setMiEmail] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");

  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [imagenes, setImagenes] = useState<File[]>([]);
  const [copiaParaMi, setCopiaParaMi] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState("");

  const esGlobal = ROLES_GLOBALES.includes(miRol);
  const usaSuCorreo = /@nodusbc\.mx$/i.test(miEmail);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro, nombre, email").eq("id", user.id).single();
    setMiRol(profile?.rol || "");
    setMiNombre(profile?.nombre || "");
    setMiEmail(profile?.email || user.email || "");
    setCentro(profile?.centro || null);

    let query = supabase
      .from("profiles")
      .select("id, nombre, email, empresa, numero_oficina")
      .eq("rol", "cliente")
      .eq("activo", true)
      .order("nombre");
    if (!ROLES_GLOBALES.includes(profile?.rol || "") && profile?.centro) {
      query = query.eq("centro", profile.centro);
    }
    const { data } = await query;
    setClientes(data || []);
    setLoading(false);
  }

  const clientesFiltrados = useMemo(() => {
    if (!busqueda.trim()) return clientes;
    const q = busqueda.toLowerCase();
    return clientes.filter((c) => c.nombre?.toLowerCase().includes(q) || c.empresa?.toLowerCase().includes(q));
  }, [busqueda, clientes]);

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function seleccionarTodos() {
    if (seleccionados.size === clientesFiltrados.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(clientesFiltrados.map((c) => c.id)));
    }
  }

  // Vista previa: el mismo HTML que recibirá el cliente, con las imágenes
  // todavía locales (se suben hasta que se envía).
  const urlsLocales = useMemo(() => imagenes.map((f) => URL.createObjectURL(f)), [imagenes]);
  useEffect(() => () => urlsLocales.forEach((u) => URL.revokeObjectURL(u)), [urlsLocales]);
  const htmlPreview = useMemo(
    () => construirHtmlComunicado({ cuerpo, imagenes: urlsLocales, remitente: miNombre || undefined }),
    [cuerpo, urlsLocales, miNombre]
  );

  function pedirConfirmacion() {
    setError("");
    if (seleccionados.size === 0) {
      setError("Selecciona al menos un destinatario");
      return;
    }
    if (!asunto.trim() || !cuerpo.trim()) {
      setError("Falta el asunto o el contenido del correo");
      return;
    }
    setConfirmando(true);
  }

  async function enviarComunicado() {
    setConfirmando(false);
    setEnviando(true);
    setError("");
    try {
      // 1) Sube las imágenes al bucket público (los correos necesitan un link
      //    que cualquiera pueda abrir).
      const urls: string[] = [];
      for (const archivo of imagenes) {
        const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
        const nombre = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET_IMAGENES)
          .upload(nombre, archivo, { contentType: archivo.type });
        if (upErr) throw new Error("No se pudo subir una imagen: " + upErr.message);
        urls.push(supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(nombre).data.publicUrl);
      }

      // 2) El servidor manda un correo por cliente.
      const res = await fetch("/api/comunicados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asunto,
          cuerpo,
          imagenes: urls,
          destinatarioIds: Array.from(seleccionados),
          copiaParaMi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el correo");
      setResultado({
        clientes: data.clientes,
        omitidos: data.omitidos,
        fallidos: data.fallidos,
        desde: data.desde,
        usaSuCorreo: data.usaSuCorreo,
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo enviar el correo. Intenta de nuevo.");
    }
    setEnviando(false);
  }

  if (resultado) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Correo enviado</p>
        </div>
        <div className="sub-content">
          <div className="cli-al-corriente">
            <p className="cli-al-corriente-icon">✅</p>
            <p className="cli-al-corriente-text">Comunicado enviado</p>
            <p className="cli-al-corriente-sub">Se mandó a {resultado.clientes} cliente(s).</p>
            <p className="cli-al-corriente-sub">
              {resultado.usaSuCorreo
                ? `Salió desde ${resultado.desde}; las respuestas te llegan a ti.`
                : `Salió desde el correo general de Nodus; las respuestas te llegan a ${miEmail}.`}
            </p>
            {resultado.omitidos > 0 && (
              <p className="cli-al-corriente-sub">{resultado.omitidos} destinatario(s) no se incluyeron (sin correo o inactivos).</p>
            )}
            {resultado.fallidos > 0 && (
              <p className="cli-al-corriente-sub" style={{ color: "#A32D2D" }}>
                {resultado.fallidos} correo(s) no se pudieron entregar al proveedor.
              </p>
            )}
          </div>
          <button
            className="reservar-btn"
            onClick={() => {
              setResultado(null);
              setAsunto("");
              setCuerpo("");
              setImagenes([]);
              setSeleccionados(new Set());
            }}
          >
            Enviar otro comunicado
          </button>
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
        <p className="rep-title">Correos masivos</p>
        <p className="rep-sub">
          {esGlobal ? "Envía comunicados a clientes de cualquier centro" : `Clientes de ${centro || "tu centro"}`}
        </p>
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
            <p className="panel-section-label">Redactar comunicado</p>
            <div className="form-card">
              <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
                {usaSuCorreo ? (
                  <>
                    ✉️ Saldrá desde <b>{miNombre || "tu nombre"} &lt;{miEmail}&gt;</b> y las respuestas te llegan a ti.
                  </>
                ) : (
                  <>
                    ✉️ Saldrá desde el correo general de Nodus y las respuestas llegarán a <b>{miEmail || "tu correo"}</b>{" "}
                    (tu cuenta no tiene correo @nodusbc.mx).
                  </>
                )}
              </p>
              <input
                type="text"
                placeholder="Asunto del correo"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
              />
              <textarea
                placeholder="Escribe el mensaje... (cada línea se convierte en un párrafo)"
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                style={{ minHeight: 160 }}
              />
              <p className="sub-label">Imágenes (opcional) — se ven debajo del mensaje, en este orden</p>
              <FileDropzone
                files={imagenes}
                onChange={setImagenes}
                maxFiles={6}
                accept="image/*"
                maxSizeMB={5}
                etiquetaTipos="Imágenes JPG o PNG"
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#444" }}>
                <input type="checkbox" checked={copiaParaMi} onChange={(e) => setCopiaParaMi(e.target.checked)} />
                Enviarme una copia a {miEmail || "mi correo"}
              </label>
            </div>

            {(asunto || cuerpo || imagenes.length > 0) && (
              <div className="correo-preview">
                <p className="correo-preview-asunto">{asunto || "(sin asunto)"}</p>
                <iframe
                  title="Vista previa del correo"
                  srcDoc={htmlPreview}
                  sandbox=""
                  style={{ width: "100%", height: 420, border: "1px solid #eee", borderRadius: 10, background: "#fff" }}
                />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Destinatarios ({seleccionados.size} de {clientesFiltrados.length} seleccionados)
              </p>
              <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={seleccionarTodos}>
                {seleccionados.size === clientesFiltrados.length ? "Deseleccionar todos" : "Seleccionar todos"}
              </button>
            </div>

            <input
              type="text"
              placeholder="Buscar por nombre o empresa..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            />

            {clientesFiltrados.length === 0 ? (
              <div className="empty-card">Sin clientes que coincidan</div>
            ) : (
              clientesFiltrados.map((c) => (
                <div
                  key={c.id}
                  className={"destinatario-chip" + (seleccionados.has(c.id) ? " seleccionado" : "")}
                  onClick={() => toggleSeleccionado(c.id)}
                >
                  <span className="destinatario-check">{seleccionados.has(c.id) ? "✓" : ""}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>
                      {c.nombre} {c.empresa ? `· ${c.empresa}` : ""}
                    </p>
                    <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                      {c.email} {c.numero_oficina ? `· Oficina ${c.numero_oficina}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button className="reservar-btn" onClick={pedirConfirmacion} disabled={enviando}>
              {enviando ? "Enviando..." : `📧 Enviar a ${seleccionados.size} cliente(s)`}
            </button>
          </>
        )}
      </div>

      {confirmando && (
        <div className="modal-overlay" onClick={() => setConfirmando(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Enviar comunicado</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Enviar &quot;{asunto}&quot; a {seleccionados.size} cliente(s)
              {imagenes.length > 0 ? `, con ${imagenes.length} imagen(es)` : ""}? Una vez enviado no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={enviarComunicado}>
                📧 Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
