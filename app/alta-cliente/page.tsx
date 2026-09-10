"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

// Lead registrado en la pestaña Prospectos de Centro — no tiene cuenta
// (profiles.id), así que elegirlo aquí solo precarga los campos del
// formulario, nunca crea la cuenta por sí solo.
type ProspectoBusqueda = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  empresa: string | null;
  rfc: string | null;
  dia_pago: number | null;
};

// Contrato creado desde Cotizar sin cliente ligado todavía (cliente_id
// null) — pendiente de conectarse a una cuenta real. nombreContesta/
// telefono/correo/tipoEspacio vienen de su cotizacion_id (cotizaciones_
// comerciales), que es la única referencia de contacto que tiene mientras
// no hay cuenta.
type ContratoPendiente = {
  id: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  horas_sala_juntas: number | null;
  deposito_garantia: number | null;
  estatus: string | null;
  cotizacion_id: string | null;
  oficina_id: string | null;
  rfc: string | null;
  nombreContesta: string | null;
  telefono: string | null;
  correo: string | null;
  razonSocial: string | null;
  tipoEspacio: string | null;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function AltaClienteInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  // Handoff desde la pestaña Prospectos de Centro (botón "👤 Nuevo cliente"
  // en cada tarjeta) — precarga nombre/correo/teléfono y, si el registro
  // se completa, marca ese prospecto como "convertido".
  const nombreDesdeUrl = searchParams.get("nombre") || "";
  const emailDesdeUrl = searchParams.get("email") || "";
  const telefonoDesdeUrl = searchParams.get("telefono") || "";
  const empresaDesdeUrl = searchParams.get("empresa") || "";
  const rfcDesdeUrl = searchParams.get("rfc") || "";
  const diaPagoDesdeUrl = searchParams.get("diaPago") || "";
  const prospectoIdDesdeUrl = searchParams.get("prospectoId") || "";
  // Handoff desde "Continuar en Alta de cliente →" en /contratos — preselecciona
  // el contrato ya aprobado en vez de obligar a buscarlo de nuevo en la lista.
  const contratoIdDesdeUrl = searchParams.get("contratoId") || "";
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [miNombre, setMiNombre] = useState("");

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
  }, []);

  // ---------- Prospecto (opcional) ----------
  // Buscador de leads ya registrados en la pestaña Prospectos — igual que
  // en Cotizar, elegir uno solo precarga los campos de abajo, no liga
  // ninguna cuenta. Al registrar el cliente, ese prospecto se marca como
  // "convertido" (lo mismo que ya pasaba al venir del botón "👤 Nuevo
  // cliente" de esa pestaña, vía prospectoIdDesdeUrl).
  const [prospectosBusqueda, setProspectosBusqueda] = useState<ProspectoBusqueda[]>([]);
  const [busquedaProspecto, setBusquedaProspecto] = useState("");
  const [prospectoSeleccionadoId, setProspectoSeleccionadoId] = useState("");
  const [mostrarListaProspectos, setMostrarListaProspectos] = useState(false);

  useEffect(() => {
    if (centro) cargarProspectos(centro);
  }, [centro]);

  async function cargarProspectos(c: string) {
    const { data } = await supabase
      .from("prospectos")
      .select("id, nombre, telefono, email, empresa, rfc, dia_pago")
      .eq("centro", c)
      .order("nombre");
    setProspectosBusqueda(data || []);
  }

  const prospectosFiltrados = useMemo(() => {
    if (!busquedaProspecto.trim()) return prospectosBusqueda;
    const q = busquedaProspecto.toLowerCase();
    return prospectosBusqueda.filter(
      (p) =>
        p.nombre?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.telefono?.toLowerCase().includes(q)
    );
  }, [busquedaProspecto, prospectosBusqueda]);

  function seleccionarProspecto(p: ProspectoBusqueda) {
    setProspectoSeleccionadoId(p.id);
    setBusquedaProspecto(p.nombre);
    setMostrarListaProspectos(false);
    setFormCliente((prev) => ({
      ...prev,
      nombre: p.nombre,
      email: p.email || prev.email,
      empresa: p.empresa || prev.empresa,
      rfc: p.rfc || prev.rfc,
      telefono: p.telefono || prev.telefono,
      diaPago: p.dia_pago != null ? String(p.dia_pago) : prev.diaPago,
    }));
  }

  function limpiarProspecto() {
    setProspectoSeleccionadoId("");
    setBusquedaProspecto("");
    setMostrarListaProspectos(false);
  }

  // ---------- Contrato a ligar (obligatorio) ----------
  // El proceso real es Prospecto → Cotizar (el contrato nace ahí, sin
  // cliente ligado todavía: cliente_id null) → se sube y aprueba el
  // contrato → HASTA ENTONCES se da de alta la cuenta. Así que aquí no se
  // crea un contrato nuevo — se busca uno YA existente sin cliente y se
  // liga a la cuenta que se acaba de crear. Si ese contrato ya estaba
  // "Aprobado/Vigente" (se aprobó sin cliente, así que sus cobros de
  // renta/depósito+adicionales nunca se generaron), se generan justo al
  // ligarlo.
  const [contratosPendientes, setContratosPendientes] = useState<ContratoPendiente[]>([]);
  const [busquedaContrato, setBusquedaContrato] = useState("");
  const [contratoSeleccionadoId, setContratoSeleccionadoId] = useState("");
  const [mostrarListaContratos, setMostrarListaContratos] = useState(false);
  const [errorContrato, setErrorContrato] = useState("");

  useEffect(() => {
    if (centro) cargarContratosPendientes(centro);
  }, [centro]);

  // Una vez que llega la lista, si venimos de "Continuar en Alta de
  // cliente →" (contratoId por URL) se preselecciona ese contrato.
  useEffect(() => {
    if (!contratoIdDesdeUrl || contratoSeleccionadoId) return;
    const c = contratosPendientes.find((ct) => ct.id === contratoIdDesdeUrl);
    if (c) seleccionarContrato(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratosPendientes, contratoIdDesdeUrl]);

  async function cargarContratosPendientes(c: string) {
    const { data: conts } = await supabase
      .from("contratos")
      .select(
        "id, fecha_inicio, fecha_vencimiento, renta_mensual, horas_sala_juntas, deposito_garantia, estatus, cotizacion_id, oficina_id, rfc"
      )
      .is("user_id", null)
      .eq("centro", c)
      .order("fecha_inicio", { ascending: false });

    const cotizacionIds = Array.from(
      new Set((conts || []).map((ct) => ct.cotizacion_id).filter((id): id is string => !!id))
    );
    const cotPorId: Record<
      string,
      {
        nombre_contesta_telefono: string | null;
        telefono_contesta: string | null;
        correo_contesta: string | null;
        tipo_espacio: string | null;
        razon_social: string | null;
      }
    > = {};
    if (cotizacionIds.length > 0) {
      const { data: cots } = await supabase
        .from("cotizaciones_comerciales")
        .select("id, nombre_contesta_telefono, telefono_contesta, correo_contesta, tipo_espacio, razon_social")
        .in("id", cotizacionIds);
      (cots || []).forEach((c2) => {
        cotPorId[c2.id] = c2;
      });
    }

    setContratosPendientes(
      (conts || []).map((ct) => {
        const cot = ct.cotizacion_id ? cotPorId[ct.cotizacion_id] : null;
        return {
          ...ct,
          nombreContesta: cot?.nombre_contesta_telefono || null,
          telefono: cot?.telefono_contesta || null,
          correo: cot?.correo_contesta || null,
          razonSocial: cot?.razon_social || null,
          tipoEspacio: cot?.tipo_espacio || null,
        };
      })
    );
  }

  const contratosFiltrados = useMemo(() => {
    if (!busquedaContrato.trim()) return contratosPendientes;
    const q = busquedaContrato.toLowerCase();
    return contratosPendientes.filter(
      (c) =>
        c.nombreContesta?.toLowerCase().includes(q) ||
        c.correo?.toLowerCase().includes(q) ||
        c.telefono?.toLowerCase().includes(q) ||
        c.tipoEspacio?.toLowerCase().includes(q)
    );
  }, [busquedaContrato, contratosPendientes]);

  function seleccionarContrato(c: ContratoPendiente) {
    setContratoSeleccionadoId(c.id);
    setBusquedaContrato(c.nombreContesta || c.tipoEspacio || "Contrato");
    setMostrarListaContratos(false);
    if (c.nombreContesta || c.telefono || c.correo || c.rfc || c.razonSocial) {
      setFormCliente((prev) => ({
        ...prev,
        nombre: prev.nombre || c.nombreContesta || "",
        telefono: prev.telefono || c.telefono || "",
        email: prev.email || c.correo || "",
        rfc: prev.rfc || c.rfc || "",
        empresa: prev.empresa || c.razonSocial || "",
      }));
    }
  }

  function limpiarContrato() {
    setContratoSeleccionadoId("");
    setBusquedaContrato("");
    setMostrarListaContratos(false);
    setErrorContrato("");
  }

  // Mismos 3 cobros que genera ContratoModal.tsx → aprobar() (renta,
  // depósito +16% IVA, adicionales) — se disparan aquí en vez de ahí porque
  // este contrato ya estaba "vigente" sin cliente, así que nunca se
  // generaron.
  async function generarCobrosPendientes(contratoId: string, clienteId: string, renta: number, deposito: number) {
    if (!centro) return;
    if (renta > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteId, monto: renta, concepto: "Contrato", contratoId, centro }),
        });
      } catch {
        // no crítico
      }
    }
    if (deposito > 0) {
      const depositoConIva = round2(deposito * 1.16);
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId,
            monto: depositoConIva,
            concepto: "Depósito en garantía (incl. IVA)",
            contratoId,
            centro,
          }),
        });
      } catch {
        // no crítico
      }
    }
    const { data: adicionales } = await supabase.from("contrato_adicionales").select("concepto, monto").eq("contrato_id", contratoId);
    for (const a of adicionales || []) {
      if (Number(a.monto) > 0) {
        try {
          await fetch("/api/pagos/crear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clienteId,
              monto: Number(a.monto),
              concepto: `Adicional: ${a.concepto}`,
              contratoId,
              centro,
            }),
          });
        } catch {
          // no crítico
        }
      }
    }
  }

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro, nombre").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    setMiNombre(profile?.nombre || "");
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
    setLoading(false);
  }

  const [formCliente, setFormCliente] = useState({
    nombre: nombreDesdeUrl,
    email: emailDesdeUrl,
    empresa: empresaDesdeUrl,
    rfc: rfcDesdeUrl,
    telefono: telefonoDesdeUrl,
    diaPago: diaPagoDesdeUrl,
  });
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [errorCliente, setErrorCliente] = useState("");
  const [clienteCreado, setClienteCreado] = useState<string | null>(null);
  // Aviso que se muestra junto a "¡Felicidades!" cuando el cliente se creó
  // bien pero algo del contrato (ligarlo, generar sus cobros) falló — no
  // bloquea el alta, que ya quedó hecha.
  const [avisoContrato, setAvisoContrato] = useState("");
  const [contratoLigado, setContratoLigado] = useState(false);

  async function registrarCliente(e: React.FormEvent) {
    e.preventDefault();
    setErrorCliente("");
    setErrorContrato("");
    if (!formCliente.nombre.trim() || !formCliente.email.trim()) {
      setErrorCliente("Nombre y correo son obligatorios");
      return;
    }
    if (!formCliente.diaPago.trim()) {
      setErrorCliente("El día del mes que paga es obligatorio");
      return;
    }
    // El proceso siempre es: prospecto → cotiza → se sube y aprueba el
    // contrato → HASTA ENTONCES se crea la cuenta. Por eso ya no se puede
    // dar de alta un cliente sin ligarlo a un contrato que ya exista.
    if (!contratoSeleccionadoId) {
      setErrorContrato("Selecciona el contrato que este cliente ya tiene en Contratos antes de crear la cuenta.");
      return;
    }
    if (!centro) return;
    setGuardandoCliente(true);

    try {
      const res = await fetch("/api/crear-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: formCliente.nombre,
          email: formCliente.email,
          empresa: formCliente.empresa,
          rfc: formCliente.rfc,
          telefono: formCliente.telefono,
          diaPago: formCliente.diaPago,
          centro,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorCliente(data.error || "No se pudo registrar el cliente");
        setGuardandoCliente(false);
        return;
      }

      const nuevoClienteId: string | undefined = data.id;
      let aviso = "";
      let ligadoOk = false;

      // El contrato ya existía (se creó desde Cotizar sin cliente) — aquí
      // solo se liga el user_id a la cuenta recién creada. Si ese contrato
      // ya estaba "vigente" (se aprobó sin cliente, sus cobros nunca se
      // generaron), se generan justo ahora.
      if (contratoSeleccionadoId && nuevoClienteId) {
        const contrato = contratosPendientes.find((c) => c.id === contratoSeleccionadoId);
        // Mismo día de pago que se acaba de mandar a /api/crear-cliente
        // (queda en profiles.dia_pago) — se refleja aquí también en el
        // contrato para que no queden desincronizados.
        const { error: updateError } = await supabase
          .from("contratos")
          .update({ user_id: nuevoClienteId, dia_pago: Number(formCliente.diaPago) })
          .eq("id", contratoSeleccionadoId);

        if (updateError) {
          aviso = "El cliente se registró, pero no se pudo ligar el contrato. Puedes ligarlo desde Contratos.";
        } else {
          ligadoOk = true;
          if (contrato?.estatus === "vigente") {
            await generarCobrosPendientes(
              contratoSeleccionadoId,
              nuevoClienteId,
              Number(contrato.renta_mensual) || 0,
              Number(contrato.deposito_garantia) || 0
            );
          }
          // Si el contrato es de una oficina privada (tiene oficina_id), esa
          // oficina se queda "disponible" en la tabla hasta este momento,
          // porque Cotizar solo la marca "ocupada" cuando ya hay un cliente
          // real (ver CotizarForm.tsx) — aquí, al fin, ya lo hay.
          if (contrato?.oficina_id) {
            const { error: oficinaError } = await supabase
              .from("oficinas")
              .update({ cliente_id: nuevoClienteId, estado: "ocupada" })
              .eq("id", contrato.oficina_id);
            if (oficinaError) {
              aviso = "El cliente se registró y el contrato quedó ligado, pero no se pudo marcar la oficina como ocupada.";
            }
          }
        }
      }

      setClienteCreado(data.numeroUsuario);
      setAvisoContrato(aviso);
      setContratoLigado(ligadoOk);
      setFormCliente({
        nombre: "",
        email: "",
        empresa: "",
        rfc: "",
        telefono: "",
        diaPago: "",
      });
      limpiarProspecto();
      limpiarContrato();
      if (centro) cargarContratosPendientes(centro);
      // Si venimos del botón "👤 Nuevo cliente" de un prospecto (por URL)
      // o se eligió uno en el buscador de arriba, ese prospecto ya se
      // convirtió en cliente — se refleja en su estado (no es crítico: si
      // falla, no bloquea el alta ya completada).
      const prospectoIdEfectivo = prospectoIdDesdeUrl || prospectoSeleccionadoId;
      if (prospectoIdEfectivo) {
        await supabase.from("prospectos").update({ estado: "convertido" }).eq("id", prospectoIdEfectivo);
      }
      setEnviado(true);
      setTimeout(() => setEnviado(false), 1800);
    } catch {
      setErrorCliente("No se pudo conectar. Intenta de nuevo.");
    }
    setGuardandoCliente(false);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Nuevo cliente</p>
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
          <form className="form-card" onSubmit={registrarCliente}>
            <p className="sub-label">Registrado por</p>
            <input value={miNombre} disabled style={{ background: "#f2f2f2", color: "#555" }} />

            <p className="panel-section-label" style={{ marginTop: 14 }}>
              Prospecto (opcional)
            </p>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Buscar prospecto por nombre, teléfono o correo... (opcional)"
                value={busquedaProspecto}
                onChange={(e) => {
                  setBusquedaProspecto(e.target.value);
                  if (prospectoSeleccionadoId) setProspectoSeleccionadoId("");
                  setMostrarListaProspectos(true);
                }}
                onFocus={() => setMostrarListaProspectos(true)}
                onBlur={() => setTimeout(() => setMostrarListaProspectos(false), 150)}
                style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
              />
              {prospectoSeleccionadoId && (
                <button
                  type="button"
                  className="tel-borrar-btn"
                  style={{ position: "absolute", right: 8, top: 8, color: "#888" }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={limpiarProspecto}
                  aria-label="Quitar prospecto seleccionado"
                >
                  ✕
                </button>
              )}
              {mostrarListaProspectos && (
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
                    maxHeight: 220,
                    overflowY: "auto",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={limpiarProspecto}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      fontSize: 13,
                      color: "#888",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid #f2f2f2",
                      cursor: "pointer",
                    }}
                  >
                    Sin prospecto
                  </button>
                  {prospectosFiltrados.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#aaa", margin: 0, padding: "10px 12px" }}>Sin resultados.</p>
                  ) : (
                    prospectosFiltrados.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => seleccionarProspecto(p)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          fontSize: 13,
                          background: p.id === prospectoSeleccionadoId ? "#F0F4FA" : "none",
                          border: "none",
                          borderBottom: "1px solid #f2f2f2",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#1a1a1a" }}>{p.nombre}</span>
                        <span style={{ display: "block", fontSize: 11, color: "#888" }}>
                          {p.telefono || ""} {p.email ? `· ${p.email}` : ""}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <p className="panel-section-label" style={{ marginTop: 14 }}>
              Datos del cliente
            </p>
            <div className="tel-form-grid">
              <div>
                <p className="sub-label">Nombre de la persona</p>
                <input
                  value={formCliente.nombre}
                  onChange={(e) => setFormCliente({ ...formCliente, nombre: e.target.value })}
                />
              </div>
              <div>
                <p className="sub-label">Correo</p>
                <input
                  type="email"
                  value={formCliente.email}
                  onChange={(e) => setFormCliente({ ...formCliente, email: e.target.value })}
                />
              </div>
              <div>
                <p className="sub-label">Empresa</p>
                <input
                  value={formCliente.empresa}
                  onChange={(e) => setFormCliente({ ...formCliente, empresa: e.target.value })}
                />
              </div>
              <div>
                <p className="sub-label">RFC</p>
                <input value={formCliente.rfc} onChange={(e) => setFormCliente({ ...formCliente, rfc: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Número celular</p>
                <input
                  value={formCliente.telefono}
                  onChange={(e) => setFormCliente({ ...formCliente, telefono: e.target.value })}
                />
              </div>
              <div>
                <p className="sub-label">Día del mes que paga</p>
                <input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="15"
                  value={formCliente.diaPago}
                  onChange={(e) => setFormCliente({ ...formCliente, diaPago: e.target.value })}
                />
              </div>
            </div>

            <p className="panel-section-label" style={{ marginTop: 14 }}>
              Contrato a ligar (obligatorio)
            </p>
            <p style={{ fontSize: 12, color: "#888", margin: "2px 0 8px" }}>
              No se puede crear la cuenta sin ligarla a un contrato ya existente (armado y/o aprobado desde
              Cotizar o Contratos). Si ese contrato ya estaba "Aprobado/Vigente", sus cobros pendientes (renta,
              depósito +IVA, adicionales) se generan justo al ligarlo aquí.
            </p>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Buscar contrato por nombre, teléfono o correo..."
                value={busquedaContrato}
                onChange={(e) => {
                  setBusquedaContrato(e.target.value);
                  if (contratoSeleccionadoId) setContratoSeleccionadoId("");
                  setMostrarListaContratos(true);
                }}
                onFocus={() => setMostrarListaContratos(true)}
                onBlur={() => setTimeout(() => setMostrarListaContratos(false), 150)}
                style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
              />
              {contratoSeleccionadoId && (
                <button
                  type="button"
                  className="tel-borrar-btn"
                  style={{ position: "absolute", right: 8, top: 8, color: "#888" }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={limpiarContrato}
                  aria-label="Quitar contrato seleccionado"
                >
                  ✕
                </button>
              )}
              {mostrarListaContratos && (
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
                  {contratosFiltrados.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#aaa", margin: 0, padding: "10px 12px" }}>
                      Sin contratos pendientes de ligar en {centro}.
                    </p>
                  ) : (
                    contratosFiltrados.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => seleccionarContrato(c)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          fontSize: 13,
                          background: c.id === contratoSeleccionadoId ? "#F0F4FA" : "none",
                          border: "none",
                          borderBottom: "1px solid #f2f2f2",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#1a1a1a" }}>
                          {c.nombreContesta || "Sin nombre"} {c.tipoEspacio ? `· ${c.tipoEspacio}` : ""}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "#888" }}>
                          {c.telefono || ""} {c.correo ? `· ${c.correo}` : ""} · $
                          {Number(c.renta_mensual).toLocaleString("es-MX")}/mes ·{" "}
                          {c.estatus === "vigente" ? "✓ Aprobado" : "⏳ Pre-aprobado"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {contratoSeleccionadoId &&
              (() => {
                const c = contratosPendientes.find((ct) => ct.id === contratoSeleccionadoId);
                if (!c) return null;
                return (
                  <div className="empty-card" style={{ textAlign: "left", marginTop: 8 }}>
                    <p style={{ margin: 0, fontSize: 13 }}>
                      {c.fecha_inicio} → {c.fecha_vencimiento} · ${Number(c.renta_mensual).toLocaleString("es-MX")}/mes
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                      Depósito: ${Number(c.deposito_garantia || 0).toLocaleString("es-MX")} · Horas sala de juntas:{" "}
                      {c.horas_sala_juntas || 0} · Estatus: {c.estatus === "vigente" ? "✓ Aprobado" : "⏳ Pre-aprobado"}
                    </p>
                  </div>
                );
              })()}

            {errorContrato && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{errorContrato}</p>}

            {errorCliente && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorCliente}</p>}

            <button
              className={"btn-enviar" + (guardandoCliente ? " sending" : "") + (enviado ? " sent" : "")}
              type="submit"
              disabled={guardandoCliente}
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
              <span className="btn-enviar-text">🎉 Registrar cliente</span>
            </button>
          </form>
        )}
      </div>

      {clienteCreado && (
        <div className="modal-overlay" onClick={() => setClienteCreado(null)}>
          <div className="confetti-wrap">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="confetti-piece"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.6}s`,
                  background: ["#f07e3a", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
                }}
              />
            ))}
          </div>
          <div className="celebracion-card" onClick={(e) => e.stopPropagation()}>
            <p className="celebracion-icon">🎉</p>
            <p className="celebracion-title">¡Felicidades!</p>
            <p className="celebracion-sub">
              Ya quedó registrado nuestro nuevo cliente.
              <br />
              Su número de usuario es{" "}
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0d1b3e" }}>
                {clienteCreado}
              </span>
              <br />
              Le mandamos un correo para que cree su contraseña.
              {contratoLigado && (
                <>
                  <br />
                  Su contrato ya quedó ligado a esta cuenta.
                </>
              )}
            </p>
            {avisoContrato && (
              <p style={{ color: "#a3701f", fontSize: 12, margin: "0 0 8px" }}>⚠️ {avisoContrato}</p>
            )}
            <button
              className="reservar-btn"
              onClick={() => {
                setClienteCreado(null);
                setAvisoContrato("");
                setContratoLigado(false);
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AltaClientePage() {
  return (
    <Suspense fallback={null}>
      <AltaClienteInner />
    </Suspense>
  );
}
