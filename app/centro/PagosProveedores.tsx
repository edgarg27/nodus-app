"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import { exportarExcelPorCentro } from "@/lib/exportExcel";
import { fechaLocal, hoyMexicoISO } from "@/lib/fechaMexico";
import { ESTADOS_PAGO, URGENCIAS, urgenciaEfectiva, urgenciaInfo, type EstadoPago, type Urgencia } from "@/lib/gastos";
import FileDropzone from "../soporte/FileDropzone";
import ResumenGastos from "../gastos/ResumenGastos";
import { subirArchivoGasto } from "../gastos/FormGasto";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";

// Pagos a proveedores de Operaciones (la arquitecta), dentro de Proveedores.
// Es la misma tabla que llevaba en Excel (proveedor, OF, factura, especialidad,
// concepto, S/IVA, neto, fecha de factura y de pago), agrupada por centro.
// Cada pago se guarda como un gasto de tipo "operaciones": Contabilidad lo ve
// en /gastos y lo marca pagado (eso llena la fecha de pago). Mientras está
// "por pagar" ella lo puede corregir o borrar.
// Permisos: migracion_pagos_proveedores_operaciones.sql.

type Pago = {
  id: string;
  centro: string | null;
  proveedor_id: string | null;
  oficina: string | null;
  folio_factura: string | null;
  categoria: string | null;
  concepto: string;
  subtotal: number | null;
  monto: number;
  fecha: string;
  fecha_factura: string | null;
  tipo: string | null;
  estado_pago: EstadoPago | null;
  fecha_pago: string | null;
  motivo_no_pago: string | null;
  factura_url: string | null;
  factura_xml_url?: string | null;
  comprobante_pago_url: string | null;
  urgencia: string | null;
  fecha_limite_pago: string | null;
  notas: string | null;
};

type Proveedor = { id: string; nombre: string; centro: string };

const IVA = 0.16;
const ESPECIALIDADES = ["AA", "HYS", "Acabados", "Cancelería", "Pisos", "Pintura", "Eléctrico", "Varios"];

