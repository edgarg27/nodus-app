"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import FileDropzone from "@/app/soporte/FileDropzone";
import { CUENTAS_DEPOSITO } from "@/lib/cuentasDeposito";

// Cobranza también ve los tres centros (como en Facturación e Ingresos).
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

// Mismo concepto exacto que genera ContratoModal.tsx → aprobar() al crear
// el pago del depósito (incluye IVA, ver ese archivo) — es el único filtro
// que distingue estos pagos de la renta/adicionales en la tabla `pagos`.
const CONCEPTO_DEPOSITO = "Depósito en garantía (incl. IVA)";

const ESTATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "⏳ Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  pagado: { label: "✓ Realizado", bg: "#E1F5EE", color: "#0F6E56" },
};

type Deposito = {
  id: string;
  user_id: string | null;
  monto: number;
  contrato_id: string | null;
  centro: string;
  estado: string;
  created_at: string;
  comprobante_url?: string | null;
  // A qué cuenta cayó (IT CREATIVE / Nova Holding), ver migracion_deposito_cuenta.sql.
  cuenta_destino?: string | null;
  cliente_nombre?: string;
  cliente_empresa?: string | null;
  // Depósitos "todavía sin pago real": el contrato ya tiene monto de
  // depósito capturado pero sigue pre_aprobado — el pago de verdad (fila
  // en `pagos`) no nace hasta que se aprueba en ContratoModal.tsx →
  // aprobar(). Se muestran aparte, sin el botón de marcar realizado,
  // para que el staff no piense que "no hay nada pendiente".
  esPagoReal: boolean;
};

