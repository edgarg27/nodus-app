"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";
import ContratoModal, { ESTATUS_LABEL } from "./ContratoModal";

// Lead de la pestaña Prospectos de Centro — todavía sin cuenta (profiles.id).
// "+ Nuevo contrato" liga uno de estos, nunca un cliente ya existente: la
// cuenta se crea después, en /alta-cliente, ligando este mismo contrato.
type ProspectoBusqueda = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  empresa: string | null;
  rfc: string | null;
  dia_pago: number | null;
};

// Cotización ya trabajada con ese prospecto (si existe) — se ofrece para
// jalar sus datos (fechas, precio, depósito, oficina/paquete) al contrato
// nuevo, en vez de volver a capturarlos a mano.
type CotizacionCandidata = {
  id: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  precio_neto: number | null;
  deposito_garantia: number | null;
  oficina_id: string | null;
  paquete_id: string | null;
  tipo_espacio: string | null;
};

type OficinaOpcion = { id: string; numero: string; tipo: string; estado: string };

export type Contrato = {
  id: string;
  user_id: string | null;
  centro: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  horas_sala_juntas: number | null;
  horas_bolsa: number | null;
  deposito_garantia: number | null;
  estatus: string | null;
  archivo_url: string | null;
  cliente_nombre_historico: string | null;
  cliente_email_historico: string | null;
  cliente_empresa_historico: string | null;
  monto_adeudado: number | null;
  fecha_baja: string | null;
  dia_pago: number | null;
  cotizacion_id: string | null;
  firmado: boolean;
  firmado_at: string | null;
  enviado_a_firma_at: string | null;
  plan_nombre?: string | null;
  cliente_nombre?: string;
  cliente_empresa?: string | null;
  cliente_email?: string;
  cliente_telefono?: string | null;
};

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