const pesos = (n: number | null | undefined) =>
  n == null ? "" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string | null) => (iso ? fechaLocal(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");
const redondear = (n: number) => Math.round(n * 100) / 100;
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const FORM_VACIO = {
  centro: "",
  proveedorId: "",
  proveedorNuevo: "",
  oficina: "",
  especialidad: "",
  concepto: "",
  folio: "",
  fechaFactura: "",
  conIva: true,
  subtotal: "",
  neto: "",
  urgencia: "verde" as Urgencia,
  fechaLimite: "",
  notas: "",
};

export default function PagosProveedores({
  modo,
  centros: centrosPanel,
  centrosFijos,
  centroInicial,
  centroFiltro,
}: {
  modo: "pagos" | "desglose";
  centros: string[];
  // Si el rol solo trabaja algunos centros (Mantenimiento de León), solo esos.
  centrosFijos?: string[];
  centroInicial: string | null;
  // Centro elegido en el encabezado de Proveedores ("" = todos). Si viene, no se muestran los botones de centro.
  centroFiltro?: string;
}) {
  // Todos los centros (los 7), aunque el panel solo traiga los que tienen oficinas registradas.
  const centros = centrosFijos || Array.from(new Set([...CENTROS_REPORTE, ...centrosPanel]));
  const supabase = createClient();
  const hoy = hoyMexicoISO();
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [miNombre, setMiNombre] = useState("");

  const [fCentroLocal, setFCentro] = useState("");
  const fCentro = centroFiltro ?? fCentroLocal;
  const [fEstado, setFEstado] = useState("");
  const [fMes, setFMes] = useState("");
  // "sin" = pagos que todavía no tienen la factura adjunta (para pedírsela al proveedor).
  const [fFactura, setFFactura] = useState("");
  const [zipeando, setZipeando] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [modal, setModal] = useState<{ editando: Pago | null } | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [factura, setFactura] = useState<File[]>([]);
  const [xml, setXml] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState("");
  const [borrando, setBorrando] = useState<Pago | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    setLoading(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: perfil } = await supabase.from("profiles").select("nombre").eq("id", user.id).maybeSingle();
      setMiNombre(perfil?.nombre || "");
    }
    const [{ data: gs, error: e1 }, { data: ps }] = await Promise.all([
      supabase.from("gastos").select("*").eq("tipo", "operaciones").order("fecha", { ascending: false }),
      supabase.from("proveedores").select("id, nombre, centro").eq("tipo", "operaciones").order("nombre"),
    ]);
    if (e1) setError("No se pudieron cargar los pagos.");
    setPagos((gs as Pago[]) || []);
    setProveedores((ps as Proveedor[]) || []);
    setLoading(false);
  }

  const nombreProveedor = (id: string | null) => proveedores.find((p) => p.id === id)?.nombre;
  const estadoDe = (p: Pago) => (p.estado_pago || "pendiente") as EstadoPago;
  const mesDe = (p: Pago) => (p.fecha_factura || p.fecha).slice(0, 7);

  const meses = useMemo(() => Array.from(new Set(pagos.map(mesDe))).sort().reverse(), [pagos]);

  const visibles = useMemo(() => {
    const q = busqueda
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    return pagos.filter((p) => {
      if (fCentro && p.centro !== fCentro) return false;
      if (fEstado && estadoDe(p) !== fEstado) return false;
      if (fMes && mesDe(p) !== fMes) return false;
      if (fFactura === "sin" && p.factura_url) return false;
      if (fFactura === "con" && !p.factura_url) return false;
      if (q) {
        const texto = [nombreProveedor(p.proveedor_id), p.concepto, p.oficina, p.folio_factura, p.categoria]
          .join(" ")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagos, proveedores, fCentro, fEstado, fMes, fFactura, busqueda]);

  // Agrupados por centro, en el orden de la lista de centros; dentro, del más viejo al más nuevo como en su Excel.
  const porCentro = useMemo(() => {
    const orden = [...centros, ...visibles.map((p) => p.centro || "Sin centro").filter((c) => !centros.includes(c))];
    return Array.from(new Set(orden))
      .map((c) => ({
        centro: c,
        pagos: visibles
          .filter((p) => (p.centro || "Sin centro") === c)
          .sort((a, b) => (a.fecha_factura || a.fecha).localeCompare(b.fecha_factura || b.fecha)),
      }))
      .filter((g) => g.pagos.length > 0);
  }, [visibles, centros]);

  const suma = (ps: Pago[]) => ps.reduce((s, p) => s + Number(p.monto), 0);
  const porPagar = pagos.filter((p) => estadoDe(p) === "pendiente");
  const pagados = pagos.filter((p) => estadoDe(p) === "pagado");

  // ---------- Formulario ----------
  function abrirNuevo() {
    setForm({ ...FORM_VACIO, centro: fCentro || centroInicial || centros[0] || "" });
    setFactura([]);
    setXml([]);
    setErrorForm("");
    setModal({ editando: null });
  }

  function abrirEditar(p: Pago) {
    setForm({
      centro: p.centro || "",
      proveedorId: p.proveedor_id || "",
      proveedorNuevo: "",
      oficina: p.oficina || "",
      especialidad: p.categoria || "",
      concepto: p.concepto,
      folio: p.folio_factura || "",
      fechaFactura: p.fecha_factura || "",
      conIva: p.subtotal != null,
      subtotal: p.subtotal != null ? String(p.subtotal) : "",
      neto: String(p.monto),
      urgencia: (["verde", "amarillo", "rojo"].includes(p.urgencia || "") ? p.urgencia : "verde") as Urgencia,
      fechaLimite: p.fecha_limite_pago || "",
      notas: p.notas || "",
    });
    setFactura([]);
    setXml([]);
    setErrorForm("");
    setModal({ editando: p });
  }

  // El neto y el subtotal se calculan uno del otro con el 16% de IVA (se pueden corregir a mano).
  function cambiarSubtotal(v: string) {
    setForm((f) => ({ ...f, subtotal: v, neto: f.conIva && v !== "" ? String(redondear(Number(v) * (1 + IVA))) : f.neto }));
  }
  function cambiarNeto(v: string) {
    setForm((f) => ({ ...f, neto: v, subtotal: f.conIva && v !== "" ? String(redondear(Number(v) / (1 + IVA))) : f.subtotal }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    if (!form.centro) return setErrorForm("Elige el centro.");
    if (form.proveedorId === "__nuevo" && !form.proveedorNuevo.trim()) return setErrorForm("Escribe el nombre del proveedor nuevo.");
    if (!form.concepto.trim()) return setErrorForm("Escribe el concepto.");
    if (!form.neto || Number(form.neto) <= 0) return setErrorForm("Escribe el monto neto.");
    setGuardando(true);
    setErrorForm("");

    // Proveedor nuevo: se da de alta en su catálogo de ese centro.
    let proveedorId = form.proveedorId && form.proveedorId !== "__nuevo" ? form.proveedorId : null;
    if (form.proveedorId === "__nuevo") {
      const { data: nuevo, error: provErr } = await supabase
        .from("proveedores")
        .insert({ centro: form.centro, tipo: "operaciones", nombre: form.proveedorNuevo.trim(), categoria: form.especialidad.trim() || null })
        .select("id")
        .single();
      if (provErr || !nuevo) {
        setErrorForm("No se pudo dar de alta el proveedor. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
      proveedorId = nuevo.id;
    }

    let facturaUrl = modal.editando?.factura_url || null;
    if (factura[0]) {
      facturaUrl = await subirArchivoGasto(supabase, factura[0], "factura");
      if (!facturaUrl) {
        setErrorForm("No se pudo subir la factura. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
    }

    let xmlUrl: string | null = null;
    if (xml[0]) {
      xmlUrl = await subirArchivoGasto(supabase, xml[0], "factura-xml");
      if (!xmlUrl) {
        setErrorForm("No se pudo subir el XML. Intenta de nuevo.");
        setGuardando(false);
        return;
      }
    }

    const datos = {
      centro: form.centro,
      tipo: "operaciones",
      proveedor_id: proveedorId,
      oficina: form.oficina.trim() || null,
      categoria: form.especialidad.trim() || null,
      concepto: form.concepto.trim(),
      folio_factura: form.folio.trim() || null,
      fecha_factura: form.fechaFactura || null,
      subtotal: form.conIva && form.subtotal !== "" ? Number(form.subtotal) : null,
      monto: Number(form.neto),
      fecha: form.fechaFactura || modal.editando?.fecha || hoy,
      urgencia: form.urgencia,
      fecha_limite_pago: form.fechaLimite || null,
      notas: form.notas.trim() || null,
      factura_url: facturaUrl,
      // Solo si subió XML (así, sin la migración del XML, lo demás se sigue guardando).
      ...(xmlUrl ? { factura_xml_url: xmlUrl } : {}),
    };

    const { error: errGuardar } = modal.editando
      ? await supabase.from("gastos").update(datos).eq("id", modal.editando.id)
      : await supabase.from("gastos").insert({ ...datos, registrado_por: (await supabase.auth.getUser()).data.user?.id, registrado_por_nombre: miNombre || null });
    if (errGuardar) {
      setErrorForm(
        /factura_xml_url/i.test(errGuardar.message || "")
          ? "Falta correr la migración migracion_pagos_proveedores_xml.sql."
          : /oficina|folio_factura|subtotal|fecha_factura/i.test(errGuardar.message || "")
          ? "Falta correr la migración migracion_pagos_proveedores_operaciones.sql."
          : /revisado por contabilidad/i.test(errGuardar.message || "")
          ? "Contabilidad ya revisó este pago: ya no se puede cambiar."
          : "No se pudo guardar el pago. Intenta de nuevo."
      );
      setGuardando(false);
      return;
    }

    if (!modal.editando) {
      const u = URGENCIAS.find((x) => x.id === form.urgencia)!;
      const prov = form.proveedorId === "__nuevo" ? form.proveedorNuevo.trim() : nombreProveedor(proveedorId);
      await supabase.from("notificaciones").insert({
        centro: form.centro,
        tipo: "nuevo_gasto",
        mensaje: `🔧 Pago a proveedor (${u.label.toLowerCase()}) en ${form.centro}: ${prov ? `${prov} · ` : ""}${form.concepto.trim()} — ${pesos(Number(form.neto))}${
          form.fechaLimite ? ` · pagar antes del ${form.fechaLimite}` : ""
        }`,
      });
    }

    setGuardando(false);
    setModal(null);
    cargar();
  }

  async function confirmarBorrar() {
    if (!borrando) return;
    const { error: errBorrar } = await supabase.from("gastos").delete().eq("id", borrando.id);
    if (errBorrar) alert(/revisado por contabilidad/i.test(errBorrar.message || "") ? "Contabilidad ya revisó este pago: ya no se puede borrar." : "No se pudo borrar.");
    setBorrando(null);
    cargar();
  }

  async function abrirArchivo(url: string) {
    setAbriendo(url);
    const { url: firmado, error: errFirma } = await pedirLinkFirmado(url);
    setAbriendo(null);
    if (!firmado) return alert("No se pudo abrir el archivo: " + (errFirma || "intenta de nuevo"));
    window.open(firmado, "_blank");
  }

  // Todas las facturas (PDF y XML) de lo que esté filtrado, en un .zip por centro, para Contabilidad.
  async function descargarZip() {
    const archivos = visibles.flatMap((p) =>
      [p.factura_url ? { p, url: p.factura_url } : null, p.factura_xml_url ? { p, url: p.factura_xml_url } : null].filter(Boolean) as { p: Pago; url: string }[]
    );
    if (archivos.length === 0) return alert("Ninguno de estos pagos tiene factura adjunta.");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const limpio = (t: string) => t.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 60);
    const usados = new Set<string>();
    let fallidos = 0;
    for (let i = 0; i < archivos.length; i++) {
      const { p, url } = archivos[i];
      setZipeando(`Juntando ${i + 1} de ${archivos.length}…`);
      const ext = (url.split("?")[0].split(".").pop() || "pdf").toLowerCase();
      const base = `${limpio(nombreProveedor(p.proveedor_id) || "Proveedor")} - ${limpio(p.folio_factura || p.fecha_factura || p.fecha)}`;
      let nombre = `${limpio(p.centro || "Sin centro")}/${base}.${ext}`;
      for (let n = 2; usados.has(nombre); n++) nombre = `${limpio(p.centro || "Sin centro")}/${base} (${n}).${ext}`;
      usados.add(nombre);
      try {
        const { url: firmado } = await pedirLinkFirmado(url);
        if (!firmado) throw new Error();
        const resp = await fetch(firmado);
        if (!resp.ok) throw new Error();
        zip.file(nombre, await resp.blob());
      } catch {
        fallidos++;
      }
    }
    setZipeando("Armando el .zip…");
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `facturas-proveedores${fCentro ? `-${limpio(fCentro)}` : ""}${fMes ? `-${fMes}` : ""}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setZipeando("");
    if (fallidos) alert(`${fallidos} archivo(s) no se pudieron descargar; el resto sí va en el .zip.`);
  }

  function exportar() {
    const hojas: Record<string, Record<string, string | number>[]> = {};
    for (const g of porCentro) {
      const filas: Record<string, string | number>[] = g.pagos.map((p) => ({
        PROVEEDOR: nombreProveedor(p.proveedor_id) || "",
        OF: p.oficina || "",
        FACTURA: p.folio_factura || "",
        ESPECIALIDAD: p.categoria || "",
        CONCEPTO: p.concepto,
        "S/ IVA": p.subtotal ?? "",
        NETO: Number(p.monto),
        "FECHA DE FACTURA": fechaCorta(p.fecha_factura),
        "FECHA DE PAGO": estadoDe(p) === "pagado" ? fechaCorta(p.fecha_pago) : ESTADOS_PAGO[estadoDe(p)].label,
      }));
      filas.push({ PROVEEDOR: "TOTAL", OF: "", FACTURA: "", ESPECIALIDAD: "", CONCEPTO: "", "S/ IVA": "", NETO: suma(g.pagos), "FECHA DE FACTURA": "", "FECHA DE PAGO": "" });
      hojas[g.centro] = filas;
    }
    exportarExcelPorCentro("pagos-a-proveedores", hojas);
  }

  if (loading) {
    return (
      <div className="nodus-inline-loading">
        <div className="nodus-spinner nodus-spinner-sm">
          <span className="nodus-spinner-petal"></span>
          <span className="nodus-spinner-petal"></span>
          <span className="nodus-spinner-petal"></span>
          <span className="nodus-spinner-petal"></span>
        </div>
        <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando pagos...</p>
      </div>
    );
  }

  if (modo === "desglose") {
    return pagos.length === 0 ? (
      <div className="empty-card">Todavía no hay pagos a proveedores. Cuando registres uno, aquí verás en qué se va gastando.</div>
    ) : (
      <ResumenGastos gastos={pagos} ocultarArea nombreProveedor={nombreProveedor} centroFijo={centroFiltro} />
    );
  }

  const provsDelCentro = proveedores.filter((p) => p.centro === form.centro);
  const oficinasUsadas = Array.from(new Set(pagos.filter((p) => p.centro === form.centro && p.oficina).map((p) => p.oficina!)));
  const especialidades = Array.from(new Set([...ESPECIALIDADES, ...pagos.map((p) => p.categoria).filter(Boolean)])) as string[];

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="gastos-total-card" style={{ flex: "1 1 180px", margin: 0, padding: "12px 16px" }}>
          <p className="gastos-total-monto" style={{ fontSize: 22, color: "#C98A00" }}>{pesos(suma(porPagar))}</p>
          <p className="gastos-total-lbl">
            Por pagar · {porPagar.length} pago{porPagar.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="gastos-total-card" style={{ flex: "1 1 180px", margin: 0, padding: "12px 16px" }}>
          <p className="gastos-total-monto" style={{ fontSize: 22, color: "#0F6E56" }}>{pesos(suma(pagados))}</p>
          <p className="gastos-total-lbl">
            Pagado · {pagados.length} pago{pagados.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn-enviar" style={{ flex: "none", width: "auto", padding: "10px 18px", margin: 0 }} onClick={abrirNuevo}>
          + Registrar pago
        </button>
        <button className="btn-exportar" onClick={exportar} disabled={visibles.length === 0}>
          📥 Excel
        </button>
        <button className="btn-exportar" onClick={descargarZip} disabled={visibles.length === 0 || !!zipeando} title="PDF y XML de los pagos filtrados">
          {zipeando || "🗂️ Descargar facturas (.zip)"}
        </button>
      </div>

      {centroFiltro === undefined && (
      <div className="rg-centros" style={{ margin: 0 }}>
        {["", ...centros].map((c) => (
          <button key={c || "todos"} type="button" className={"rg-centro" + (fCentro === c ? " activo" : "")} onClick={() => setFCentro(c)}>
            {c || "Todos los centros"}
          </button>
        ))}
      </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="ticket-admin-select" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Por pagar</option>
          <option value="pagado">Pagados</option>
          <option value="no_pagado">No se pagan</option>
        </select>
        <select className="ticket-admin-select" value={fFactura} onChange={(e) => setFFactura(e.target.value)}>
          <option value="">Con y sin factura</option>
          <option value="sin">Sin factura ({pagos.filter((p) => !p.factura_url && (!fCentro || p.centro === fCentro)).length})</option>
          <option value="con">Con factura</option>
        </select>
        <select className="ticket-admin-select" value={fMes} onChange={(e) => setFMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {MESES[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <input
          className="ticket-admin-select"
          style={{ flex: "1 1 200px" }}
          placeholder="Buscar proveedor, concepto, OF o factura"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

      {porCentro.length === 0 ? (
        <div className="empty-card">{pagos.length === 0 ? "Todavía no hay pagos registrados. Usa “+ Registrar pago”." : "Ningún pago con estos filtros"}</div>
      ) : (
        <>
          {porCentro.map((g) => (
            <div key={g.centro} className="pp-centro">
              <div className="pp-centro-titulo">
                <span>{g.centro}</span>
                <span>{pesos(suma(g.pagos))}</span>
              </div>
              <div className="pm-tabla-wrap">
                <table className="pm-tabla pp-tabla">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>OF</th>
                      <th>Factura</th>
                      <th>Especialidad</th>
                      <th>Concepto</th>
                      <th className="pm-num">S/ IVA</th>
                      <th className="pm-num">Neto</th>
                      <th>F. factura</th>
                      <th>Pago</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.pagos.map((p) => {
                      const est = estadoDe(p);
                      const info = ESTADOS_PAGO[est];
                      const urg = urgenciaInfo(urgenciaEfectiva(p, hoy));
                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 600 }}>{nombreProveedor(p.proveedor_id) || "—"}</td>
                          <td>{p.oficina || ""}</td>
                          <td className="pp-folio" title={p.folio_factura || ""}>
                            {p.factura_url ? (
                              <button type="button" className="pp-link" onClick={() => abrirArchivo(p.factura_url!)} disabled={abriendo === p.factura_url}>
                                {abriendo === p.factura_url ? "Abriendo…" : p.folio_factura || "📎 Ver"}
                              </button>
                            ) : (
                              p.folio_factura || ""
                            )}
                            {p.factura_xml_url && (
                              <button type="button" className="pp-link pp-xml" onClick={() => abrirArchivo(p.factura_xml_url!)} disabled={abriendo === p.factura_xml_url} title="Ver XML">
                                XML
                              </button>
                            )}
                          </td>
                          <td>{p.categoria || ""}</td>
                          <td>{p.concepto}</td>
                          <td className="pm-num">{pesos(p.subtotal)}</td>
                          <td className="pm-num" style={{ fontWeight: 700 }}>
                            {pesos(p.monto)}
                          </td>
                          <td>{fechaCorta(p.fecha_factura)}</td>
                          <td>
                            {est === "pagado" ? (
                              <span className="pp-estado" style={{ background: info.fondo, color: info.color }}>
                                {fechaCorta(p.fecha_pago)}
                              </span>
                            ) : est === "no_pagado" ? (
                              <span className="pp-estado" style={{ background: info.fondo, color: info.color }} title={p.motivo_no_pago || ""}>
                                {info.label}
                              </span>
                            ) : (
                              <span className="pp-estado" style={{ background: urg.fondo, color: urg.color }}>
                                ● {info.label}
                              </span>
                            )}
                            {p.comprobante_pago_url && (
                              <button type="button" className="pp-link" style={{ marginLeft: 6 }} onClick={() => abrirArchivo(p.comprobante_pago_url!)} title="Comprobante de pago">
                                🧾
                              </button>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {est === "pendiente" && (
                              <>
                                <button type="button" className="pp-link" onClick={() => abrirEditar(p)} title="Corregir">
                                  ✏️
                                </button>
                                <button type="button" className="pp-link" style={{ marginLeft: 6 }} onClick={() => setBorrando(p)} title="Borrar">
                                  🗑
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>Total {g.centro}</td>
                      <td className="pm-num">{pesos(suma(g.pagos))}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
          {porCentro.length > 1 && (
            <div className="pp-centro-titulo pp-gran-total">
              <span>Total</span>
              <span>{pesos(suma(visibles))}</span>
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => !guardando && setModal(null)}>
          <form className="modal-card pp-modal" onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
            <p className="modal-nombre">{modal.editando ? "Corregir pago a proveedor" : "Pago a proveedor"}</p>
            <p className="modal-email">Contabilidad lo verá en Gastos para pagarlo.</p>

            <div className="pp-grid">
              <label>
                Centro
                <select value={form.centro} onChange={(e) => setForm({ ...form, centro: e.target.value, proveedorId: "" })}>
                  {centros.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Proveedor
                <select value={form.proveedorId} onChange={(e) => setForm({ ...form, proveedorId: e.target.value })}>
                  <option value="">Sin proveedor</option>
                  {provsDelCentro.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                  <option value="__nuevo">+ Proveedor nuevo…</option>
                </select>
              </label>
              {form.proveedorId === "__nuevo" && (
                <label className="pp-ancho">
                  Nombre del proveedor nuevo
                  <input value={form.proveedorNuevo} onChange={(e) => setForm({ ...form, proveedorNuevo: e.target.value })} placeholder="Se agrega a tus proveedores de este centro" autoFocus />
                </label>
              )}
              <label>
                OF / área
                <input value={form.oficina} onChange={(e) => setForm({ ...form, oficina: e.target.value })} placeholder="Ej. OF 18, P2 general, Baños" list="pp-oficinas" />
                <datalist id="pp-oficinas">
                  {oficinasUsadas.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </label>
              <label>
                Especialidad
                <input value={form.especialidad} onChange={(e) => setForm({ ...form, especialidad: e.target.value })} placeholder="AA, HYS, Pisos…" list="pp-especialidades" />
                <datalist id="pp-especialidades">
                  {especialidades.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </label>
              <label className="pp-ancho">
                Concepto
                <input value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Ej. Mantenimiento de AA" required />
              </label>
              <label>
                Folio de factura
                <input value={form.folio} onChange={(e) => setForm({ ...form, folio: e.target.value })} placeholder="Opcional" />
              </label>
              <label>
                Fecha de factura
                <input type="date" value={form.fechaFactura} onChange={(e) => setForm({ ...form, fechaFactura: e.target.value })} />
              </label>
            </div>

            <label className="pp-check">
              <input
                type="checkbox"
                checked={form.conIva}
                onChange={(e) => setForm({ ...form, conIva: e.target.checked, subtotal: e.target.checked ? form.subtotal : "" })}
              />
              Lleva IVA (16%)
            </label>
            <div className="pp-grid">
              {form.conIva && (
                <label>
                  Subtotal (sin IVA)
                  <input type="number" step="0.01" min="0" value={form.subtotal} onChange={(e) => cambiarSubtotal(e.target.value)} placeholder="0.00" />
                </label>
              )}
              <label>
                Neto (lo que se paga)
                <input type="number" step="0.01" min="0" value={form.neto} onChange={(e) => cambiarNeto(e.target.value)} placeholder="0.00" required />
              </label>
            </div>

            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              ¿Qué tan urgente es pagarlo?
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {URGENCIAS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setForm({ ...form, urgencia: u.id })}
                  className="pp-urgencia"
                  style={{ border: `2px solid ${form.urgencia === u.id ? u.color : "#e3e6ee"}`, background: form.urgencia === u.id ? u.fondo : "#fff" }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: u.color, display: "inline-block" }} />
                  {u.label}
                </button>
              ))}
            </div>
            <div className="pp-grid">
              <label>
                Fecha límite de pago
                <input type="date" value={form.fechaLimite} onChange={(e) => setForm({ ...form, fechaLimite: e.target.value })} />
              </label>
              <label>
                Notas para contabilidad
                <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Ej. anticipo 50%" />
              </label>
            </div>

            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              Factura (PDF o foto) · opcional{modal.editando?.factura_url ? " · ya tiene una, sube otra solo para reemplazarla" : ""}
            </p>
            <FileDropzone files={factura} onChange={setFactura} maxFiles={1} accept="image/*,.pdf" compacto />
            <p className="sub-label" style={{ margin: "4px 0 0" }}>
              XML de la factura · opcional{modal.editando?.factura_xml_url ? " · ya tiene uno, sube otro solo para reemplazarlo" : ""}
            </p>
            <FileDropzone files={xml} onChange={setXml} maxFiles={1} accept=".xml,text/xml,application/xml" etiquetaTipos="XML" compacto />

            {errorForm && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{errorForm}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setModal(null)} disabled={guardando}>
                Cancelar
              </button>
              <button type="submit" className="btn-aceptar" disabled={guardando}>
                {guardando ? "Guardando..." : modal.editando ? "Guardar cambios" : "Registrar pago"}
              </button>
            </div>
          </form>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay" onClick={() => setBorrando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">¿Borrar este pago?</p>
            <p className="modal-email">
              {nombreProveedor(borrando.proveedor_id) ? `${nombreProveedor(borrando.proveedor_id)} · ` : ""}
              {borrando.concepto} · {pesos(borrando.monto)} · {borrando.centro}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tel-borrar-btn" onClick={() => setBorrando(null)}>
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarBorrar}>
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
