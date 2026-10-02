"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { CENTROS, useCentroAdmin } from "@/lib/useCentroAdmin";
import { pedirLinkFirmado } from "@/lib/storage";
import FileDropzone from "@/app/soporte/FileDropzone";
import AvisoExito from "@/app/components/AvisoExito";

// Expediente de clientes: los archivos que la administradora tenga de cada
// cliente (identificación, constancia fiscal, comprobantes, contrato…).
// Además del checklist fijo de abajo (DOCUMENTOS_REQUERIDOS), se puede subir
// cualquier otro archivo libre, con el nombre que se quiera. Admin ve los
// clientes de su centro; superadmin y gerente, todos (con selector). El
// cliente no ve su expediente. Tabla y bucket privado en
// migracion_expedientes_clientes.sql; la columna tipo_documento que liga un
// archivo a una casilla del checklist está en
// migracion_expediente_tipo_documento.sql.

const BUCKET = "expedientes-clientes";

// Checklist fijo que se muestra arriba de "Otros documentos", con su propio
// botón de carga y ✓/✗ según si ya se subió. `clave` se guarda en
// expediente_archivos.tipo_documento; si se sube otro archivo para la misma
// clave, se reemplaza (ver migracion_expediente_tipo_documento.sql).
const DOCUMENTOS_REQUERIDOS: { clave: string; etiqueta: string }[] = [
  { clave: "deposito_garantia", etiqueta: "Depósito en garantía" },
  { clave: "mes_renta_iva", etiqueta: "Mes de renta + IVA" },
  { clave: "opinion_cumplimiento", etiqueta: "Opinión de cumplimiento de obligaciones fiscales" },
  { clave: "acta_constitutiva", etiqueta: "Acta constitutiva" },
  { clave: "identificacion_oficial", etiqueta: "Identificación oficial" },
  { clave: "cif", etiqueta: "Código de identificación fiscal (CIF)" },
  { clave: "comprobante_domicilio", etiqueta: "Comprobante de domicilio" },
];

type Cliente = {
  id: string;
  nombre: string | null;
  email: string | null;
  empresa: string | null;
  rfc: string | null;
  telefono: string | null;
  numero_oficina: string | null;
  tipo_oficina: string | null;
  numero_usuario: string | number | null;
  activo: boolean | null;
  centro: string | null;
};

type Contrato = {
  id: string;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  renta_mensual: number | null;
  deposito_garantia: number | null;
  estatus: string | null;
  forma_pago: string | null;
  archivo_url: string | null;
  archivo_firmado_url: string | null;
  created_at: string;
};

type Archivo = {
  id: string;
  cliente_id: string;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  tamano_bytes: number | null;
  subido_por_nombre: string | null;
  tipo_documento: string | null;
  created_at: string;
};

const ESTATUS_CONTRATO: Record<string, string> = {
  vigente: "Vigente",
  pre_aprobado: "Pre-aprobado",
  rechazado: "Rechazado",
  inactivo_pagado: "Baja (pagado)",
  inactivo_debe: "Baja (con adeudo)",
};

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function iconoArchivo(a: Archivo) {
  const mime = a.tipo_mime || "";
  const nombre = a.nombre.toLowerCase();
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf" || nombre.endsWith(".pdf")) return "📕";
  if (/\.(xls|xlsx|csv)$/.test(nombre)) return "📊";
  if (/\.(doc|docx|txt)$/.test(nombre)) return "📄";
  return "📎";
}

