"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CENTROS, useCentroAdmin } from "@/lib/useCentroAdmin";
import { TIPOS_COBRO_ADICIONAL, tipoCobroAdicional } from "@/lib/adicionales";
import AvisoExito from "@/app/components/AvisoExito";

// Adicionales: cobros sueltos que el admin le pone a un cliente fuera de su
// contrato (una hora extra de sala de juntas, copias, frituras…). Cada uno es
// un pago pendiente que el cliente ve en su estado de cuenta y paga con
// tarjeta, o que el staff marca pagado aquí mismo si lo cobró en efectivo.
// Admin cobra solo a clientes de su centro; superadmin y gerente, de todos
// (con selector). Ver app/api/adicionales/route.ts y
// migracion_pagos_adicionales.sql.

type Cliente = {
  id: string;
  nombre: string | null;
  email: string | null;
  empresa: string | null;
  numero_oficina: string | null;
  tipo_oficina: string | null;
  numero_usuario: string | number | null;
  activo: boolean | null;
};

type Cobro = {
  id: string;
  user_id: string;
  monto: number;
  concepto: string | null;
  estado: string;
  adicional_tipo: string | null;
  created_at: string;
  cliente_nombre?: string;
};

const ESTADO_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", bg: "#FAEEDA", color: "#854F0B" },
  pendiente_spei: { label: "SPEI pendiente", bg: "#FAEEDA", color: "#854F0B" },
  en_revision: { label: "En revisión", bg: "#E8EEF9", color: "#254B8C" },
  pagado: { label: "Pagado", bg: "#E1F5EE", color: "#0F6E56" },
};