export default function DepositoGarantiaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [abriendoComprobanteId, setAbriendoComprobanteId] = useState<string | null>(null);

  async function abrirComprobante(id: string, comprobanteUrl: string) {
    setAbriendoComprobanteId(id);
    const { url, error: signErr } = await pedirLinkFirmado(comprobanteUrl);
    setAbriendoComprobanteId(null);
    if (!url) {
      alert("No se pudo abrir el comprobante: " + (signErr || "intenta de nuevo"));
      return;
    }
    window.open(url, "_blank");
  }
  const [subiendoParaId, setSubiendoParaId] = useState<string | null>(null);
  const [archivosComprobante, setArchivosComprobante] = useState<File[]>([]);
  const [errorComprobante, setErrorComprobante] = useState("");
  const [cuentaElegida, setCuentaElegida] = useState("");
  // "Cambiar cuenta" de un depósito ya realizado.
  const [cambiandoCuentaId, setCambiandoCuentaId] = useState<string | null>(null);

  const esGlobal = ROLES_GLOBALES.includes(miRol);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (centro) fetchDepositos(centro);
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

  async function fetchDepositos(c: string) {
    setLoading(true);
    const leerDepositos = (columnas: string) =>
      supabase.from("pagos").select(columnas).eq("centro", c).eq("concepto", CONCEPTO_DEPOSITO).order("created_at", { ascending: false });
    const [{ data: pgsConCuenta, error: errCuenta }, { data: contratosConDeposito }] = await Promise.all([
      leerDepositos("id, user_id, monto, contrato_id, centro, estado, created_at, comprobante_url, cuenta_destino"),
      // Contratos que ya tienen monto de depósito capturado pero siguen
      // pre_aprobado — todavía no existe su fila real en `pagos` (nace
      // hasta que se aprueban), pero el staff necesita verlos igual.
      supabase
        .from("contratos")
        .select("id, user_id, deposito_garantia, centro, created_at, cliente_nombre_historico, cliente_empresa_historico")
        .eq("centro", c)
        .eq("estatus", "pre_aprobado")
        .gt("deposito_garantia", 0),
    ]);
    // Si todavía no se corre migracion_deposito_cuenta.sql, la lista se sigue viendo (sin la cuenta).
    const pgs = (
      errCuenta && /cuenta_destino/.test(errCuenta.message)
        ? (await leerDepositos("id, user_id, monto, contrato_id, centro, estado, created_at, comprobante_url")).data
        : pgsConCuenta
    ) as unknown as Omit<Deposito, "esPagoReal">[] | null;

    const userIds = Array.from(
      new Set([...(pgs || []).map((p) => p.user_id), ...(contratosConDeposito || []).map((c) => c.user_id)].filter(
        (id): id is string => !!id
      ))
    );
    const nombrePorId: Record<string, string> = {};
    const empresaPorId: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: clis } = await supabase.from("profiles").select("id, nombre, empresa").in("id", userIds);
      (clis || []).forEach((cl) => {
        nombrePorId[cl.id] = cl.nombre;
        empresaPorId[cl.id] = cl.empresa;
      });
    }

    const contratoIdsConPago = new Set((pgs || []).map((p) => p.contrato_id).filter(Boolean));

    const reales: Deposito[] = (pgs || []).map((p) => ({
      ...p,
      cliente_nombre: p.user_id ? nombrePorId[p.user_id] : undefined,
      cliente_empresa: p.user_id ? empresaPorId[p.user_id] : undefined,
      esPagoReal: true,
    }));

    const pendientesSinAprobar: Deposito[] = (contratosConDeposito || [])
      // Si por algún motivo ya existe su pago real, no se duplica aquí.
      .filter((ct) => !contratoIdsConPago.has(ct.id))
      .map((ct) => ({
        id: ct.id,
        user_id: ct.user_id,
        monto: Number(ct.deposito_garantia) || 0,
        contrato_id: ct.id,
        centro: ct.centro,
        estado: "pendiente",
        created_at: ct.created_at,
        cliente_nombre: (ct.user_id ? nombrePorId[ct.user_id] : ct.cliente_nombre_historico) || undefined,
        cliente_empresa: (ct.user_id ? empresaPorId[ct.user_id] : ct.cliente_empresa_historico) || undefined,
        esPagoReal: false,
      }));

    setDepositos(
      [...reales, ...pendientesSinAprobar].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    );
    setLoading(false);
  }

  function abrirSubidaComprobante(id: string) {
    setErrorComprobante("");
    setArchivosComprobante([]);
    setCuentaElegida("");
    setSubiendoParaId(id);
  }

  async function confirmarConComprobante(id: string) {
    setErrorComprobante("");
    const archivoComprobante = archivosComprobante[0];
    if (!cuentaElegida) {
      setErrorComprobante("Elige a qué cuenta cayó el depósito");
      return;
    }
    if (!archivoComprobante) {
      setErrorComprobante("Adjunta el comprobante antes de confirmar");
      return;
    }
    setProcesando(id);

    const ext = archivoComprobante.name.split(".").pop() || "jpg";
    const fileName = `deposito-garantia/${id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivoComprobante, { contentType: archivoComprobante.type, upsert: true });
    if (uploadError) {
      setErrorComprobante("No se pudo subir el comprobante: " + uploadError.message);
      setProcesando(null);
      return;
    }
    const comprobanteUrl = supabase.storage.from("comprobantes").getPublicUrl(fileName).data.publicUrl;

    const res = await fetch("/api/pagos/marcar-pagado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoId: id, comprobanteUrl, cuentaDestino: cuentaElegida }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErrorComprobante(d.error || "No se pudo marcar como realizado");
      setProcesando(null);
      return;
    }

    setProcesando(null);
    setSubiendoParaId(null);
    setArchivosComprobante([]);
    if (centro) fetchDepositos(centro);
  }

  async function cambiarCuenta(id: string, cuentaDestino: string) {
    setProcesando(id);
    const res = await fetch("/api/pagos/cuenta-destino", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoId: id, cuentaDestino }),
    });
    setProcesando(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "No se pudo cambiar la cuenta");
      return;
    }
    setCambiandoCuentaId(null);
    setDepositos((prev) => prev.map((d) => (d.id === id ? { ...d, cuenta_destino: cuentaDestino } : d)));
  }

  const depositosFiltrados = soloPendientes ? depositos.filter((d) => d.estado !== "pagado") : depositos;
  // Lo ya realizado del centro, por cuenta.
  const porCuenta = [...CUENTAS_DEPOSITO, "Sin cuenta registrada"].map((cuenta) => {
    const lista = depositos.filter(
      (d) => d.esPagoReal && d.estado === "pagado" && (d.cuenta_destino || "Sin cuenta registrada") === cuenta
    );
    return { cuenta, cuantos: lista.length, total: lista.reduce((t, d) => t + (Number(d.monto) || 0), 0) };
  });

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Depósito en garantía</p>
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
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 8px" }}>
              El depósito en garantía se genera como su propio pago (ya con IVA) al aprobar un contrato en
              Contratos. Márcalo como realizado aquí en cuanto el cliente lo entregue.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                🔒 Depósitos ({depositosFiltrados.length})
              </p>
              <button
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600 }}
                onClick={() => setSoloPendientes((v) => !v)}
              >
                {soloPendientes ? "Ver todos" : "Ver solo pendientes"}
              </button>
            </div>

            {porCuenta.some((c) => c.cuantos > 0) && (
              <div className="dep-cuentas">
                {porCuenta
                  .filter((c) => c.cuantos > 0)
                  .map((c) => (
                    <div key={c.cuenta} className="dep-cuenta">
                      <span>🏦 {c.cuenta}</span>
                      <strong>${c.total.toLocaleString("es-MX", { maximumFractionDigits: 2 })}</strong>
                      <small>
                        {c.cuantos} {c.cuantos === 1 ? "depósito realizado" : "depósitos realizados"}
                      </small>
                    </div>
                  ))}
              </div>
            )}

            {depositosFiltrados.length === 0 ? (
              <div className="empty-card">
                {soloPendientes ? "Sin depósitos pendientes en " + centro : "Sin depósitos registrados en " + centro}
              </div>
            ) : (
              depositosFiltrados.map((d) => {
                const badge = ESTATUS_LABEL[d.estado] || { label: d.estado || "—", bg: "#F0F0F0", color: "#555" };
                return (
                  <div className="contrato-card-admin" key={d.id}>
                    <div className="contrato-card-top">
                      <div>
                        <p className="contrato-cliente-nombre">
                          {d.cliente_nombre || "Cliente"} {d.cliente_empresa ? `· ${d.cliente_empresa}` : ""}
                        </p>
                        <p className="contrato-detalle">
                          ${Number(d.monto).toLocaleString("es-MX")} {d.esPagoReal ? "(incl. IVA)" : "(sin IVA todavía)"} ·{" "}
                          {new Date(d.created_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                      <span className="factura-badge" style={{ background: badge.bg }}>
                        <span className="factura-badge-text" style={{ color: badge.color }}>
                          {d.esPagoReal ? badge.label : "⏳ Contrato sin aprobar"}
                        </span>
                      </span>
                    </div>
                    {!d.esPagoReal ? (
                      <p style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
                        Este contrato todavía no se aprueba en Contratos — el depósito se podrá marcar como realizado en
                        cuanto se apruebe (ahí se calcula con IVA).
                      </p>
                    ) : d.estado === "pagado" ? (
                      <div className="dep-pagado">
                        {cambiandoCuentaId === d.id ? (
                          <div className="dep-cuenta-elegir">
                            <span className="dep-cuenta-pregunta">¿A qué cuenta cayó?</span>
                            {CUENTAS_DEPOSITO.map((c) => (
                              <button
                                key={c}
                                type="button"
                                className={"dep-cuenta-btn" + (d.cuenta_destino === c ? " activa" : "")}
                                onClick={() => cambiarCuenta(d.id, c)}
                                disabled={procesando === d.id}
                              >
                                {c}
                              </button>
                            ))}
                            <button type="button" className="tel-borrar-btn" onClick={() => setCambiandoCuentaId(null)}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <p className={"dep-cuenta-dato" + (d.cuenta_destino ? "" : " falta")}>
                            🏦 {d.cuenta_destino ? `Cayó en ${d.cuenta_destino}` : "Sin cuenta registrada"}
                            <button type="button" className="tel-borrar-btn" onClick={() => setCambiandoCuentaId(d.id)}>
                              {d.cuenta_destino ? "Cambiar" : "Registrar cuenta"}
                            </button>
                          </p>
                        )}
                        {d.comprobante_url && (
                          <button
                            type="button"
                            className="ver-pdf-btn"
                            onClick={() => abrirComprobante(d.id, d.comprobante_url!)}
                            disabled={abriendoComprobanteId === d.id}
                            style={{ display: "inline-block" }}
                          >
                            {abriendoComprobanteId === d.id ? "Abriendo…" : "👁️ Ver comprobante"}
                          </button>
                        )}
                      </div>
                    ) : subiendoParaId === d.id ? (
                      <div style={{ marginTop: 8 }}>
                        <p className="sub-label">¿A qué cuenta cayó el depósito?</p>
                        <div className="dep-cuenta-elegir" style={{ marginBottom: 10 }}>
                          {CUENTAS_DEPOSITO.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={"dep-cuenta-btn" + (cuentaElegida === c ? " activa" : "")}
                              onClick={() => {
                                setCuentaElegida(c);
                                setErrorComprobante("");
                              }}
                              aria-pressed={cuentaElegida === c}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                        <p className="sub-label">Adjunta el comprobante del depósito</p>
                        <FileDropzone
                          files={archivosComprobante}
                          onChange={setArchivosComprobante}
                          maxFiles={1}
                          accept="image/*,application/pdf"
                        />
                        {errorComprobante && <p style={{ color: "#A32D2D", fontSize: 13, margin: "4px 0 0" }}>{errorComprobante}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className="btn-aceptar" onClick={() => confirmarConComprobante(d.id)} disabled={procesando === d.id}>
                            {procesando === d.id ? "Subiendo…" : "✓ Confirmar realizado"}
                          </button>
                          <button
                            className="btn-rechazar"
                            onClick={() => {
                              setSubiendoParaId(null);
                              setArchivosComprobante([]);
                            }}
                            disabled={procesando === d.id}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn-aceptar" onClick={() => abrirSubidaComprobante(d.id)}>
                          ✓ Marcar como realizado
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