export default function ContratosPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);

  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [prospectosBusqueda, setProspectosBusqueda] = useState<ProspectoBusqueda[]>([]);
  const [oficinasDisponibles, setOficinasDisponibles] = useState<OficinaOpcion[]>([]);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (centro) fetchTodo(centro);
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

  async function fetchTodo(c: string) {
    setLoading(true);
    const { data: clis } = await supabase
      .from("profiles")
      .select("id, nombre, email, empresa, telefono")
      .eq("rol", "cliente")
      .eq("centro", c)
      .order("nombre");

    const { data: prospectos } = await supabase
      .from("prospectos")
      .select("id, nombre, telefono, email, empresa, rfc, dia_pago")
      .eq("centro", c)
      .order("nombre");
    setProspectosBusqueda(prospectos || []);

    const { data: ofs } = await supabase.from("oficinas").select("id, numero, tipo, estado").eq("centro", c);
    // .order("numero") de Supabase ordena como texto (1, 10, 11, 2, 20...) —
    // aquí se ordena numéricamente (1, 2, 3...) y, si empatan, por tipo.
    setOficinasDisponibles(
      (ofs || []).slice().sort((a, b) => {
        const na = parseInt(a.numero, 10);
        const nb = parseInt(b.numero, 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.numero.localeCompare(b.numero, "es", { numeric: true }) || a.tipo.localeCompare(b.tipo, "es");
      })
    );

    const nombrePorId: Record<string, string> = {};
    const empresaPorId: Record<string, string | null> = {};
    const emailPorId: Record<string, string> = {};
    const telefonoPorId: Record<string, string | null> = {};
    (clis || []).forEach((cl) => {
      nombrePorId[cl.id] = cl.nombre;
      empresaPorId[cl.id] = cl.empresa;
      emailPorId[cl.id] = cl.email;
      telefonoPorId[cl.id] = cl.telefono;
    });

    const { data: conts } = await supabase
      .from("contratos")
      .select("*")
      .eq("centro", c)
      .order("created_at", { ascending: false });

    // Contratos creados desde Cotizar no tienen "plan" — su origen (paquete
    // y/o oficina) se resuelve vía cotizacion_id → cotizaciones_comerciales.
    const cotizacionIds = Array.from(
      new Set((conts || []).map((ct) => ct.cotizacion_id).filter((id): id is string => !!id))
    );
    const labelPorCotizacion: Record<string, string> = {};
    if (cotizacionIds.length > 0) {
      const { data: cots } = await supabase
        .from("cotizaciones_comerciales")
        .select("id, paquete_id, oficina_id, modalidad_paquete")
        .in("id", cotizacionIds);
      const paqueteIds = Array.from(new Set((cots || []).map((c) => c.paquete_id).filter((id): id is string => !!id)));
      const oficinaIds = Array.from(new Set((cots || []).map((c) => c.oficina_id).filter((id): id is string => !!id)));
      const [{ data: paqs }, { data: ofs }] = await Promise.all([
        paqueteIds.length > 0
          ? supabase.from("paquetes").select("id, nombre").in("id", paqueteIds)
          : Promise.resolve({ data: [] as { id: string; nombre: string }[] }),
        oficinaIds.length > 0
          ? supabase.from("oficinas").select("id, numero").in("id", oficinaIds)
          : Promise.resolve({ data: [] as { id: string; numero: string }[] }),
      ]);
      const nombrePaquetePorId: Record<string, string> = {};
      (paqs || []).forEach((p) => {
        nombrePaquetePorId[p.id] = p.nombre;
      });
      const numeroOficinaPorId: Record<string, string> = {};
      (ofs || []).forEach((o) => {
        numeroOficinaPorId[o.id] = o.numero;
      });
      (cots || []).forEach((c) => {
        const partes = [
          c.paquete_id ? `📦 ${nombrePaquetePorId[c.paquete_id] || "Paquete"}` : null,
          c.modalidad_paquete || null,
          c.oficina_id ? `Oficina ${numeroOficinaPorId[c.oficina_id] || ""}` : null,
        ].filter(Boolean);
        labelPorCotizacion[c.id] = partes.join(" · ");
      });
    }

    setContratos(
      (conts || []).map((ct) => ({
        ...ct,
        cliente_nombre: ct.user_id ? nombrePorId[ct.user_id] : ct.cliente_nombre_historico,
        cliente_empresa: ct.user_id ? empresaPorId[ct.user_id] : ct.cliente_empresa_historico,
        cliente_email: ct.user_id ? emailPorId[ct.user_id] : ct.cliente_email_historico,
        cliente_telefono: ct.user_id ? telefonoPorId[ct.user_id] : null,
        plan_nombre: ct.cotizacion_id ? labelPorCotizacion[ct.cotizacion_id] || null : null,
      }))
    );
    setLoading(false);
  }

  // ---- Aprobación de contratos pre_aprobado ----
  const [contratoEditando, setContratoEditando] = useState<Contrato | null>(null);
  const [procesandoAprobacion, setProcesandoAprobacion] = useState<string | null>(null);
  const [vistaContratos, setVistaContratos] = useState<"pendientes" | "todos">("pendientes");

  // Casilla "Confirmo que el documento cargado es la versión firmada" por
  // tarjeta de contrato pendiente — el botón "✓ Aprobar" no se habilita
  // solo con el archivo cargado, también hace falta esta confirmación.
  const [confirmacionFirma, setConfirmacionFirma] = useState<Record<string, boolean>>({});

  // Búsqueda por nombre, empresa, teléfono, correo o folio (id del
  // contrato) — aplica tanto a "Pendientes de aprobación" como a "Todos".
  const [busquedaContratos, setBusquedaContratos] = useState("");
  function coincideBusquedaContrato(c: Contrato) {
    const q = busquedaContratos.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.cliente_nombre || "").toLowerCase().includes(q) ||
      (c.cliente_empresa || "").toLowerCase().includes(q) ||
      (c.cliente_telefono || "").toLowerCase().includes(q) ||
      (c.cliente_email || "").toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  }
  const contratosPendientes = contratos.filter((c) => c.estatus === "pre_aprobado" && coincideBusquedaContrato(c));
  const contratosFiltrados = contratos.filter(coincideBusquedaContrato);

  // Duplica exactamente la misma lógica de pagos que ContratoModal.tsx →
  // aprobar() — es indispensable no dejar esta vía sin la lógica, porque es
  // el camino más directo que usa el staff desde la lista de pendientes
  // (regla de negocio #3 de DOCUMENTACION_COTIZAR.md).
  async function aprobarContrato(c: Contrato) {
    if (!c.archivo_url || !confirmacionFirma[c.id]) return;
    setProcesandoAprobacion(c.id);
    await supabase.from("contratos").update({ estatus: "vigente", firmado: true }).eq("id", c.id);

    const renta = Number(c.renta_mensual) || 0;
    if (c.user_id && renta > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: c.user_id,
            monto: renta,
            concepto: c.plan_nombre || "Contrato",
            contratoId: c.id,
            centro: c.centro,
          }),
        });
      } catch {
        // no crítico
      }
    }

    // Se cobra depósito + IVA (16%), igual que la renta y los adicionales
    // (ver el mismo fix en ContratoModal.tsx → aprobar()).
    const deposito = Number(c.deposito_garantia) || 0;
    const depositoConIva = Math.round(deposito * 1.16 * 100) / 100;
    if (c.user_id && deposito > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: c.user_id,
            monto: depositoConIva,
            concepto: "Depósito en garantía (incl. IVA)",
            contratoId: c.id,
            centro: c.centro,
          }),
        });
      } catch {
        // no crítico
      }
    }

    if (c.user_id) {
      const { data: adicionales } = await supabase
        .from("contrato_adicionales")
        .select("concepto, monto")
        .eq("contrato_id", c.id);
      for (const a of adicionales || []) {
        if (Number(a.monto) > 0) {
          try {
            await fetch("/api/pagos/crear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clienteId: c.user_id,
                monto: a.monto,
                concepto: `Adicional: ${a.concepto}`,
                contratoId: c.id,
                centro: c.centro,
              }),
            });
          } catch {
            // no crítico
          }
        }
      }
    }

    setProcesandoAprobacion(null);
    if (centro) fetchTodo(centro);
  }

  async function rechazarContrato(c: Contrato) {
    if (!confirm("¿Rechazar este contrato? El cliente no quedará activo con este plan.")) return;
    setProcesandoAprobacion(c.id);
    await supabase.from("contratos").update({ estatus: "rechazado" }).eq("id", c.id);
    setProcesandoAprobacion(null);
    if (centro) fetchTodo(centro);
  }

  // ---- Renovación de contrato ----
  // Cuando un contrato vigente llega (o está por llegar) a su
  // fecha_vencimiento: captura la nueva fecha y, si aplica, el % de
  // incremento sobre la renta actual (mismo concepto que "esRenovacion"
  // en CotizarForm.tsx) — actualiza el contrato existente, no crea uno
  // nuevo desde cero.
  const [renovandoId, setRenovandoId] = useState<string | null>(null);
  const [formRenovacion, setFormRenovacion] = useState({ fecha_vencimiento: "", porcentaje_incremento: "" });
  const [guardandoRenovacion, setGuardandoRenovacion] = useState(false);
  const [errorRenovacion, setErrorRenovacion] = useState("");

  function abrirRenovacion(c: Contrato) {
    setRenovandoId(c.id);
    setFormRenovacion({ fecha_vencimiento: "", porcentaje_incremento: "" });
    setErrorRenovacion("");
  }

  function cerrarRenovacion() {
    setRenovandoId(null);
    setErrorRenovacion("");
  }

  async function guardarRenovacion(c: Contrato) {
    setErrorRenovacion("");
    if (!formRenovacion.fecha_vencimiento) {
      setErrorRenovacion("Captura la nueva fecha de vencimiento");
      return;
    }
    setGuardandoRenovacion(true);
    const incremento = Number(formRenovacion.porcentaje_incremento) || 0;
    const nuevaRenta = incremento > 0 ? Math.round(c.renta_mensual * (1 + incremento / 100) * 100) / 100 : c.renta_mensual;

    const { error } = await supabase
      .from("contratos")
      .update({ fecha_vencimiento: formRenovacion.fecha_vencimiento, renta_mensual: nuevaRenta })
      .eq("id", c.id);

    setGuardandoRenovacion(false);
    if (error) {
      setErrorRenovacion("No se pudo renovar el contrato. Intenta de nuevo.");
      return;
    }
    setRenovandoId(null);
    if (centro) fetchTodo(centro);
  }

  // ---- Formulario Contrato ----
  // Siempre se crea para un PROSPECTO (nunca para un cliente ya existente):
  // la cuenta se da de alta después, en /alta-cliente, ligando este mismo
  // contrato — así es como pidió Charly que funcionara el proceso completo.
  const [formContrato, setFormContrato] = useState({
    fecha_inicio: new Date().toISOString().split("T")[0],
    fecha_vencimiento: "",
    renta_mensual: "",
    deposito_garantia: "",
    horas_sala_juntas: "",
    dia_pago: "",
  });
  const [archivoContrato, setArchivoContrato] = useState<File | null>(null);
  const [mostrarFormContrato, setMostrarFormContrato] = useState(false);
  const [guardandoContrato, setGuardandoContrato] = useState(false);
  const [contratoEnviado, setContratoEnviado] = useState(false);
  const [errorContrato, setErrorContrato] = useState("");

  // Prospecto al que se le va a crear el contrato.
  const [busquedaProspectoContrato, setBusquedaProspectoContrato] = useState("");
  const [prospectoContrato, setProspectoContrato] = useState<ProspectoBusqueda | null>(null);
  const [mostrarListaProspectosContrato, setMostrarListaProspectosContrato] = useState(false);
  const prospectosContratoFiltrados = prospectosBusqueda.filter((p) => {
    if (!busquedaProspectoContrato.trim()) return true;
    const q = busquedaProspectoContrato.toLowerCase();
    return (
      p.nombre.toLowerCase().includes(q) ||
      (p.telefono || "").toLowerCase().includes(q) ||
      (p.email || "").toLowerCase().includes(q)
    );
  });

  // Cotizaciones ya trabajadas con ese prospecto (si las hay) — se ofrecen
  // para jalar sus datos al contrato en vez de volver a capturarlos.
  const [cotizacionesCandidatas, setCotizacionesCandidatas] = useState<CotizacionCandidata[]>([]);
  const [cotizacionSeleccionadaId, setCotizacionSeleccionadaId] = useState("");
  const [oficinaSeleccionadaId, setOficinaSeleccionadaId] = useState("");

  async function seleccionarProspectoContrato(p: ProspectoBusqueda) {
    setProspectoContrato(p);
    setBusquedaProspectoContrato(p.nombre);
    setMostrarListaProspectosContrato(false);
    setFormContrato((prev) => ({ ...prev, dia_pago: p.dia_pago != null ? String(p.dia_pago) : prev.dia_pago }));

    if (!centro) return;
    // .or() de Supabase separa condiciones por coma — se limpia el nombre de
    // comas/paréntesis para no romper el filtro si el prospecto trae algo así.
    const nombreLimpio = p.nombre.replace(/[,()]/g, " ").trim();
    const filtros = [
      nombreLimpio ? `nombre_contesta_telefono.ilike.%${nombreLimpio}%` : null,
      p.telefono ? `telefono_contesta.eq.${p.telefono}` : null,
      p.email ? `correo_contesta.eq.${p.email}` : null,
    ]
      .filter(Boolean)
      .join(",");
    if (!filtros) return;
    const { data: cots } = await supabase
      .from("cotizaciones_comerciales")
      .select("id, fecha_inicio, fecha_fin, precio_neto, deposito_garantia, oficina_id, paquete_id, tipo_espacio")
      .eq("centro", centro)
      .or(filtros)
      .order("created_at", { ascending: false })
      .limit(5);
    setCotizacionesCandidatas(cots || []);
  }

  function limpiarProspectoContrato() {
    setProspectoContrato(null);
    setBusquedaProspectoContrato("");
    setMostrarListaProspectosContrato(false);
    setCotizacionesCandidatas([]);
    setCotizacionSeleccionadaId("");
    setOficinaSeleccionadaId("");
  }

  async function seleccionarCotizacionCandidata(cot: CotizacionCandidata) {
    setCotizacionSeleccionadaId(cot.id);
    setOficinaSeleccionadaId(cot.oficina_id || "");
    let horasSala = 0;
    if (cot.paquete_id) {
      const { data: paq } = await supabase
        .from("paquetes")
        .select("incluye_horas_sala_juntas")
        .eq("id", cot.paquete_id)
        .maybeSingle();
      horasSala = paq?.incluye_horas_sala_juntas || 0;
    }
    setFormContrato((prev) => ({
      ...prev,
      fecha_inicio: cot.fecha_inicio || prev.fecha_inicio,
      fecha_vencimiento: cot.fecha_fin || prev.fecha_vencimiento,
      renta_mensual: cot.precio_neto != null ? String(cot.precio_neto) : prev.renta_mensual,
      deposito_garantia: cot.deposito_garantia != null ? String(cot.deposito_garantia) : prev.deposito_garantia,
      horas_sala_juntas: horasSala ? String(horasSala) : prev.horas_sala_juntas,
    }));
  }

  async function agregarContrato(e: React.FormEvent) {
    e.preventDefault();
    setErrorContrato("");
    if (!prospectoContrato || !formContrato.fecha_vencimiento || !formContrato.renta_mensual) {
      setErrorContrato("Completa el prospecto, la fecha de vencimiento y la renta mensual");
      return;
    }
    setGuardandoContrato(true);

    let archivoUrl: string | null = null;
    if (archivoContrato) {
      const fileName = `${prospectoContrato.id}-${Date.now()}.${archivoContrato.name.split(".").pop() || "pdf"}`;
      const { error: uploadError } = await supabase.storage
        .from("contratos")
        .upload(fileName, archivoContrato, { contentType: archivoContrato.type, upsert: true });
      if (uploadError) {
        setErrorContrato("No se pudo subir el PDF: " + uploadError.message);
        setGuardandoContrato(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("contratos").getPublicUrl(fileName);
      archivoUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("contratos").insert({
      // Sin cliente todavía — se liga hasta que se dé de alta la cuenta en
      // /alta-cliente. Mientras tanto, el nombre/correo del prospecto se
      // guardan en los mismos campos "historico" que ya usa el contrato
      // para mostrar el nombre cuando no hay user_id (ver fetchTodo arriba).
      user_id: null,
      cliente_nombre_historico: prospectoContrato.nombre,
      cliente_email_historico: prospectoContrato.email || null,
      cliente_empresa_historico: prospectoContrato.empresa || null,
      cotizacion_id: cotizacionSeleccionadaId || null,
      oficina_id: oficinaSeleccionadaId || null,
      centro,
      fecha_inicio: formContrato.fecha_inicio,
      fecha_vencimiento: formContrato.fecha_vencimiento,
      renta_mensual: Number(formContrato.renta_mensual),
      deposito_garantia: Number(formContrato.deposito_garantia) || 0,
      horas_sala_juntas: Number(formContrato.horas_sala_juntas) || 0,
      dia_pago: formContrato.dia_pago ? Number(formContrato.dia_pago) : null,
      // Igual que todo contrato creado desde Cotizar: entra "pre_aprobado" y
      // pasa por la lista de arriba (subir el PDF firmado y Aprobar), que es
      // donde se generan sus cobros — nunca se crea "vigente" directo.
      estatus: "pre_aprobado",
      archivo_url: archivoUrl,
    });

    setGuardandoContrato(false);
    if (insertError) {
      setErrorContrato("No se pudo guardar el contrato. Intenta de nuevo.");
      return;
    }

    setFormContrato({
      fecha_inicio: new Date().toISOString().split("T")[0],
      fecha_vencimiento: "",
      renta_mensual: "",
      deposito_garantia: "",
      horas_sala_juntas: "",
      dia_pago: "",
    });
    setArchivoContrato(null);
    limpiarProspectoContrato();
    setMostrarFormContrato(false);
    setContratoEnviado(true);
    setTimeout(() => setContratoEnviado(false), 1800);
    if (centro) fetchTodo(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Contratos</p>
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
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={"centro-tab" + (vistaContratos === "pendientes" ? " active" : "")}
                onClick={() => setVistaContratos("pendientes")}
              >
                ⏳ Pendientes de aprobación ({contratosPendientes.length})
              </button>
              <button
                className={"centro-tab" + (vistaContratos === "todos" ? " active" : "")}
                onClick={() => setVistaContratos("todos")}
              >
                📄 Todos los contratos ({contratosFiltrados.length})
              </button>
            </div>

            <input
              placeholder="Buscar por nombre, empresa, teléfono, correo o folio..."
              value={busquedaContratos}
              onChange={(e) => setBusquedaContratos(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
            />

            {vistaContratos === "pendientes" && (
              <div className="rep-ocupacion-card">
                {contratosPendientes.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Sin contratos pendientes de aprobación</p>
                ) : (
                  contratosPendientes.map((c) => (
                  <div className="contrato-card-admin" key={c.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {c.cliente_nombre || "Cliente"} {c.cliente_empresa ? `· ${c.cliente_empresa}` : ""}
                        </p>
                        <p className="contrato-detalle">{c.cliente_email}</p>
                        <p className="contrato-detalle">
                          ${c.renta_mensual.toLocaleString("es-MX")}/mes {c.plan_nombre ? `· ${c.plan_nombre}` : ""}
                        </p>
                      </div>
                      <span className="factura-badge" style={{ background: ESTATUS_LABEL.pre_aprobado.bg }}>
                        <span className="factura-badge-text" style={{ color: ESTATUS_LABEL.pre_aprobado.color }}>
                          {ESTATUS_LABEL.pre_aprobado.label}
                        </span>
                      </span>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8, color: "#333" }}>
                      <input
                        type="checkbox"
                        checked={!!confirmacionFirma[c.id]}
                        onChange={(e) => setConfirmacionFirma((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                      />
                      Confirmo que el documento cargado es la versión firmada
                    </label>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn-aceptar"
                        onClick={() => aprobarContrato(c)}
                        disabled={procesandoAprobacion === c.id || !c.archivo_url || !confirmacionFirma[c.id]}
                      >
                        ✓ Aprobar
                      </button>
                      <button
                        className="btn-rechazar"
                        onClick={() => rechazarContrato(c)}
                        disabled={procesandoAprobacion === c.id}
                      >
                        ✗ Rechazar
                      </button>
                      {!c.archivo_url && (
                        <p style={{ fontSize: 12, color: "#a3701f", width: "100%", margin: "6px 0 0" }}>
                          ⚠️ Sube el contrato firmado antes de aprobar
                        </p>
                      )}
                      {c.archivo_url && !confirmacionFirma[c.id] && (
                        <p style={{ fontSize: 12, color: "#a3701f", width: "100%", margin: "6px 0 0" }}>
                          ⚠️ Marca la casilla de confirmación antes de aprobar
                        </p>
                      )}
                      <button
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        onClick={() => setContratoEditando(c)}
                      >
                        ✎ Editar
                      </button>
                    </div>
                  </div>
                  ))
                )}
              </div>
            )}

            {vistaContratos === "todos" && (
            <div className="rep-ocupacion-card">
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-exportar"
                  onClick={() =>
                    exportarExcel(
                      `contratos-${centro}`,
                      contratos.map((c) => ({
                        Cliente: c.cliente_nombre || "",
                        Correo: c.cliente_email || "",
                        Empresa: c.cliente_empresa || "",
                        Inicio: c.fecha_inicio,
                        "Fin (vencimiento o baja)": c.fecha_baja || c.fecha_vencimiento,
                        "Renta mensual": c.renta_mensual,
                        "Horas sala de juntas": c.horas_sala_juntas || 0,
                        Estatus: c.estatus || "",
                        "Monto adeudado": c.monto_adeudado || 0,
                      }))
                    )
                  }
                >
                  📥 Excel
                </button>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setMostrarFormContrato((v) => !v)}
                >
                  {mostrarFormContrato ? "Cancelar" : "+ Nuevo contrato"}
                </button>
              </div>
            </div>

            {mostrarFormContrato && (
              <form className="form-card" onSubmit={agregarContrato}>
                <p className="sub-label">Prospecto</p>
                {prospectoContrato ? (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <span style={{ fontSize: 14 }}>
                      {prospectoContrato.nombre}
                      {prospectoContrato.telefono ? ` · ${prospectoContrato.telefono}` : ""}
                      {prospectoContrato.email ? ` · ${prospectoContrato.email}` : ""}
                    </span>
                    <button type="button" className="tel-borrar-btn" onClick={limpiarProspectoContrato}>
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    <input
                      placeholder="Buscar prospecto por nombre, teléfono o correo..."
                      value={busquedaProspectoContrato}
                      onChange={(e) => {
                        setBusquedaProspectoContrato(e.target.value);
                        setMostrarListaProspectosContrato(true);
                      }}
                      onFocus={() => setMostrarListaProspectosContrato(true)}
                      onBlur={() => setTimeout(() => setMostrarListaProspectosContrato(false), 150)}
                      style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
                    />
                    {mostrarListaProspectosContrato && (
                      <div
                        style={{
                          position: "absolute",
                          zIndex: 10,
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: 4,
                          background: "#fff",
                          border: "1px solid #eee",
                          borderRadius: 10,
                          maxHeight: 260,
                          overflowY: "auto",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        }}
                      >
                        {prospectosContratoFiltrados.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#aaa", margin: 0, padding: "10px 12px" }}>
                            Sin prospectos que coincidan. Regístralo primero en Prospectos (pestaña Centro).
                          </p>
                        ) : (
                          prospectosContratoFiltrados.map((p) => (
                            <button
                              type="button"
                              key={p.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => seleccionarProspectoContrato(p)}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 12px",
                                fontSize: 13,
                                background: "none",
                                border: "none",
                                borderBottom: "1px solid #f2f2f2",
                                cursor: "pointer",
                              }}
                            >
                              <span style={{ fontWeight: 600, color: "#1a1a1a", display: "block" }}>{p.nombre}</span>
                              <span style={{ display: "block", fontSize: 11, color: "#888" }}>
                                {p.telefono || "Sin teléfono"} {p.email ? `· ${p.email}` : ""}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {prospectoContrato && cotizacionesCandidatas.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p className="sub-label">Cotización de este prospecto (opcional, jala sus datos)</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {cotizacionesCandidatas.map((cot) => (
                        <button
                          type="button"
                          key={cot.id}
                          className="tel-borrar-btn"
                          style={{
                            textAlign: "left",
                            border: cotizacionSeleccionadaId === cot.id ? "2px solid #0d1b3e" : "1px solid #eee",
                            borderRadius: 8,
                            padding: "8px 10px",
                            color: "#0d1b3e",
                          }}
                          onClick={() => seleccionarCotizacionCandidata(cot)}
                        >
                          {cot.tipo_espacio || "Cotización"} · $
                          {(cot.precio_neto || 0).toLocaleString("es-MX")}/mes
                          {cot.fecha_inicio ? ` · desde ${cot.fecha_inicio}` : ""}
                          {cotizacionSeleccionadaId === cot.id ? " ✓" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="tel-form-grid" style={{ marginTop: 10 }}>
                  <div>
                    <p className="sub-label">Fecha inicio</p>
                    <input
                      type="date"
                      value={formContrato.fecha_inicio}
                      onChange={(e) => setFormContrato({ ...formContrato, fecha_inicio: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Fecha vencimiento</p>
                    <input
                      type="date"
                      value={formContrato.fecha_vencimiento}
                      onChange={(e) => setFormContrato({ ...formContrato, fecha_vencimiento: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Renta mensual</p>
                    <input
                      type="number"
                      step="0.01"
                      value={formContrato.renta_mensual}
                      onChange={(e) => setFormContrato({ ...formContrato, renta_mensual: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Depósito en garantía</p>
                    <input
                      type="number"
                      step="0.01"
                      value={formContrato.deposito_garantia}
                      onChange={(e) => setFormContrato({ ...formContrato, deposito_garantia: e.target.value })}
                    />
                    <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>
                      Se cobra + 16% de IVA al aprobar el contrato.
                    </p>
                  </div>
                  <div>
                    <p className="sub-label">Oficina (si es privada)</p>
                    <select value={oficinaSeleccionadaId} onChange={(e) => setOficinaSeleccionadaId(e.target.value)}>
                      <option value="">Sin oficina asignada</option>
                      {oficinasDisponibles.map((o) => (
                        <option key={o.id} value={o.id}>
                          Oficina {o.numero} ({o.tipo}){o.estado === "ocupada" ? " — ocupada" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="sub-label">Horas sala de juntas</p>
                    <input
                      type="number"
                      value={formContrato.horas_sala_juntas}
                      onChange={(e) => setFormContrato({ ...formContrato, horas_sala_juntas: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="sub-label">Día del mes que paga (ej. 15)</p>
                    <input
                      type="number"
                      min={4}
                      max={25}
                      placeholder="15"
                      value={formContrato.dia_pago}
                      onChange={(e) => setFormContrato({ ...formContrato, dia_pago: e.target.value })}
                    />
                    <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>
                      Usa un día entre el 4 y el 25.
                    </p>
                  </div>
                </div>

                <p className="sub-label">Subir contrato (PDF, opcional)</p>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => setArchivoContrato(e.target.files?.[0] || null)}
                />

                {errorContrato && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorContrato}</p>}

                <button
                  className={"btn-enviar" + (guardandoContrato ? " sending" : "") + (contratoEnviado ? " sent" : "")}
                  type="submit"
                  disabled={guardandoContrato}
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
                  <span className="btn-enviar-text">+ Guardar contrato</span>
                </button>
              </form>
            )}

            {contratosFiltrados.length === 0 ? (
              <div className="empty-card">
                {busquedaContratos ? "Sin contratos que coincidan con la búsqueda" : `Sin contratos registrados en ${centro}`}
              </div>
            ) : (
              contratosFiltrados.map((c) => {
                const esInactivoDebe = c.estatus === "inactivo_debe";
                const badge = ESTATUS_LABEL[c.estatus || ""] || { label: c.estatus || "—", bg: "#F0F0F0", color: "#555" };
                const etiqueta = esInactivoDebe
                  ? `⚠️ Inactivo · debe $${Number(c.monto_adeudado || 0).toLocaleString("es-MX")}`
                  : badge.label;
                const fechaFin = c.fecha_baja || c.fecha_vencimiento;

                return (
                  <div className="contrato-card-admin" key={c.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {c.cliente_nombre || "Cliente"} {c.cliente_empresa ? `· ${c.cliente_empresa}` : ""}
                        </p>
                        <p className="contrato-detalle">{c.cliente_email}</p>
                        <p className="contrato-detalle">
                          Ocupó del {c.fecha_inicio} al {fechaFin}
                          {c.fecha_baja && c.fecha_baja !== c.fecha_vencimiento
                            ? " (salió antes de lo previsto)"
                            : ""}
                        </p>
                        <p className="contrato-detalle">
                          ${c.renta_mensual.toLocaleString("es-MX")}/mes
                          {c.horas_sala_juntas ? ` · ${c.horas_sala_juntas}h sala de juntas` : ""}
                          {c.horas_bolsa ? ` · ${c.horas_bolsa}h bolsa` : ""}
                          {c.dia_pago ? ` · paga el día ${c.dia_pago}` : ""}
                        </p>
                        {c.plan_nombre && <p className="contrato-detalle">{c.plan_nombre}</p>}
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {etiqueta}
                        </span>
                      </span>
                    </div>
                    {c.archivo_url ? (
                      <a className="ver-pdf-btn" href={c.archivo_url} target="_blank" download>
                        📥 Ver y descargar contrato
                      </a>
                    ) : (
                      <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>Sin contrato PDF adjunto</p>
                    )}
                    {!c.user_id && c.estatus !== "rechazado" && (
                      <a className="ver-pdf-btn" href={`/alta-cliente?contratoId=${c.id}`}>
                        Continuar en Alta de cliente →
                      </a>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", fontWeight: 600 }}
                        onClick={() => setContratoEditando(c)}
                      >
                        ✎ Editar
                      </button>
                      {c.estatus === "vigente" && (
                        <button
                          className="tel-borrar-btn"
                          style={{ color: "#0d1b3e", fontWeight: 600 }}
                          onClick={() => (renovandoId === c.id ? cerrarRenovacion() : abrirRenovacion(c))}
                        >
                          {renovandoId === c.id ? "Cancelar renovación" : "🔄 Renovar"}
                        </button>
                      )}
                    </div>

                    {renovandoId === c.id && (
                      <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginTop: 8 }}>
                        <p className="sub-label">Renta actual: ${c.renta_mensual.toLocaleString("es-MX")}/mes</p>
                        <div className="tel-form-grid">
                          <div>
                            <p className="sub-label">Nueva fecha de vencimiento</p>
                            <input
                              type="date"
                              value={formRenovacion.fecha_vencimiento}
                              onChange={(e) => setFormRenovacion({ ...formRenovacion, fecha_vencimiento: e.target.value })}
                            />
                          </div>
                          <div>
                            <p className="sub-label">% de incremento (opcional)</p>
                            <input
                              type="number"
                              step="0.01"
                              value={formRenovacion.porcentaje_incremento}
                              onChange={(e) => setFormRenovacion({ ...formRenovacion, porcentaje_incremento: e.target.value })}
                            />
                          </div>
                        </div>
                        {Number(formRenovacion.porcentaje_incremento) > 0 && (
                          <p style={{ fontSize: 12, color: "#555", margin: "6px 0 0" }}>
                            Nueva renta: $
                            {(
                              Math.round(c.renta_mensual * (1 + Number(formRenovacion.porcentaje_incremento) / 100) * 100) / 100
                            ).toLocaleString("es-MX")}
                            /mes
                          </p>
                        )}
                        {errorRenovacion && <p style={{ color: "#A32D2D", fontSize: 12, marginTop: 6 }}>{errorRenovacion}</p>}
                        <button
                          className="btn-aceptar"
                          style={{ marginTop: 8 }}
                          onClick={() => guardarRenovacion(c)}
                          disabled={guardandoRenovacion}
                        >
                          {guardandoRenovacion ? "Renovando…" : "✓ Confirmar renovación"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>
            )}
          </>
        )}
      </div>

      {contratoEditando && (
        <ContratoModal
          contrato={contratoEditando}
          onClose={() => setContratoEditando(null)}
          onGuardado={() => {
            setContratoEditando(null);
            if (centro) fetchTodo(centro);
          }}
        />
      )}
    </div>
  );
}