function fmtFecha(f: string | null) {
  if (!f) return "—";
  return new Date(f.length === 10 ? f + "T00:00:00" : f).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtMoneda(n: number | null) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function oficinaDe(c: Cliente) {
  if (!c.numero_oficina) return c.tipo_oficina || "";
  return `${c.tipo_oficina || "Oficina"} ${c.numero_oficina}`;
}

export default function ExpedientesPage() {
  const supabase = createClient();
  const { cargando, nombre, userId, centro, setCentro, esGlobal, permitido } = useCentroAdmin(["gerente"], ["gerente"]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [conteoPorCliente, setConteoPorCliente] = useState<Record<string, number>>({});
  const [cargandoLista, setCargandoLista] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [verBajas, setVerBajas] = useState(false);
  const [soloSinArchivos, setSoloSinArchivos] = useState(false);

  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const [mostrarSubida, setMostrarSubida] = useState(false);
  const [archivosNuevos, setArchivosNuevos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState<{ actual: number; total: number } | null>(null);
  const [abriendoId, setAbriendoId] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState<{ id: string; valor: string } | null>(null);
  const [borrando, setBorrando] = useState<Archivo | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ titulo: string; mensaje: string } | null>(null);

  // Checklist de documentos requeridos: un solo <input type="file"> oculto
  // compartido por todas las filas; claveEnCurso dice a cuál casilla
  // corresponde el archivo que se acaba de elegir.
  const inputRequeridoRef = useRef<HTMLInputElement>(null);
  const [claveEnCurso, setClaveEnCurso] = useState<string | null>(null);
  const [subiendoClave, setSubiendoClave] = useState<string | null>(null);

  useEffect(() => {
    if (centro && permitido) {
      setClienteSel(null);
      setBusqueda("");
      fetchClientes(centro);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, permitido]);

  async function fetchClientes(c: string) {
    setCargandoLista(true);
    const [{ data: cls }, { data: arcs }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nombre, email, empresa, rfc, telefono, numero_oficina, tipo_oficina, numero_usuario, activo, centro")
        .eq("rol", "cliente")
        .eq("centro", c)
        .order("nombre"),
      supabase.from("expediente_archivos").select("cliente_id").eq("centro", c),
    ]);
    const conteo: Record<string, number> = {};
    (arcs || []).forEach((a: { cliente_id: string }) => (conteo[a.cliente_id] = (conteo[a.cliente_id] || 0) + 1));
    setClientes((cls as Cliente[]) || []);
    setConteoPorCliente(conteo);
    setCargandoLista(false);
  }

  async function abrirCliente(c: Cliente) {
    setClienteSel(c);
    setError("");
    setMostrarSubida(false);
    setArchivosNuevos([]);
    setRenombrando(null);
    setCargandoDetalle(true);
    await fetchDetalle(c.id);
    setCargandoDetalle(false);
  }

  async function fetchDetalle(clienteId: string) {
    const [{ data: cts }, { data: arcs }] = await Promise.all([
      supabase
        .from("contratos")
        .select(
          "id, fecha_inicio, fecha_vencimiento, renta_mensual, deposito_garantia, estatus, forma_pago, archivo_url, archivo_firmado_url, created_at"
        )
        .eq("user_id", clienteId)
        .order("created_at", { ascending: false }),
      supabase.from("expediente_archivos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false }),
    ]);
    setContratos((cts as Contrato[]) || []);
    setArchivos((arcs as Archivo[]) || []);
  }

  const clientesVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return clientes.filter((c) => {
      if (!verBajas && c.activo === false) return false;
      if (soloSinArchivos && (conteoPorCliente[c.id] || 0) > 0) return false;
      if (!q) return true;
      return [c.nombre, c.empresa, c.email, c.rfc, oficinaDe(c), c.numero_usuario != null ? `N-${c.numero_usuario}` : ""]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [clientes, busqueda, verBajas, soloSinArchivos, conteoPorCliente]);

  // El contrato que se muestra arriba: el vigente, o el más reciente.
  const contratoPrincipal = contratos.find((c) => c.estatus === "vigente") || contratos[0] || null;

  // ---------- Archivos ----------
  async function subirArchivos() {
    if (!clienteSel || archivosNuevos.length === 0) return;
    setError("");
    const centroCliente = clienteSel.centro || centro;
    if (!centroCliente) return;
    const total = archivosNuevos.length;
    let subidos = 0;
    const fallidos: string[] = [];

    for (let i = 0; i < total; i++) {
      const archivo = archivosNuevos[i];
      setSubiendo({ actual: i + 1, total });
      const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "bin";
      const ruta = `${clienteSel.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type });
      if (upErr) {
        fallidos.push(archivo.name);
        continue;
      }
      const { error: insErr } = await supabase.from("expediente_archivos").insert({
        cliente_id: clienteSel.id,
        centro: centroCliente,
        // Se guarda sin extensión: es el nombre que se ve y se puede renombrar.
        nombre: archivo.name.replace(/\.[^.]+$/, "") || archivo.name,
        archivo_path: ruta,
        tipo_mime: archivo.type || null,
        tamano_bytes: archivo.size,
        subido_por: userId,
        subido_por_nombre: nombre,
      });
      if (insErr) {
        // Que no se quede un archivo huérfano en Storage si falló el registro.
        await supabase.storage.from(BUCKET).remove([ruta]);
        fallidos.push(archivo.name);
        continue;
      }
      subidos++;
    }

    setSubiendo(null);
    setArchivosNuevos([]);
    setMostrarSubida(false);
    if (fallidos.length > 0) setError(`No se pudieron subir: ${fallidos.join(", ")}`);
    if (subidos > 0) {
      setAviso({
        titulo: "¡Se agregó con éxito!",
        mensaje: `${subidos} archivo${subidos === 1 ? "" : "s"} agregado${subidos === 1 ? "" : "s"} al expediente de ${
          clienteSel.nombre || "el cliente"
        }.`,
      });
      setConteoPorCliente((prev) => ({ ...prev, [clienteSel.id]: (prev[clienteSel.id] || 0) + subidos }));
    }
    await fetchDetalle(clienteSel.id);
  }

  // Checklist: sube (o reemplaza) el archivo de una casilla fija. A
  // diferencia de subirArchivos(), aquí solo puede haber un archivo por
  // clave — si ya había uno, se borra antes de guardar el nuevo (ver
  // migracion_expediente_tipo_documento.sql).
  async function subirDocumentoRequerido(clave: string, etiqueta: string, archivo: File) {
    if (!clienteSel) return;
    setError("");
    setSubiendoClave(clave);
    const centroCliente = clienteSel.centro || centro;
    if (!centroCliente) {
      setSubiendoClave(null);
      return;
    }

    const existente = archivos.find((a) => a.tipo_documento === clave);
    if (existente) {
      await supabase.from("expediente_archivos").delete().eq("id", existente.id);
      await supabase.storage.from(BUCKET).remove([existente.archivo_path]);
    }

    const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "bin";
    const ruta = `${clienteSel.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type });
    if (upErr) {
      setSubiendoClave(null);
      setError(`No se pudo subir "${etiqueta}": ${upErr.message}`);
      await fetchDetalle(clienteSel.id);
      return;
    }

    const { error: insErr } = await supabase.from("expediente_archivos").insert({
      cliente_id: clienteSel.id,
      centro: centroCliente,
      nombre: etiqueta,
      archivo_path: ruta,
      tipo_mime: archivo.type || null,
      tamano_bytes: archivo.size,
      subido_por: userId,
      subido_por_nombre: nombre,
      tipo_documento: clave,
    });
    if (insErr) {
      await supabase.storage.from(BUCKET).remove([ruta]);
      setSubiendoClave(null);
      setError(`No se pudo subir "${etiqueta}": ${insErr.message}`);
      await fetchDetalle(clienteSel.id);
      return;
    }

    if (!existente) {
      setConteoPorCliente((prev) => ({ ...prev, [clienteSel.id]: (prev[clienteSel.id] || 0) + 1 }));
    }
    setSubiendoClave(null);
    await fetchDetalle(clienteSel.id);
  }

  function onArchivoRequeridoElegido(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo || !claveEnCurso) return;
    const doc = DOCUMENTOS_REQUERIDOS.find((d) => d.clave === claveEnCurso);
    setClaveEnCurso(null);
    if (doc) subirDocumentoRequerido(doc.clave, doc.etiqueta, archivo);
  }

  // El bucket es privado: se abre con un link firmado que caduca.
  async function abrirArchivo(a: Archivo) {
    setAbriendoId(a.id);
    setError("");
    const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(a.archivo_path, 300);
    setAbriendoId(null);
    if (signErr || !data?.signedUrl) {
      setError("No se pudo abrir el archivo: " + (signErr?.message || "intenta de nuevo"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  // Archivos que ya viven en Contratos (machote / firmado).
  async function abrirArchivoContrato(url: string, clave: string) {
    setAbriendoId(clave);
    setError("");
    const { url: firmada, error: signErr } = await pedirLinkFirmado(url);
    setAbriendoId(null);
    if (!firmada) {
      setError(signErr || "No se pudo abrir el archivo");
      return;
    }
    window.open(firmada, "_blank", "noopener");
  }

  async function confirmarRenombre() {
    if (!renombrando || !clienteSel) return;
    const valor = renombrando.valor.trim();
    if (!valor) {
      setError("El nombre no puede quedar vacío");
      return;
    }
    setError("");
    const { error: updErr } = await supabase.from("expediente_archivos").update({ nombre: valor }).eq("id", renombrando.id);
    if (updErr) {
      setError("No se pudo renombrar: " + updErr.message);
      return;
    }
    setRenombrando(null);
    await fetchDetalle(clienteSel.id);
  }

  async function borrarArchivo(a: Archivo) {
    if (!clienteSel) return;
    setError("");
    const { error: delErr } = await supabase.from("expediente_archivos").delete().eq("id", a.id);
    setBorrando(null);
    if (delErr) {
      setError("No se pudo eliminar: " + delErr.message);
      return;
    }
    await supabase.storage.from(BUCKET).remove([a.archivo_path]);
    setConteoPorCliente((prev) => ({ ...prev, [clienteSel.id]: Math.max(0, (prev[clienteSel.id] || 1) - 1) }));
    await fetchDetalle(clienteSel.id);
  }

  // ---------- Pantalla ----------
  // Los del checklist (tipo_documento set) se muestran arriba, en "Documentos
  // requeridos" — aquí solo lo que no corresponde a ninguna casilla fija.
  const archivosLibres = archivos.filter((a) => !a.tipo_documento);

  const archivosDeContrato = contratos.flatMap((c) => {
    const lista: { clave: string; titulo: string; url: string; fecha: string }[] = [];
    const etiqueta = `${fmtFecha(c.fecha_inicio)} – ${fmtFecha(c.fecha_vencimiento)}`;
    if (c.archivo_firmado_url) {
      lista.push({ clave: `firmado-${c.id}`, titulo: `Contrato firmado (${etiqueta})`, url: c.archivo_firmado_url, fecha: c.created_at });
    } else if (c.archivo_url) {
      lista.push({ clave: `contrato-${c.id}`, titulo: `Contrato (${etiqueta})`, url: c.archivo_url, fecha: c.created_at });
    }
    return lista;
  });

  return (
    <div className="panel">
      <div className="rep-header">
        {clienteSel ? (
          <button type="button" className="rep-back" onClick={() => setClienteSel(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>
            ← Regresar
          </button>
        ) : (
          <a className="rep-back" href="/dashboard">
            ← Regresar
          </a>
        )}
        <p className="rep-title">Expediente de clientes</p>
        <p className="rep-sub">{clienteSel ? clienteSel.nombre || "Cliente" : centro || "Selecciona un centro"}</p>
        {esGlobal && !clienteSel && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {CENTROS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content">
        {cargando ? (
          <p style={{ color: "#888", fontSize: 13 }}>Cargando…</p>
        ) : !permitido ? (
          <div className="empty-card">No tienes permiso para ver este módulo</div>
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : !clienteSel ? (
          // ---------- Lista de clientes ----------
          <>
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 10px" }}>
              Elige un cliente para ver y subir los documentos de su expediente: identificación, constancia fiscal,
              comprobantes, contrato o lo que tengas de él.
            </p>
            <input
              type="text"
              placeholder="Buscar por nombre, empresa, RFC, oficina o N.º de usuario"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="expediente-buscador"
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
              <button
                type="button"
                className={"filtro-chip" + (soloSinArchivos ? " active" : "")}
                onClick={() => setSoloSinArchivos((v) => !v)}
              >
                Sin documentos
              </button>
              <button type="button" className={"filtro-chip" + (verBajas ? " active" : "")} onClick={() => setVerBajas((v) => !v)}>
                Incluir dados de baja
              </button>
            </div>

            {cargandoLista ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando clientes…</p>
            ) : clientesVisibles.length === 0 ? (
              <div className="empty-card">{busqueda || soloSinArchivos ? "Ningún cliente coincide" : "No hay clientes en este centro"}</div>
            ) : (
              <div className="expediente-lista">
                {clientesVisibles.map((c) => {
                  const n = conteoPorCliente[c.id] || 0;
                  return (
                    <button type="button" key={c.id} className="expediente-cliente-card" onClick={() => abrirCliente(c)}>
                      <div style={{ minWidth: 0 }}>
                        <p className="expediente-cliente-nombre">
                          {c.nombre || c.email || "Cliente"}
                          {c.activo === false && <span className="expediente-badge-baja">Baja</span>}
                        </p>
                        <p className="expediente-cliente-extra">
                          {[c.empresa, oficinaDe(c), c.numero_usuario != null ? `N-${c.numero_usuario}` : null].filter(Boolean).join(" · ") ||
                            c.email}
                        </p>
                      </div>
                      <span className={"expediente-conteo" + (n === 0 ? " vacio" : "")}>
                        {n === 0 ? "Sin documentos" : `${n} documento${n === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          // ---------- Expediente de un cliente ----------
          <>
            <div className="form-card expediente-datos">
              <p className="sub-label" style={{ marginTop: 0 }}>Datos del cliente</p>
              <div className="expediente-datos-grid">
                <Dato titulo="Cliente" valor={clienteSel.nombre} />
                <Dato titulo="Empresa" valor={clienteSel.empresa} />
                <Dato titulo="RFC" valor={clienteSel.rfc} />
                <Dato titulo="Correo" valor={clienteSel.email} />
                <Dato titulo="Teléfono" valor={clienteSel.telefono} />
                <Dato titulo="Oficina" valor={oficinaDe(clienteSel)} />
                <Dato titulo="N.º de usuario" valor={clienteSel.numero_usuario != null ? `N-${clienteSel.numero_usuario}` : null} />
                <Dato titulo="Centro" valor={clienteSel.centro} />
              </div>
              {contratoPrincipal && (
                <>
                  <p className="sub-label">Contrato</p>
                  <div className="expediente-datos-grid">
                    <Dato titulo="Estatus" valor={ESTATUS_CONTRATO[contratoPrincipal.estatus || ""] || contratoPrincipal.estatus} />
                    <Dato titulo="Fecha inicial" valor={fmtFecha(contratoPrincipal.fecha_inicio)} />
                    <Dato titulo="Fecha final" valor={fmtFecha(contratoPrincipal.fecha_vencimiento)} />
                    <Dato titulo="Renta" valor={fmtMoneda(contratoPrincipal.renta_mensual)} />
                    <Dato titulo="Depósito" valor={fmtMoneda(contratoPrincipal.deposito_garantia)} />
                    <Dato
                      titulo="Forma de pago"
                      valor={
                        contratoPrincipal.forma_pago === "mensual"
                          ? "Mes a mes"
                          : contratoPrincipal.forma_pago === "adelantado"
                          ? "Por adelantado"
                          : null
                      }
                    />
                  </div>
                </>
              )}
            </div>

            <p className="sub-label">Documentos requeridos</p>
            <div className="form-card expediente-checklist">
              <input
                ref={inputRequeridoRef}
                type="file"
                className="expediente-checklist-input"
                onChange={onArchivoRequeridoElegido}
              />
              {DOCUMENTOS_REQUERIDOS.map((doc) => {
                const a = archivos.find((x) => x.tipo_documento === doc.clave);
                const ocupado = subiendoClave === doc.clave;
                return (
                  <div className="expediente-checklist-fila" key={doc.clave}>
                    <span className={"expediente-checklist-estado" + (a ? " listo" : "")}>{a ? "✓" : "✗"}</span>
                    <span className="expediente-checklist-etiqueta">{doc.etiqueta}</span>
                    <div className="expediente-acciones">
                      {a && (
                        <button
                          type="button"
                          className="tel-borrar-btn"
                          style={{ color: "#0d1b3e", fontWeight: 600 }}
                          onClick={() => abrirArchivo(a)}
                          disabled={abriendoId === a.id}
                        >
                          {abriendoId === a.id ? "Abriendo…" : "Ver"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        disabled={ocupado}
                        onClick={() => {
                          setClaveEnCurso(doc.clave);
                          inputRequeridoRef.current?.click();
                        }}
                      >
                        {ocupado ? "Subiendo…" : a ? "Reemplazar" : "Seleccionar archivo"}
                      </button>
                      {a && (
                        <button type="button" className="tel-borrar-btn" onClick={() => setBorrando(a)}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="expediente-seccion-titulo">
              <p className="sub-label" style={{ margin: 0 }}>
                Otros documentos {archivos.filter((a) => !a.tipo_documento).length > 0 ? `(${archivos.filter((a) => !a.tipo_documento).length})` : ""}
              </p>
              <button
                type="button"
                className="btn-aceptar"
                onClick={() => {
                  setMostrarSubida((v) => !v);
                  setError("");
                }}
              >
                {mostrarSubida ? "Cerrar" : "Subir documentos"}
              </button>
            </div>

            {mostrarSubida && (
              <div className="form-card" style={{ marginBottom: 10 }}>
                <FileDropzone
                  files={archivosNuevos}
                  onChange={setArchivosNuevos}
                  maxFiles={15}
                  maxSizeMB={25}
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  etiquetaTipos="Fotos, PDF, Word, Excel…"
                />
                <p style={{ fontSize: 12, color: "#aaa", margin: "6px 0 0" }}>
                  Cada archivo se guarda con su nombre; después lo puedes renombrar (ej. &quot;INE representante legal&quot;).
                </p>
                <button
                  type="button"
                  className="btn-enviar"
                  disabled={archivosNuevos.length === 0 || !!subiendo}
                  onClick={subirArchivos}
                >
                  {subiendo
                    ? `Subiendo ${subiendo.actual} de ${subiendo.total}…`
                    : `Subir ${archivosNuevos.length || ""} archivo${archivosNuevos.length === 1 ? "" : "s"}`}
                </button>
              </div>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}

            {cargandoDetalle ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando expediente…</p>
            ) : (
              <>
                {archivosLibres.length === 0 && archivosDeContrato.length === 0 && (
                  <div className="empty-card">No hay otros documentos. Sube lo que más tengas del cliente.</div>
                )}

                {archivosLibres.map((a) => {
                  const enRenombre = renombrando?.id === a.id;
                  return (
                    <div className="item-card expediente-archivo" key={a.id}>
                      {enRenombre ? (
                        <div style={{ display: "flex", gap: 8, width: "100%" }}>
                          <input
                            type="text"
                            autoFocus
                            value={renombrando.valor}
                            onChange={(e) => setRenombrando({ ...renombrando, valor: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && confirmarRenombre()}
                            className="expediente-renombre"
                          />
                          <button className="btn-aceptar" onClick={confirmarRenombre}>
                            Guardar
                          </button>
                          <button className="btn-rechazar" onClick={() => setRenombrando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="item-card-info" style={{ minWidth: 0 }}>
                            <p className="item-card-titulo">
                              {iconoArchivo(a)} {a.nombre}
                            </p>
                            <p className="item-card-extra" style={{ color: "#aaa" }}>
                              {fmtFecha(a.created_at)}
                              {a.tamano_bytes ? ` · ${formatBytes(a.tamano_bytes)}` : ""}
                              {a.subido_por_nombre ? ` · Subió: ${a.subido_por_nombre}` : ""}
                            </p>
                          </div>
                          <div className="expediente-acciones">
                            <button
                              className="tel-borrar-btn"
                              style={{ color: "#0d1b3e", fontWeight: 600 }}
                              onClick={() => abrirArchivo(a)}
                              disabled={abriendoId === a.id}
                            >
                              {abriendoId === a.id ? "Abriendo…" : "Ver"}
                            </button>
                            <button
                              className="tel-borrar-btn"
                              style={{ color: "#0d1b3e", fontWeight: 600 }}
                              onClick={() => setRenombrando({ id: a.id, valor: a.nombre })}
                            >
                              Renombrar
                            </button>
                            <button className="tel-borrar-btn" onClick={() => setBorrando(a)}>
                              Eliminar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {archivosDeContrato.length > 0 && (
                  <>
                    <p className="sub-label" style={{ marginTop: 16 }}>
                      Desde Contratos
                    </p>
                    {archivosDeContrato.map((f) => (
                      <div className="item-card expediente-archivo" key={f.clave}>
                        <div className="item-card-info" style={{ minWidth: 0 }}>
                          <p className="item-card-titulo">📕 {f.titulo}</p>
                          <p className="item-card-extra" style={{ color: "#aaa" }}>
                            Se sube en el módulo de Contratos
                          </p>
                        </div>
                        <div className="expediente-acciones">
                          <button
                            className="tel-borrar-btn"
                            style={{ color: "#0d1b3e", fontWeight: 600 }}
                            onClick={() => abrirArchivoContrato(f.url, f.clave)}
                            disabled={abriendoId === f.clave}
                          >
                            {abriendoId === f.clave ? "Abriendo…" : "Ver"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {borrando && (
        <div className="modal-overlay" onClick={() => setBorrando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Eliminar documento</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Eliminar &quot;{borrando.nombre}&quot; del expediente? Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setBorrando(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => borrarArchivo(borrando)}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && <AvisoExito titulo={aviso.titulo} mensaje={aviso.mensaje} onCerrar={() => setAviso(null)} />}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null | undefined }) {
  return (
    <div className="expediente-dato">
      <span className="expediente-dato-titulo">{titulo}</span>
      <span className="expediente-dato-valor">{valor || "—"}</span>
    </div>
  );
}
