"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { soltarDispositivoNativo } from "@/lib/appNativa";
import { pedirLinkFirmado } from "@/lib/storage";
import FileDropzone from "../soporte/FileDropzone";
import ResumenGastos from "./ResumenGastos";
import FormGasto from "./FormGasto";
import EncabezadoContabilidad from "./EncabezadoContabilidad";
import { fechaLocal, hoyMexicoISO } from "@/lib/fechaMexico";
import { ESTADOS_PAGO, URGENCIAS, textoFechaLimite, urgenciaEfectiva, urgenciaInfo, type EstadoPago } from "@/lib/gastos";
import Link from "next/link";

type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  notas: string | null;
  tipo: string | null;
  centro: string | null;
  proveedor_id: string | null;
  factura_url: string | null;
  xml_url: string | null;
  comprobante_pago_url: string | null;
  registrado_por_nombre: string | null;
  urgencia: string | null;
  fecha_limite_pago: string | null;
  estado_pago: EstadoPago | null;
  fecha_pago: string | null;
  motivo_no_pago: string | null;
  revisado_por_nombre: string | null;
  created_at: string;
};

type Proveedor = { id: string; nombre: string };

// A diferencia de /tickets, aquí cada quien captura sus PROPIOS gastos —
// por eso sistemas también se queda scopeado a su centro (no es "global"
// en esta pantalla), a menos que sea de administración/cobranza.
const ROLES_GLOBALES = ["superadmin", "gerente", "cobranza", "gastos"];
// Rol "gastos" (contabilidad): ve los gastos de todos los centros, sin registrar.
const ROLES_SOLO_CONSULTA = ["gastos"];
// Quién marca un gasto como pagado o "no se paga" (/api/gastos/revisar).
const ROLES_REVISAN = ["gastos", "superadmin", "gerente"];

// Los gastos se dividen por área además de por centro: sistemas, el
// admin del centro y operaciones cada quien ve y registra solo los
// suyos (mismos valores que ya usa la gráfica "Gastos por departamento"
// del panel de cobranza).
const AREA_INFO: Record<string, { icono: string; label: string }> = {
  sistemas: { icono: "🖥️", label: "Sistemas" },
  operaciones: { icono: "🔧", label: "Operaciones" },
  admin: { icono: "🧑‍💼", label: "Administración" },
};

const ORDEN_URGENCIA = { rojo: 0, amarillo: 1, verde: 2 };

const linkBtn: React.CSSProperties = { fontSize: 12, color: "#185FA5", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600 };

