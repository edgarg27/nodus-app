"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import type { Contrato } from "./page";
import FileDropzone from "@/app/soporte/FileDropzone";
import { conIva, sinIva } from "@/lib/adicionales";

type VersionContrato = {
  id: string;
  archivo_url: string;
  nombre_archivo: string | null;
  created_at: string;
};

type CatalogoItem = {
  id: string;
  nombre: string;
  descripcion: string | null;
  costo_unitario: number;
};

type AdicionalRow = {
  id: string;
  adicional_id: string | null;
  concepto: string;
  descripcion: string | null;
  costo_unitario: number;
  cantidad: number;
  monto: number;
};

type CambioContrato = {
  id: string;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  cambiado_por_nombre: string | null;
  created_at: string;
};

const dinero = (n: number) => `$${n.toLocaleString("es-MX")}`;

export const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pre_aprobado: { label: "⏳ Pre-aprobado", bg: "#FAEEDA", color: "#854F0B" },
  vigente: { label: "✓ Activo", bg: "#E1F5EE", color: "#0F6E56" },
  rechazado: { label: "✗ Rechazado", bg: "#FCEBEB", color: "#A32D2D" },
  inactivo_debe: { label: "⚠️ Inactivo · debe", bg: "#FCEBEB", color: "#A32D2D" },
  inactivo_pagado: { label: "✓ Inactivo · pagado", bg: "#F0F0F0", color: "#555" },
};