const fmtMoneda = (n: number) =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtFecha(f: string) {
  return new Date(f).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// "1,50" o "1.50" → 1.5; vacío o inválido → 0.
function aNumero(v: string) {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function etiquetaCliente(c: Cliente) {
  const oficina = c.numero_oficina ? `${c.tipo_oficina || "Oficina"} ${c.numero_oficina}` : "";
  return [c.nombre || c.email || "Cliente", c.empresa, oficina].filter(Boolean).join(" · ");
}

export default function AdicionalesPage() {
  const supabase = createClient();
  const { cargando, centro, setCentro, esGlobal, permitido } = useCentroAdmin(["gerente"], ["gerente"]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [cargandoDatos, setCargandoDatos] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [tipo, setTipo] = useState<string>("");
  const [concepto, setConcepto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ titulo: string; mensaje: string } | null>(null);

  const [marcando, setMarcando] = useState<Cobro | null>(null);
  const [borrando, setBorrando] = useState<Cobro | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorLista, setErrorLista] = useState("");

  useEffect(() => {
    if (centro && permitido) {
      setClienteSel(null);
      setBusqueda("");
      fetchDatos(centro);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, permitido]);

  async function fetchDatos(c: string) {
    setCargandoDatos(true);
    const [{ data: cls }, { data: pgs }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nombre, email, empresa, numero_oficina, tipo_oficina, numero_usuario, activo")
        .eq("rol", "cliente")
        .eq("centro", c)
        .order("nombre"),
      supabase
        .from("pagos")
        .select("id, user_id, monto, concepto, estado, adicional_tipo, created_at")
        .eq("centro", c)
        .not("adicional_tipo", "is", null)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    const lista = ((cls as Cliente[]) || []).filter((x) => x.activo !== false);
    setClientes(lista);

    // Clientes dados de baja que aún tienen cobros en la lista: se busca su nombre aparte.
    const conocidos = new Map(((cls as Cliente[]) || []).map((x) => [x.id, x]));
    const faltan = Array.from(new Set((pgs || []).map((p) => p.user_id).filter((id) => id && !conocidos.has(id))));
    if (faltan.length > 0) {
      const { data: extra } = await supabase.from("profiles").select("id, nombre, email").in("id", faltan);
      (extra || []).forEach((x: any) => conocidos.set(x.id, x));
    }
    setCobros(
      ((pgs as Cobro[]) || []).map((p) => {
        const cl = conocidos.get(p.user_id);
        return { ...p, cliente_nombre: cl?.nombre || cl?.email || "Cliente" };
      })
    );
    setCargandoDatos(false);
  }

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return clientes
      .filter((c) =>
        [c.nombre, c.empresa, c.email, c.numero_oficina, c.numero_usuario != null ? `N-${c.numero_usuario}` : ""]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [clientes, busqueda]);

  const total = Math.round(aNumero(cantidad) * aNumero(precio) * 100) / 100;
  const puedeCobrar = !!clienteSel && !!tipo && concepto.trim().length > 0 && aNumero(cantidad) > 0 && aNumero(precio) > 0;

  function elegirTipo(clave: string) {
    setTipo(clave);
    const t = tipoCobroAdicional(clave);
    // "Otro" deja el concepto como esté; los demás lo rellenan (se puede editar).
    if (t && t.concepto) setConcepto(t.concepto);
  }

  async function cobrar() {
    if (!clienteSel || !puedeCobrar) return;
    setError("");
    setGuardando(true);
    const res = await fetch("/api/adicionales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clienteId: clienteSel.id,
        tipo,
        concepto: concepto.trim(),
        cantidad: aNumero(cantidad),
        precioUnitario: aNumero(precio),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(data.error || "No se pudo generar el cobro");
      return;
    }
    setAviso({
      titulo: "¡Cobro agregado!",
      mensaje: `${fmtMoneda(data.pago.monto)} a ${clienteSel.nombre || "el cliente"}. Lo verá en su estado de cuenta.`,
    });
    setClienteSel(null);
    setBusqueda("");
    setTipo("");
    setConcepto("");
    setCantidad("1");
    setPrecio("");
    if (centro) await fetchDatos(centro);
  }

  async function marcarPagado(c: Cobro) {
    setProcesando(true);
    setErrorLista("");
    const res = await fetch("/api/pagos/marcar-pagado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoId: c.id }),
    });
    const data = await res.json().catch(() => ({}));
    setProcesando(false);
    setMarcando(null);
    if (!res.ok) {
      setErrorLista(data.error || "No se pudo marcar como pagado");
      return;
    }
    if (centro) await fetchDatos(centro);
  }

  async function eliminar(c: Cobro) {
    setProcesando(true);
    setErrorLista("");
    const res = await fetch("/api/adicionales", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoId: c.id }),
    });
    const data = await res.json().catch(() => ({}));
    setProcesando(false);
    setBorrando(null);
    if (!res.ok) {
      setErrorLista(data.error || "No se pudo eliminar el cobro");
      return;
    }
    if (centro) await fetchDatos(centro);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Adicionales</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && (
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
        ) : (
          <>
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 10px" }}>
              Cobra algo extra a un cliente: una hora de sala de juntas, copias, frituras… Se agrega a su estado de
              cuenta y lo puede pagar con tarjeta, o lo marcas pagado aquí si te lo pagó en efectivo.
            </p>

            <div className="form-card" style={{ marginBottom: 16 }}>
              <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e" }}>Nuevo cobro</p>

              <div>
                <p className="sub-label" style={{ marginBottom: 6 }}>Cliente</p>
                {clienteSel ? (
                  <div className="adicional-cliente-elegido">
                    <span>{etiquetaCliente(clienteSel)}</span>
                    <button type="button" className="tel-borrar-btn" onClick={() => setClienteSel(null)}>
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Buscar por nombre, empresa, oficina o N.º de usuario"
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                    />
                    {busqueda.trim() && (
                      <div className="adicional-resultados">
                        {cargandoDatos ? (
                          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando clientes…</p>
                        ) : coincidencias.length === 0 ? (
                          <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Ningún cliente coincide</p>
                        ) : (
                          coincidencias.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              className="adicional-resultado"
                              onClick={() => {
                                setClienteSel(c);
                                setBusqueda("");
                              }}
                            >
                              {etiquetaCliente(c)}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <p className="sub-label" style={{ marginBottom: 6 }}>¿Qué se cobra?</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {TIPOS_COBRO_ADICIONAL.map((t) => (
                    <button
                      type="button"
                      key={t.clave}
                      className={"filtro-chip" + (tipo === t.clave ? " active" : "")}
                      onClick={() => elegirTipo(t.clave)}
                    >
                      {t.etiqueta}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="sub-label" style={{ marginBottom: 6 }}>Concepto</p>
                <input
                  type="text"
                  placeholder="Ej. Copias a color"
                  maxLength={120}
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <p className="sub-label" style={{ marginBottom: 6 }}>Cantidad</p>
                  <input type="text" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <p className="sub-label" style={{ marginBottom: 6 }}>Precio c/u</p>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="$0.00"
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                  />
                </div>
              </div>

              <div className="adicional-total">
                <span>Total a cobrar</span>
                <strong>{fmtMoneda(total)}</strong>
              </div>

              {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

              <button type="button" className="btn-enviar" disabled={!puedeCobrar || guardando} onClick={cobrar}>
                {guardando ? "Guardando…" : "Cobrar al cliente"}
              </button>
            </div>

            <p className="sub-label" style={{ marginBottom: 8 }}>
              Cobros recientes {cobros.length > 0 ? `(${cobros.length})` : ""}
            </p>
            {errorLista && <p style={{ color: "#A32D2D", fontSize: 13, margin: "0 0 8px" }}>{errorLista}</p>}
            {cargandoDatos ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando…</p>
            ) : cobros.length === 0 ? (
              <div className="empty-card">Todavía no hay cobros adicionales en este centro</div>
            ) : (
              cobros.map((c) => {
                const badge = ESTADO_LABEL[c.estado] || { label: c.estado, bg: "#F0F0F0", color: "#555" };
                const pendiente = c.estado === "pendiente";
                return (
                  <div className="item-card expediente-archivo" key={c.id}>
                    <div className="item-card-info" style={{ minWidth: 0 }}>
                      <p className="item-card-titulo">{c.cliente_nombre}</p>
                      <p className="item-card-extra">{c.concepto}</p>
                      <p className="item-card-extra" style={{ color: "#aaa" }}>
                        {fmtMoneda(c.monto)} · {fmtFecha(c.created_at)}
                      </p>
                    </div>
                    <span className="adicional-badge" style={{ background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                    {pendiente && (
                      <div className="expediente-acciones" style={{ width: "100%" }}>
                        <button
                          type="button"
                          className="tel-borrar-btn"
                          style={{ color: "#0d1b3e", fontWeight: 600 }}
                          onClick={() => setMarcando(c)}
                        >
                          Marcar como pagado
                        </button>
                        <button type="button" className="tel-borrar-btn" onClick={() => setBorrando(c)}>
                          Eliminar
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

      {marcando && (
        <div className="modal-overlay" onClick={() => !procesando && setMarcando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Marcar como pagado</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿{marcando.cliente_nombre} ya pagó {fmtMoneda(marcando.monto)} por &quot;{marcando.concepto}&quot;?
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" disabled={procesando} onClick={() => setMarcando(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" disabled={procesando} onClick={() => marcarPagado(marcando)}>
                {procesando ? "Guardando…" : "Sí, ya pagó"}
              </button>
            </div>
          </div>
        </div>
      )}

      {borrando && (
        <div className="modal-overlay" onClick={() => !procesando && setBorrando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Eliminar cobro</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Eliminar &quot;{borrando.concepto}&quot; de {borrando.cliente_nombre}? Dejará de aparecer en su estado de cuenta.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" disabled={procesando} onClick={() => setBorrando(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" disabled={procesando} onClick={() => eliminar(borrando)}>
                {procesando ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && <AvisoExito titulo={aviso.titulo} mensaje={aviso.mensaje} onCerrar={() => setAviso(null)} />}
    </div>
  );
}