export default function GastosPage() {
  const supabase = createClient();
  const router = useRouter();
  const hoy = hoyMexicoISO();
  const [miRol, setMiRol] = useState("");
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [miNombre, setMiNombre] = useState("");
  const [miNumero, setMiNumero] = useState<string | null>(null);
  const [esGlobal, setEsGlobal] = useState(false);

  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [verResumen, setVerResumen] = useState(false);
  const [abriendoArchivoUrl, setAbriendoArchivoUrl] = useState<string | null>(null);

  const [fEstado, setFEstado] = useState<EstadoPago>("pendiente");
  const [fCentro, setFCentro] = useState("");
  const [fUrgencia, setFUrgencia] = useState("");

  // Modal para marcar pagado / no se paga.
  const [revisando, setRevisando] = useState<{ gasto: Gasto; estado: "pagado" | "no_pagado" } | null>(null);
  const [fechaPago, setFechaPago] = useState(hoy);
  const [motivo, setMotivo] = useState("");
  const [comprobante, setComprobante] = useState<File[]>([]);
  const [guardandoRevision, setGuardandoRevision] = useState(false);
  const [errorRevision, setErrorRevision] = useState("");

  async function abrirArchivo(archivoUrl: string, descargar = false) {
    setAbriendoArchivoUrl(archivoUrl);
    const { url, error: signErr } = await pedirLinkFirmado(archivoUrl, { descargar });
    setAbriendoArchivoUrl(null);
    if (!url) {
      alert("No se pudo abrir el archivo: " + (signErr || "intenta de nuevo"));
      return;
    }
    window.open(url, "_blank");
  }

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

    const { data: profile } = await supabase.from("profiles").select("rol, centro, nombre, numero_usuario").eq("id", user.id).single();
    const rolActual = profile?.rol || "";
    const centroActual = profile?.centro || null;
    const globalActual = ROLES_GLOBALES.includes(rolActual);
    setMiRol(rolActual);
    setMiCentro(centroActual);
    setMiNombre(profile?.nombre || "");
    setMiNumero(profile?.numero_usuario || null);
    setEsGlobal(globalActual);

    let query = supabase.from("gastos").select("*").order("fecha", { ascending: false });
    if (!globalActual) {
      // Cada área ve solo lo suyo: mismo centro Y mismo tipo de gasto
      // (sistemas no ve los gastos de operaciones ni los del admin del
      // centro, aunque estén en el mismo lugar). Los de Administración
      // incluyen los registrados sin área (desde Ingresos por Centro).
      if (centroActual) query = query.eq("centro", centroActual);
      if (rolActual === "admin") query = query.or("tipo.eq.admin,tipo.is.null");
      else if (AREA_INFO[rolActual]) query = query.eq("tipo", rolActual);
    }
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError("No se pudieron cargar los gastos.");
    } else {
      setGastos((data as Gasto[]) || []);
    }

    // Proveedores para vincular (de su propio centro). Quien ve todos los centros
    // los necesita todos, para ver el nombre del proveedor de cada gasto.
    let qProv = supabase.from("proveedores").select("id, nombre").order("nombre");
    if (!globalActual) qProv = centroActual ? qProv.eq("centro", centroActual) : qProv.eq("centro", "__ninguno__");
    const { data: provs } = await qProv;
    setProveedores(provs || []);

    setLoading(false);
  }

  const proveedorNombre = (id: string | null) => proveedores.find((p) => p.id === id)?.nombre;
  const soloConsulta = ROLES_SOLO_CONSULTA.includes(miRol);
  const puedeRevisar = ROLES_REVISAN.includes(miRol);

  const centros = useMemo(() => Array.from(new Set(gastos.map((g) => g.centro).filter(Boolean))).sort() as string[], [gastos]);

  const visibles = useMemo(
    () =>
      gastos
        .filter((g) => (g.estado_pago || "pendiente") === fEstado)
        .filter((g) => !fCentro || g.centro === fCentro)
        .filter((g) => !fUrgencia || urgenciaEfectiva(g, hoy) === fUrgencia)
        .sort((a, b) => {
          const pa = (a.estado_pago || "pendiente") === "pendiente" ? 0 : 1;
          const pb = (b.estado_pago || "pendiente") === "pendiente" ? 0 : 1;
          if (pa !== pb) return pa - pb;
          if (pa === 0) {
            const ua = ORDEN_URGENCIA[urgenciaEfectiva(a, hoy)];
            const ub = ORDEN_URGENCIA[urgenciaEfectiva(b, hoy)];
            if (ua !== ub) return ua - ub;
            const la = a.fecha_limite_pago || "9999";
            const lb = b.fecha_limite_pago || "9999";
            if (la !== lb) return la.localeCompare(lb);
          }
          return b.fecha.localeCompare(a.fecha);
        }),
    [gastos, fEstado, fCentro, fUrgencia, hoy]
  );

  const pendientes = gastos.filter((g) => (g.estado_pago || "pendiente") === "pendiente");
  const pendientesRojos = pendientes.filter((g) => urgenciaEfectiva(g, hoy) === "rojo").length;
  const montoPendiente = pendientes.reduce((s, g) => s + Number(g.monto), 0);

  function abrirRevision(gasto: Gasto, estado: "pagado" | "no_pagado") {
    setRevisando({ gasto, estado });
    setFechaPago(hoy);
    setMotivo("");
    setComprobante([]);
    setErrorRevision("");
  }

  async function enviarRevision(gasto: Gasto, estado: EstadoPago) {
    const form = new FormData();
    form.append("id", gasto.id);
    form.append("estado", estado);
    if (estado === "pagado") {
      form.append("fecha_pago", fechaPago);
      if (comprobante[0]) form.append("comprobante", comprobante[0]);
    }
    if (estado === "no_pagado") form.append("motivo", motivo.trim());
    const res = await fetch("/api/gastos/revisar", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    return res.ok ? null : data.error || "No se pudo guardar";
  }

  async function confirmarRevision() {
    if (!revisando) return;
    if (revisando.estado === "pagado" && !fechaPago) return setErrorRevision("Pon la fecha de pago.");
    if (revisando.estado === "no_pagado" && !motivo.trim()) return setErrorRevision("Escribe el motivo.");
    setGuardandoRevision(true);
    setErrorRevision("");
    const err = await enviarRevision(revisando.gasto, revisando.estado);
    setGuardandoRevision(false);
    if (err) return setErrorRevision(err);
    setRevisando(null);
    fetchTodo();
  }

  async function deshacerRevision(gasto: Gasto) {
    const err = await enviarRevision(gasto, "pendiente");
    if (err) alert(err);
    else fetchTodo();
  }

  async function cerrarSesion() {
    await soltarDispositivoNativo();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Hasta saber el rol no se dibujan botones ni filtros: si no, por un momento se ve
  // la versión de la admin (Regresar, Registrar gasto) aunque sea contabilidad.
  if (loading && !miRol) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Gastos</p>
        </div>
        <div className="rep-content">
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      {soloConsulta ? (
        <EncabezadoContabilidad nombre={miNombre} rol={miRol} numeroUsuario={miNumero} onCerrarSesion={cerrarSesion} onAbrirAviso={fetchTodo} />
      ) : (
        <div className="rep-header">
          <Link className="rep-back" href="/dashboard">
            ← Regresar
          </Link>
          <p className="rep-title">Gastos</p>
          <p className="rep-sub">
            {esGlobal ? "Todos los centros y áreas" : [AREA_INFO[miRol]?.label, miCentro || "Tu centro"].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}

      {/* Quien ve todos los centros usa una pantalla más ancha que la de un centro. */}
      <div className="rep-content" style={{ maxWidth: esGlobal ? 1150 : 820 }}>
        {/* Resumen con gráficas (antes pestaña "Gastos" de Cobranza), plegado para que lo primero sea lo que hay que pagar. */}
        {esGlobal && !loading && gastos.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
              <button type="button" className="tel-borrar-btn" style={{ font: "inherit", fontSize: 13, fontWeight: 600 }} onClick={() => setVerResumen((v) => !v)}>
                {verResumen ? "← Regresar a los gastos" : "📊 Ver resumen por centro, área y mes"}
              </button>
            </div>
            {verResumen && <ResumenGastos gastos={gastos} />}
          </>
        )}

        {/* Con el resumen abierto solo se ve el resumen; la lista vuelve al ocultarlo. */}
        {!verResumen && (
          <>
        {!loading && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="gastos-total-card" style={{ flex: "1 1 200px", margin: 0, padding: "14px 16px" }}>
              <p className="gastos-total-monto" style={{ fontSize: 24 }}>${montoPendiente.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</p>
              <p className="gastos-total-lbl">
                Por pagar · {pendientes.length} gasto{pendientes.length === 1 ? "" : "s"}
              </p>
            </div>
            {pendientesRojos > 0 && (
              <button
                type="button"
                className="gastos-total-card"
                onClick={() => {
                  setFEstado("pendiente");
                  setFUrgencia("rojo");
                }}
                style={{ flex: "1 1 200px", margin: 0, padding: "14px 16px", background: "#FBE4E4", border: "1px solid #F3B9B9", cursor: "pointer", textAlign: "center", font: "inherit" }}
              >
                <p className="gastos-total-monto" style={{ color: "#D64545", fontSize: 24 }}>
                  {pendientesRojos}
                </p>
                <p className="gastos-total-lbl" style={{ color: "#8A2A2A", opacity: 1, fontWeight: 600 }}>
                  🔴 Urgente{pendientesRojos === 1 ? "" : "s"} por pagar · toca para verlo{pendientesRojos === 1 ? "" : "s"}
                </p>
              </button>
            )}
          </div>
        )}

        {/* Registrar es por centro: quien no tiene centro (Cobranza, gerencia) solo consulta. */}
        {!soloConsulta && miCentro && (
          <button className="btn-enviar" style={{ marginBottom: 4, padding: 11 }} onClick={() => setMostrarForm((v) => !v)}>
            {mostrarForm ? "Cancelar" : "+ Registrar gasto"}
          </button>
        )}

        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        {mostrarForm && !soloConsulta && miCentro && (
          <>
            <FormGasto
              centro={miCentro}
              tipo={AREA_INFO[miRol] ? miRol : null}
              proveedores={proveedores}
              registradoPorNombre={miNombre}
              onGuardado={() => {
                setMostrarForm(false);
                fetchTodo();
              }}
            />
            {proveedores.length === 0 && (
              <p style={{ fontSize: 11, color: "#999", margin: 0 }}>
                Todavía no tienes proveedores registrados en tu centro —{" "}
                <a href="/proveedores" style={{ color: "#f07e3a" }}>
                  agrega uno aquí
                </a>
                .
              </p>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 4px" }}>
          <select className="ticket-admin-select" value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoPago)}>
            <option value="pendiente">Por pagar</option>
            <option value="pagado">Pagados</option>
            <option value="no_pagado">No se pagan</option>
          </select>
          <select className="ticket-admin-select" value={fUrgencia} onChange={(e) => setFUrgencia(e.target.value)}>
            <option value="">Todas las urgencias</option>
            {URGENCIAS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === "verde" ? "🟢" : u.id === "amarillo" ? "🟡" : "🔴"} {u.label}
              </option>
            ))}
          </select>
          {esGlobal && centros.length > 1 && (
            <select className="ticket-admin-select" value={fCentro} onChange={(e) => setFCentro(e.target.value)}>
              <option value="">Todos los centros</option>
              {centros.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <p className="panel-section-label" style={{ marginTop: 8 }}>
          {esGlobal ? "Gastos registrados" : `Mis gastos de ${AREA_INFO[miRol]?.label || "tu área"}`} ({visibles.length})
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
        ) : visibles.length === 0 ? (
          <div className="empty-card">
            {gastos.length > 0
              ? "Ningún gasto con estos filtros"
              : soloConsulta
              ? "Todavía no hay gastos registrados. Cuando una administradora registre uno, aparecerá aquí con su factura y su semáforo."
              : "Sin gastos registrados todavía"}
          </div>
        ) : (
          visibles.map((g) => {
            const estado = (g.estado_pago || "pendiente") as EstadoPago;
            const urg = urgenciaInfo(urgenciaEfectiva(g, hoy));
            const est = ESTADOS_PAGO[estado];
            return (
              <div className="item-card" key={g.id} style={{ borderLeft: `5px solid ${estado === "pendiente" ? urg.color : "#d9dde6"}` }}>
                <div className="item-card-info">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                    {estado === "pendiente" && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: urg.fondo, color: urg.color }}>
                        ● {urg.label}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: est.fondo, color: est.color }}>{est.label}</span>
                    {estado === "pendiente" && g.fecha_limite_pago && (
                      <span style={{ fontSize: 11, color: "#6b7897" }}>
                        {textoFechaLimite(g.fecha_limite_pago, hoy)} ({fechaLocal(g.fecha_limite_pago).toLocaleDateString("es-MX")})
                      </span>
                    )}
                  </div>
                  <p className="item-card-titulo">{g.concepto}</p>
                  <p className="item-card-sub">
                    {fechaLocal(g.fecha).toLocaleDateString("es-MX")}
                    {g.categoria ? ` · ${g.categoria}` : ""}
                    {proveedorNombre(g.proveedor_id) ? ` · ${proveedorNombre(g.proveedor_id)}` : ""}
                  </p>
                  <p className="item-card-extra">
                    {g.centro || "—"}
                    {g.registrado_por_nombre ? ` · Registró: ${g.registrado_por_nombre}` : ""}
                  </p>
                  {g.notas && <p className="item-card-extra">📝 {g.notas}</p>}
                  {estado === "pagado" && (
                    <p className="item-card-extra" style={{ color: "#0F6E56" }}>
                      ✅ Pagado el {g.fecha_pago ? fechaLocal(g.fecha_pago).toLocaleDateString("es-MX") : "—"}
                      {g.revisado_por_nombre ? ` · ${g.revisado_por_nombre}` : ""}
                    </p>
                  )}
                  {estado === "no_pagado" && (
                    <p className="item-card-extra" style={{ color: "#A32D2D" }}>
                      ❌ No se paga: {g.motivo_no_pago || "sin motivo"}
                      {g.revisado_por_nombre ? ` · ${g.revisado_por_nombre}` : ""}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                    {g.factura_url && (
                      <>
                        <button type="button" onClick={() => abrirArchivo(g.factura_url!)} disabled={abriendoArchivoUrl === g.factura_url} style={linkBtn}>
                          {abriendoArchivoUrl === g.factura_url ? "Abriendo…" : "📎 Ver factura"}
                        </button>
                        <button type="button" onClick={() => abrirArchivo(g.factura_url!, true)} disabled={abriendoArchivoUrl === g.factura_url} style={linkBtn}>
                          ⬇️ Descargar factura
                        </button>
                      </>
                    )}
                    {!g.factura_url && <span style={{ fontSize: 12, color: "#9aa3b5" }}>Sin factura adjunta</span>}
                    {g.xml_url && (
                      <button type="button" onClick={() => abrirArchivo(g.xml_url!, true)} disabled={abriendoArchivoUrl === g.xml_url} style={linkBtn}>
                        {abriendoArchivoUrl === g.xml_url ? "Abriendo…" : "⬇️ XML"}
                      </button>
                    )}
                    {g.comprobante_pago_url && (
                      <button type="button" onClick={() => abrirArchivo(g.comprobante_pago_url!)} disabled={abriendoArchivoUrl === g.comprobante_pago_url} style={linkBtn}>
                        {abriendoArchivoUrl === g.comprobante_pago_url ? "Abriendo…" : "🧾 Comprobante de pago"}
                      </button>
                    )}
                  </div>
                  {puedeRevisar && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      {estado === "pendiente" ? (
                        <>
                          <button className="btn-aceptar" style={{ flex: "none", width: "auto", padding: "6px 14px", fontSize: 12 }} onClick={() => abrirRevision(g, "pagado")}>
                            ✅ Marcar pagado
                          </button>
                          <button className="btn-rechazar" style={{ flex: "none", width: "auto", padding: "6px 14px", fontSize: 12 }} onClick={() => abrirRevision(g, "no_pagado")}>
                            ❌ No se paga
                          </button>
                        </>
                      ) : (
                        <button type="button" className="tel-borrar-btn" style={{ fontSize: 11 }} onClick={() => deshacerRevision(g)}>
                          ↩ Regresar a "Por pagar"
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <p className="item-card-monto">${Number(g.monto).toLocaleString("es-MX")}</p>
              </div>
            );
          })
        )}
          </>
        )}
      </div>

      {revisando && (
        <div className="modal-overlay" onClick={() => setRevisando(null)}>
          <div className="modal-card gasto-revision" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">{revisando.estado === "pagado" ? "Marcar como pagado" : "No se paga este gasto"}</p>
            <p className="modal-email">
              {revisando.gasto.concepto} · ${Number(revisando.gasto.monto).toLocaleString("es-MX")} · {revisando.gasto.centro || "—"}
            </p>
            {revisando.estado === "pagado" ? (
              <>
                <p className="sub-label" style={{ marginTop: 8 }}>
                  Fecha de pago
                </p>
                <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
                <p className="sub-label">Comprobante de pago (opcional)</p>
                <FileDropzone files={comprobante} onChange={setComprobante} maxFiles={1} accept="image/*,.pdf" />
              </>
            ) : (
              <>
                <p className="sub-label" style={{ marginTop: 8 }}>
                  Motivo (obligatorio, quien lo registró lo verá)
                </p>
                <textarea placeholder="Ej. La factura no coincide con el monto" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </>
            )}
            {errorRevision && <p style={{ color: "#A32D2D", fontSize: 13, margin: "6px 0 0" }}>{errorRevision}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setRevisando(null)}>
                Regresar
              </button>
              <button className={revisando.estado === "pagado" ? "btn-aceptar" : "btn-rechazar"} onClick={confirmarRevision} disabled={guardandoRevision}>
                {guardandoRevision ? "Guardando..." : revisando.estado === "pagado" ? "Confirmar pago" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