export default function ContratoModal({
  contrato,
  onClose: onCloseProp,
  onGuardado,
  onRefrescar,
}: {
  contrato: Contrato;
  onClose: () => void;
  onGuardado: () => void;
  // Refresca la lista de contratos de atrás SIN cerrar este modal — se usa
  // al aprobar el contrato de un cliente que ya tenía cuenta, para poder
  // mostrar la pantalla de éxito aquí mismo antes de cerrar (ver aprobar()).
  onRefrescar: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [form, setForm] = useState({
    fecha_inicio: contrato.fecha_inicio,
    fecha_vencimiento: contrato.fecha_vencimiento,
    renta_mensual: String(contrato.renta_mensual ?? ""),
    horas_sala_juntas: String(contrato.horas_sala_juntas ?? 0),
    dia_pago: contrato.dia_pago ? String(contrato.dia_pago) : "",
    deposito_garantia: contrato.deposito_garantia != null ? String(contrato.deposito_garantia) : "",
  });
  const [archivosNuevos, setArchivosNuevos] = useState<File[]>([]);
  const [versiones, setVersiones] = useState<VersionContrato[]>([]);
  const [marcandoFinal, setMarcandoFinal] = useState<string | null>(null);
  const [abriendoArchivoUrl, setAbriendoArchivoUrl] = useState<string | null>(null);

  async function abrirArchivoContrato(archivoUrl: string) {
    setAbriendoArchivoUrl(archivoUrl);
    const { url, error: signErr } = await pedirLinkFirmado(archivoUrl);
    setAbriendoArchivoUrl(null);
    if (!url) {
      alert("No se pudo abrir el archivo: " + (signErr || "intenta de nuevo"));
      return;
    }
    window.open(url, "_blank");
  }

  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [procesandoAprobacion, setProcesandoAprobacion] = useState(false);
  const [error, setError] = useState("");
  const [estatus, setEstatus] = useState(contrato.estatus || "");
  const [archivoFinalUrl, setArchivoFinalUrl] = useState(contrato.archivo_url);
  const [confirmacionFirma, setConfirmacionFirma] = useState(false);
  const [enviandoFirma, setEnviandoFirma] = useState(false);
  const [exitoAprobacionVisible, setExitoAprobacionVisible] = useState(false);
  const [confirmandoRechazo, setConfirmandoRechazo] = useState(false);

  // ---------- Adicionales (catálogo con buscador + persistencia inmediata) ----------
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [adicionales, setAdicionales] = useState<AdicionalRow[]>([]);
  const [cargandoAdicionales, setCargandoAdicionales] = useState(true);

  const [mostrarPicker, setMostrarPicker] = useState(false);
  const [busquedaAdicional, setBusquedaAdicional] = useState("");
  const [procesandoAdicional, setProcesandoAdicional] = useState(false);
  const [errorAdicional, setErrorAdicional] = useState("");

  const [nuevoTipoAbierto, setNuevoTipoAbierto] = useState(false);
  const [nuevoTipoNombre, setNuevoTipoNombre] = useState("");
  const [nuevoTipoDescripcion, setNuevoTipoDescripcion] = useState("");
  const [nuevoTipoCosto, setNuevoTipoCosto] = useState("");

  const [historial, setHistorial] = useState<CambioContrato[]>([]);
  // Foto de los adicionales tal como estaban al abrir (o al último guardado),
  // para registrar en el historial solo lo que de verdad cambió.
  const snapshotAdicionales = useRef<Map<string, AdicionalRow>>(new Map());

  // Guarda renglones en el historial de cambios. Es best-effort: si falla (ej.
  // la tabla aún no existe) NO bloquea el guardado del contrato.
  async function insertarCambios(cambios: { campo: string; anterior: string; nuevo: string }[]) {
    if (cambios.length === 0) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: perfil } = user
      ? await supabase.from("profiles").select("nombre").eq("id", user.id).maybeSingle()
      : { data: null };
    await supabase.from("contrato_cambios").insert(
      cambios.map((c) => ({
        contrato_id: contrato.id,
        campo: c.campo,
        valor_anterior: c.anterior || null,
        valor_nuevo: c.nuevo || null,
        cambiado_por: user?.id || null,
        cambiado_por_nombre: perfil?.nombre || user?.email || null,
      }))
    );
  }

  // Compara los adicionales de ahora contra la foto y devuelve los cambios;
  // deja la foto al día para no registrar dos veces lo mismo.
  function cambiosDeAdicionales() {
    const foto = snapshotAdicionales.current;
    const cambios: { campo: string; anterior: string; nuevo: string }[] = [];
    for (const a of adicionales) {
      const antes = foto.get(a.id);
      if (!antes) {
        cambios.push({ campo: `Adicional agregado: ${a.concepto}`, anterior: "", nuevo: dinero(conIva(a.concepto, a.monto)) });
        continue;
      }
      if (antes.costo_unitario !== a.costo_unitario) {
        cambios.push({
          campo: `Adicional ${a.concepto}: costo unitario`,
          anterior: dinero(conIva(a.concepto, antes.costo_unitario)),
          nuevo: dinero(conIva(a.concepto, a.costo_unitario)),
        });
      }
      if (antes.cantidad !== a.cantidad) {
        cambios.push({ campo: `Adicional ${a.concepto}: cantidad`, anterior: String(antes.cantidad), nuevo: String(a.cantidad) });
      }
    }
    for (const [id, antes] of Array.from(foto.entries())) {
      if (!adicionales.some((a) => a.id === id)) {
        cambios.push({
          campo: `Adicional eliminado: ${antes.concepto}`,
          anterior: dinero(conIva(antes.concepto, antes.monto)),
          nuevo: "",
        });
      }
    }
    snapshotAdicionales.current = new Map(adicionales.map((a) => [a.id, a]));
    return cambios;
  }

  // Cerrar el modal también registra los cambios de adicionales hechos sin
  // dar "Guardar cambios" (los adicionales se guardan al instante).
  function onClose() {
    if (!cargandoAdicionales) void insertarCambios(cambiosDeAdicionales());
    onCloseProp();
  }

  useEffect(() => {
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarTodo() {
    setCargandoAdicionales(true);
    const [{ data: cat }, { data: adi }, { data: vers }, { data: hist }] = await Promise.all([
      supabase.from("adicionales_catalogo").select("*").eq("centro", contrato.centro).eq("activo", true).order("nombre"),
      supabase.from("contrato_adicionales").select("*").eq("contrato_id", contrato.id).order("created_at"),
      supabase
        .from("contrato_versiones")
        .select("id, archivo_url, nombre_archivo, created_at")
        .eq("contrato_id", contrato.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contrato_cambios")
        .select("id, campo, valor_anterior, valor_nuevo, cambiado_por_nombre, created_at")
        .eq("contrato_id", contrato.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setHistorial(hist || []);
    setVersiones(vers || []);
    setCatalogo(cat || []);
    const filasAdicionales: AdicionalRow[] = (adi || []).map((a) => ({
      id: a.id,
      adicional_id: a.adicional_id,
      concepto: a.concepto,
      descripcion: a.descripcion,
      costo_unitario: Number(a.costo_unitario) || 0,
      cantidad: Number(a.cantidad) || 1,
      monto: Number(a.monto) || 0,
    }));
    snapshotAdicionales.current = new Map(filasAdicionales.map((a) => [a.id, a]));
    setAdicionales(filasAdicionales);
    setCargandoAdicionales(false);
  }

  // Lo que se muestra y se cobra: el Estacionamiento ya con IVA incluido
  // (en la base se guarda sin IVA, ver lib/adicionales.ts).
  const totalAdicionales = useMemo(() => adicionales.reduce((s, a) => s + conIva(a.concepto, a.monto), 0), [adicionales]);
  const totalContrato = (Number(form.renta_mensual) || 0) + totalAdicionales;

  const catalogoFiltrado = useMemo(() => {
    if (!busquedaAdicional.trim()) return catalogo;
    const q = busquedaAdicional.toLowerCase();
    return catalogo.filter((c) => c.nombre.toLowerCase().includes(q) || (c.descripcion || "").toLowerCase().includes(q));
  }, [busquedaAdicional, catalogo]);

  const idsCatalogoYaAgregados = new Set(adicionales.map((a) => a.adicional_id).filter(Boolean));

  async function agregarDelCatalogo(item: CatalogoItem) {
    setErrorAdicional("");
    setProcesandoAdicional(true);
    const { data, error: insertError } = await supabase
      .from("contrato_adicionales")
      .insert({
        contrato_id: contrato.id,
        adicional_id: item.id,
        concepto: item.nombre,
        descripcion: item.descripcion,
        costo_unitario: item.costo_unitario,
        cantidad: 1,
        monto: item.costo_unitario,
      })
      .select()
      .single();
    setProcesandoAdicional(false);
    if (insertError || !data) {
      setErrorAdicional("No se pudo agregar el adicional. Intenta de nuevo.");
      return;
    }
    setAdicionales((prev) => [
      ...prev,
      {
        id: data.id,
        adicional_id: data.adicional_id,
        concepto: data.concepto,
        descripcion: data.descripcion,
        costo_unitario: Number(data.costo_unitario) || 0,
        cantidad: Number(data.cantidad) || 1,
        monto: Number(data.monto) || 0,
      },
    ]);

    // Genera el pago pendiente del adicional — no bloquea si falla.
    if (contrato.user_id && item.costo_unitario > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: contrato.user_id,
            monto: conIva(item.nombre, item.costo_unitario),
            concepto: `Adicional: ${item.nombre}`,
            contratoId: contrato.id,
            centro: contrato.centro,
          }),
        });
      } catch {
        // no crítico
      }
    }
  }

  async function actualizarLinea(row: AdicionalRow, campo: "costo_unitario" | "cantidad", valor: string) {
    const num = Number(valor);
    if (Number.isNaN(num)) return;
    const costo_unitario = campo === "costo_unitario" ? num : row.costo_unitario;
    const cantidad = campo === "cantidad" ? Math.max(1, num) : row.cantidad;
    const monto = costo_unitario * cantidad;

    setAdicionales((prev) => prev.map((a) => (a.id === row.id ? { ...a, costo_unitario, cantidad, monto } : a)));

    await supabase.from("contrato_adicionales").update({ costo_unitario, cantidad, monto }).eq("id", row.id);
  }

  async function eliminarAdicional(id: string) {
    setAdicionales((prev) => prev.filter((a) => a.id !== id));
    await supabase.from("contrato_adicionales").delete().eq("id", id);
  }

  async function crearTipoYAgregar() {
    if (!nuevoTipoNombre.trim()) {
      setErrorAdicional("Ponle un nombre al nuevo adicional");
      return;
    }
    setErrorAdicional("");
    setProcesandoAdicional(true);
    const { data, error: insertError } = await supabase
      .from("adicionales_catalogo")
      .insert({
        centro: contrato.centro,
        nombre: nuevoTipoNombre.trim(),
        descripcion: nuevoTipoDescripcion.trim() || null,
        costo_unitario: Number(nuevoTipoCosto) || 0,
      })
      .select()
      .single();
    setProcesandoAdicional(false);
    if (insertError || !data) {
      setErrorAdicional("No se pudo crear el nuevo tipo de adicional (¿ya existe uno con ese nombre?).");
      return;
    }
    setCatalogo((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setNuevoTipoNombre("");
    setNuevoTipoDescripcion("");
    setNuevoTipoCosto("");
    setNuevoTipoAbierto(false);
    await agregarDelCatalogo(data);
  }

  async function guardarCambios() {
    setError("");
    setGuardando(true);

    // Subir un contrato modificado agrega una versión nueva — ya NO
    // sobreescribe el machote ni el archivo_url operativo directo; el
    // staff decide cuál marcar como final con marcarComoFinal() más abajo.
    const archivoNuevo = archivosNuevos[0];
    if (archivoNuevo) {
      const fileName = `${contrato.user_id || contrato.id}-${Date.now()}.${archivoNuevo.name.split(".").pop() || "pdf"}`;
      const { error: uploadError } = await supabase.storage
        .from("contratos")
        .upload(fileName, archivoNuevo, { contentType: archivoNuevo.type, upsert: true });
      if (uploadError) {
        setError("No se pudo subir el PDF: " + uploadError.message);
        setGuardando(false);
        return;
      }
      const archivoUrl = supabase.storage.from("contratos").getPublicUrl(fileName).data.publicUrl;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: versionError } = await supabase.from("contrato_versiones").insert({
        contrato_id: contrato.id,
        archivo_url: archivoUrl,
        nombre_archivo: archivoNuevo.name,
        subido_por: user?.id,
      });
      if (versionError) {
        setError("No se pudo registrar la versión subida: " + versionError.message);
        setGuardando(false);
        return;
      }
      setArchivosNuevos([]);
    }

    const { error: updateError } = await supabase
      .from("contratos")
      .update({
        fecha_inicio: form.fecha_inicio,
        fecha_vencimiento: form.fecha_vencimiento,
        renta_mensual: Number(form.renta_mensual) || 0,
        horas_sala_juntas: Number(form.horas_sala_juntas) || 0,
        dia_pago: form.dia_pago ? Number(form.dia_pago) : null,
        deposito_garantia: form.deposito_garantia ? Number(form.deposito_garantia) : null,
      })
      .eq("id", contrato.id);

    setGuardando(false);
    if (updateError) {
      setError("No se pudo guardar el contrato. Intenta de nuevo.");
      return;
    }

    // Historial: qué campos cambiaron respecto a como se abrió el contrato
    // (más los adicionales editados). No bloquea nada si falla.
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
    const camposPrincipales: { campo: string; anterior: string; nuevo: string; dinero?: boolean }[] = [
      { campo: "Fecha de inicio", anterior: contrato.fecha_inicio || "", nuevo: form.fecha_inicio || "" },
      { campo: "Fecha de vencimiento", anterior: contrato.fecha_vencimiento || "", nuevo: form.fecha_vencimiento || "" },
      { campo: "Renta mensual", anterior: num(contrato.renta_mensual), nuevo: num(form.renta_mensual), dinero: true },
      { campo: "Horas sala de juntas", anterior: num(contrato.horas_sala_juntas), nuevo: num(form.horas_sala_juntas) },
      { campo: "Día de pago", anterior: num(contrato.dia_pago), nuevo: num(form.dia_pago) },
      { campo: "Depósito en garantía", anterior: num(contrato.deposito_garantia), nuevo: num(form.deposito_garantia), dinero: true },
    ];
    const cambiosPrincipales = camposPrincipales
      .filter((c) => c.anterior !== c.nuevo)
      .map((c) => ({
        campo: c.campo,
        anterior: c.dinero && c.anterior ? dinero(Number(c.anterior)) : c.anterior,
        nuevo: c.dinero && c.nuevo ? dinero(Number(c.nuevo)) : c.nuevo,
      }));
    void insertarCambios([...cambiosPrincipales, ...cambiosDeAdicionales()]);

    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    onGuardado();
    onClose();
  }

  async function marcarComoFinal(url: string) {
    setMarcandoFinal(url);
    setError("");
    const { error: updateError } = await supabase.from("contratos").update({ archivo_url: url }).eq("id", contrato.id);
    setMarcandoFinal(null);
    if (updateError) {
      setError("No se pudo marcar esa versión como final: " + updateError.message);
      return;
    }
    setArchivoFinalUrl(url);
    onGuardado();
  }

  async function enviarAFirma() {
    setEnviandoFirma(true);
    setError("");
    try {
      const res = await fetch("/api/contratos/enviar-a-firma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contratoId: contrato.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo mandar el contrato a firma");
        return;
      }
      onGuardado();
    } finally {
      setEnviandoFirma(false);
    }
  }

  async function aprobar() {
    if (!archivoFinalUrl || !(confirmacionFirma || contrato.firmado)) return;
    setProcesandoAprobacion(true);
    await supabase.from("contratos").update({ estatus: "vigente", firmado: true }).eq("id", contrato.id);

    // El pago de la renta se genera hasta ahora — al aprobar el contrato,
    // no al crearlo (nace en pre_aprobado y no debe cobrarse antes).
    const renta = Number(form.renta_mensual) || 0;
    if (contrato.user_id && renta > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: contrato.user_id,
            monto: renta,
            concepto: contrato.plan_nombre || "Contrato",
            contratoId: contrato.id,
            centro: contrato.centro,
          }),
        });
      } catch {
        // no crítico
      }
    }

    // El depósito en garantía también se registra como pago — así, al dar
    // de baja al cliente, se puede restar del total que debe (si ya lo pagó).
    // Se cobra depósito + IVA (16%), igual que la renta y los adicionales.
    const deposito = Number(form.deposito_garantia) || 0;
    const depositoConIva = Math.round(deposito * 1.16 * 100) / 100;
    if (contrato.user_id && deposito > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: contrato.user_id,
            monto: depositoConIva,
            concepto: "Depósito en garantía (incl. IVA)",
            contratoId: contrato.id,
            centro: contrato.centro,
          }),
        });
      } catch {
        // no crítico
      }
    }

    // Adicionales que ya existían al momento de crear el contrato (agregados
    // desde Cotizar) tampoco tenían pago todavía — se generan aquí, junto
    // con la renta. Los que se agreguen después (contrato ya vigente) se
    // pagan al instante desde agregarDelCatalogo, así que no se duplican.
    if (contrato.user_id) {
      for (const a of adicionales) {
        if (a.monto > 0) {
          try {
            await fetch("/api/pagos/crear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clienteId: contrato.user_id,
                monto: conIva(a.concepto, a.monto),
                concepto: `Adicional: ${a.concepto}`,
                contratoId: contrato.id,
                centro: contrato.centro,
              }),
            });
          } catch {
            // no crítico
          }
        }
      }
    }

    setProcesandoAprobacion(false);
    setEstatus("vigente");

    // Cliente nuevo (sin cuenta todavía) → seguir directo a Alta de
    // cliente con este contrato ya ligado. Si ya tenía cuenta (ej. una
    // renovación), no hay a dónde más llevarlo — se queda aquí mismo y
    // se le confirma con una pantalla de éxito antes de cerrar.
    if (!contrato.user_id) {
      onGuardado();
      router.push(`/alta-cliente?contratoId=${contrato.id}`);
    } else {
      onRefrescar();
      setExitoAprobacionVisible(true);
    }
  }

  async function rechazar() {
    setConfirmandoRechazo(false);
    setProcesandoAprobacion(true);
    await supabase.from("contratos").update({ estatus: "rechazado" }).eq("id", contrato.id);
    setProcesandoAprobacion(false);
    setEstatus("rechazado");
    onGuardado();
  }

  const badge = ESTATUS_LABEL[estatus] || { label: estatus || "—", bg: "#F0F0F0", color: "#555" };

  if (exitoAprobacionVisible) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="invitado-exito-card" onClick={(e) => e.stopPropagation()}>
          <div className="invitado-exito-icono">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <p className="invitado-exito-titulo">¡Se agregó con éxito!</p>
          <p className="invitado-exito-mensaje">
            El contrato de {contrato.cliente_nombre || "el cliente"} ya está vigente.
          </p>
          <button className="invitado-exito-btn" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div style={{ flex: 1 }}>
            <p className="modal-nombre">
              {contrato.cliente_nombre || "Cliente"} {contrato.cliente_empresa ? `· ${contrato.cliente_empresa}` : ""}
            </p>
            <p className="modal-email">{contrato.cliente_email}</p>
          </div>
          <button className="modal-cerrar" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p className="modal-seccion" style={{ margin: 0 }}>
            📄 Contrato
          </p>
          <span className="factura-badge" style={{ background: badge.bg }}>
            <span className="factura-badge-text" style={{ color: badge.color }}>
              {badge.label}
            </span>
          </span>
        </div>

        {contrato.plan_nombre && (
          <div className="modal-row">
            <span className="modal-label">Origen</span>
            <span className="modal-val">{contrato.plan_nombre}</span>
          </div>
        )}
        <div className="modal-row">
          <span className="modal-label">Centro</span>
          <span className="modal-val">{contrato.centro || "—"}</span>
        </div>
        {contrato.monto_adeudado ? (
          <div className="modal-row">
            <span className="modal-label">Monto adeudado</span>
            <span className="modal-val">${Number(contrato.monto_adeudado).toLocaleString("es-MX")}</span>
          </div>
        ) : null}
        {contrato.fecha_baja && (
          <div className="modal-row">
            <span className="modal-label">Fecha de baja</span>
            <span className="modal-val">{contrato.fecha_baja}</span>
          </div>
        )}

        {estatus === "pre_aprobado" && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {archivoFinalUrl && !contrato.firmado && (
              <div style={{ width: "100%" }}>
                <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={enviarAFirma} disabled={enviandoFirma}>
                  {enviandoFirma ? "Mandando…" : contrato.enviado_a_firma_at ? "📧 Reenviar a firma" : "📧 Enviar a firma"}
                </button>
                {contrato.enviado_a_firma_at && (
                  <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                    Mandado a firma el {new Date(contrato.enviado_a_firma_at).toLocaleDateString("es-MX")} — todavía no lo firma el cliente.
                  </p>
                )}
              </div>
            )}
            {contrato.firmado ? (
              <p style={{ fontSize: 12, color: "#0F6E56", width: "100%", margin: 0 }}>
                ✓ Firmado por el cliente{contrato.firmado_at ? ` el ${new Date(contrato.firmado_at).toLocaleDateString("es-MX")}` : ""}.
              </p>
            ) : (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, width: "100%", color: "#333" }}>
                <input
                  type="checkbox"
                  checked={confirmacionFirma}
                  onChange={(e) => setConfirmacionFirma(e.target.checked)}
                />
                Confirmo que el documento cargado es la versión firmada
              </label>
            )}
            <button
              className="btn-aceptar"
              onClick={aprobar}
              disabled={procesandoAprobacion || !archivoFinalUrl || !(confirmacionFirma || contrato.firmado)}
            >
              ✓ Aprobar contrato
            </button>
            <button className="btn-rechazar" onClick={() => setConfirmandoRechazo(true)} disabled={procesandoAprobacion}>
              ✗ Rechazar contrato
            </button>
            {!archivoFinalUrl && (
              <p style={{ fontSize: 12, color: "#a3701f", width: "100%", margin: "6px 0 0" }}>
                ⚠️ Sube el contrato firmado antes de aprobar — si acabas de seleccionar el PDF, dale "Guardar cambios" primero.
              </p>
            )}
          </div>
        )}

        <p className="modal-seccion">✎ Datos del contrato</p>
        <div className="tel-form-grid">
          <div>
            <p className="sub-label">Fecha inicio</p>
            <input
              type="date"
              value={form.fecha_inicio}
              onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })}
            />
          </div>
          <div>
            <p className="sub-label">Fecha vencimiento</p>
            <input
              type="date"
              value={form.fecha_vencimiento}
              onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
            />
          </div>
          <div>
            <p className="sub-label">Renta mensual</p>
            <input
              type="number"
              step="0.01"
              value={form.renta_mensual}
              onChange={(e) => setForm({ ...form, renta_mensual: e.target.value })}
            />
          </div>
          <div>
            <p className="sub-label">Día del mes que paga</p>
            <input
              type="number"
              min={4}
              max={25}
              value={form.dia_pago}
              onChange={(e) => setForm({ ...form, dia_pago: e.target.value })}
            />
          </div>
          <div>
            <p className="sub-label">Horas sala de juntas</p>
            <input
              type="number"
              value={form.horas_sala_juntas}
              onChange={(e) => setForm({ ...form, horas_sala_juntas: e.target.value })}
            />
          </div>
          <div>
            <p className="sub-label">Depósito de garantía</p>
            <input
              type="number"
              step="0.01"
              value={form.deposito_garantia}
              onChange={(e) => setForm({ ...form, deposito_garantia: e.target.value })}
            />
          </div>
        </div>

        <p className="modal-seccion">📎 Contrato PDF (Machote pre-generado)</p>
        {contrato.archivo_machote_url || contrato.archivo_url ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ver-pdf-btn"
              onClick={() => abrirArchivoContrato((contrato.archivo_machote_url || contrato.archivo_url)!)}
              disabled={abriendoArchivoUrl === (contrato.archivo_machote_url || contrato.archivo_url)}
            >
              {abriendoArchivoUrl === (contrato.archivo_machote_url || contrato.archivo_url)
                ? "Abriendo…"
                : "📥 Ver y descargar machote"}
            </button>
            {archivoFinalUrl === (contrato.archivo_machote_url || contrato.archivo_url) ? (
              <span style={{ fontSize: 12, color: "#0F6E56", fontWeight: 600 }}>★ Es la versión final</span>
            ) : (
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => marcarComoFinal((contrato.archivo_machote_url || contrato.archivo_url)!)}
                disabled={marcandoFinal === (contrato.archivo_machote_url || contrato.archivo_url)}
              >
                ✓ Usar como final
              </button>
            )}
          </div>
        ) : (
          <p className="empty-card" style={{ margin: 0 }}>
            Todavía no hay machote generado para este contrato.
          </p>
        )}

        {versiones.length > 0 && (
          <>
            <p className="sub-label" style={{ marginTop: 10 }}>
              Versiones subidas
            </p>
            {versiones.map((v) => (
              <div
                key={v.id}
                className="cotizacion-card"
                style={{ padding: "8px 10px", marginBottom: 6 }}
              >
                <div>
                  <p className="item-card-titulo" style={{ fontSize: 13 }}>
                    {v.nombre_archivo || "Contrato subido"}
                  </p>
                  <p className="item-card-sub">{new Date(v.created_at).toLocaleString("es-MX")}</p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="ver-pdf-btn"
                    onClick={() => abrirArchivoContrato(v.archivo_url)}
                    disabled={abriendoArchivoUrl === v.archivo_url}
                  >
                    {abriendoArchivoUrl === v.archivo_url ? "Abriendo…" : "📥 Ver"}
                  </button>
                  {archivoFinalUrl === v.archivo_url ? (
                    <span style={{ fontSize: 12, color: "#0F6E56", fontWeight: 600 }}>★ Final</span>
                  ) : (
                    <button
                      className="tel-borrar-btn"
                      style={{ color: "#0d1b3e", fontWeight: 600 }}
                      onClick={() => marcarComoFinal(v.archivo_url)}
                      disabled={marcandoFinal === v.archivo_url}
                    >
                      ✓ Usar como final
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        <p className="sub-label" style={{ marginTop: 10 }}>
          Subir contrato modificado
        </p>
        <FileDropzone files={archivosNuevos} onChange={setArchivosNuevos} maxFiles={1} accept="application/pdf,image/*" />
        {archivosNuevos.length > 0 && (
          <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
            Dale "Guardar cambios" para subirlo — no se reemplaza el machote, queda como una versión más para elegir.
          </p>
        )}

        {/* ---------------- Adicionales ---------------- */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <p className="modal-seccion" style={{ margin: 0 }}>
            ➕ Adicionales {totalAdicionales > 0 && `· $${totalAdicionales.toLocaleString("es-MX")}`}
          </p>
          {estatus === "vigente" && (
            <button
              className="tel-borrar-btn"
              style={{ color: "#0d1b3e", fontWeight: 600 }}
              onClick={() => setMostrarPicker((v) => !v)}
            >
              {mostrarPicker ? "Cerrar" : "+ Agregar adicional"}
            </button>
          )}
        </div>

        {estatus !== "vigente" && (
          <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 4px" }}>
            Los adicionales se pueden agregar hasta que el contrato esté aprobado (vigente).
          </p>
        )}

        {mostrarPicker && estatus === "vigente" && (
          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <input
              placeholder="Buscar adicional (ej. Persona extra, Estacionamiento...)"
              value={busquedaAdicional}
              onChange={(e) => setBusquedaAdicional(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13 }}
            />

            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
              {catalogoFiltrado.length === 0 ? (
                <p style={{ fontSize: 12, color: "#aaa", margin: "4px 0" }}>Sin resultados en el catálogo de {contrato.centro}.</p>
              ) : (
                catalogoFiltrado.map((item) => {
                  const yaAgregado = idsCatalogoYaAgregados.has(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 0",
                        borderBottom: "1px solid #f2f2f2",
                        opacity: yaAgregado ? 0.5 : 1,
                      }}
                    >
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{item.nombre}</p>
                        {item.descripcion && (
                          <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{item.descripcion}</p>
                        )}
                        <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
                          ${conIva(item.nombre, Number(item.costo_unitario)).toLocaleString("es-MX")} c/u
                        </p>
                      </div>
                      <button
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        disabled={yaAgregado || procesandoAdicional}
                        onClick={() => agregarDelCatalogo(item)}
                      >
                        {yaAgregado ? "✓ Agregado" : "+ Agregar"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {nuevoTipoAbierto ? (
              <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
                <p className="sub-label">Nuevo tipo de adicional</p>
                <input
                  placeholder="Nombre (ej. Estacionamiento)"
                  value={nuevoTipoNombre}
                  onChange={(e) => setNuevoTipoNombre(e.target.value)}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                />
                <input
                  placeholder="Descripción (opcional)"
                  value={nuevoTipoDescripcion}
                  onChange={(e) => setNuevoTipoDescripcion(e.target.value)}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Costo unitario"
                  value={nuevoTipoCosto}
                  onChange={(e) => setNuevoTipoCosto(e.target.value)}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className={"btn-enviar" + (procesandoAdicional ? " sending" : "")}
                    style={{ padding: "8px 16px" }}
                    onClick={crearTipoYAgregar}
                    disabled={procesandoAdicional}
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
                    <span className="btn-enviar-text">Crear y agregar</span>
                  </button>
                  <button className="tel-borrar-btn" style={{ color: "#888" }} onClick={() => setNuevoTipoAbierto(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 8 }}
                onClick={() => setNuevoTipoAbierto(true)}
              >
                + Crear nuevo tipo de adicional
              </button>
            )}

            {errorAdicional && <p style={{ color: "#A32D2D", fontSize: 12, marginTop: 6 }}>{errorAdicional}</p>}
          </div>
        )}

        {cargandoAdicionales ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando adicionales...</p>
          </div>
        ) : adicionales.length === 0 ? (
          <p style={{ fontSize: 12, color: "#aaa", margin: "4px 0" }}>Sin adicionales registrados.</p>
        ) : (
          adicionales.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                borderBottom: "1px solid #f2f2f2",
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{a.concepto}</p>
                {a.descripcion && <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{a.descripcion}</p>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#888" }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  value={conIva(a.concepto, a.costo_unitario)}
                  onChange={(e) => {
                    const capturado = Number(e.target.value);
                    actualizarLinea(
                      a,
                      "costo_unitario",
                      Number.isNaN(capturado) ? e.target.value : String(sinIva(a.concepto, capturado))
                    );
                  }}
                  style={{ width: 70, border: "1px solid #eee", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                />
                <span style={{ fontSize: 11, color: "#888" }}>×</span>
                <input
                  type="number"
                  min={1}
                  value={a.cantidad}
                  onChange={(e) => actualizarLinea(a, "cantidad", e.target.value)}
                  style={{ width: 50, border: "1px solid #eee", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                />
              </div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0d1b3e", minWidth: 70, textAlign: "right" }}>
                ${conIva(a.concepto, a.monto).toLocaleString("es-MX")}
              </p>
              <button className="tel-borrar-btn" onClick={() => eliminarAdicional(a.id)}>
                🗑
              </button>
            </div>
          ))
        )}

        <div className="resumen-reserva-row" style={{ marginTop: 8 }}>
          <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
            Total del contrato (renta + adicionales)
          </span>
          <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
            ${totalContrato.toLocaleString("es-MX")}
          </span>
        </div>

        {historial.length > 0 && (
          <>
            <p className="modal-seccion" style={{ marginTop: 12 }}>
              🕓 Historial de cambios
            </p>
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              {historial.map((h) => (
                <div key={h.id} style={{ padding: "6px 0", borderBottom: "1px solid #f2f2f2" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                    {h.campo}: {h.valor_anterior || "—"} → {h.valor_nuevo || "—"}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#888" }}>
                    {h.cambiado_por_nombre || "—"} · {new Date(h.created_at).toLocaleString("es-MX")}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}

        <button
          className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
          style={{ marginTop: 12 }}
          onClick={guardarCambios}
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
          <span className="btn-enviar-text">Guardar cambios</span>
        </button>
      </div>
    </div>

    {confirmandoRechazo && (
      <div className="modal-overlay" onClick={() => setConfirmandoRechazo(false)}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <p className="modal-nombre">Rechazar contrato</p>
          <p className="sub-label" style={{ marginTop: 8 }}>
            ¿Rechazar este contrato? El cliente no quedará activo con este plan.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="tel-borrar-btn" onClick={() => setConfirmandoRechazo(false)}>
              Cancelar
            </button>
            <button className="btn-rechazar" onClick={rechazar}>
              ✗ Rechazar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
