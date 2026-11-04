"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CENTROS, useCentroAdmin } from "@/lib/useCentroAdmin";
import { esEspacioCowork, fmtHoras, horasPlaneadas, saldoHoras, ventanaHoras, type SaldoHoras, type VentanaHoras } from "@/lib/horasCowork";

// Horas Cowork (p. ej. el paquete de 30 horas): quién tiene horas, cuántas lleva usadas y el calendario de la semana
// para confirmar, registrar llegadas (las horas pasan de apartadas a consumidas) y marcar quien no llegó. Mismas reglas
// que el Panel de Centro y que lo que ve el cliente en Reservar espacio (lib/horasCowork.ts). Las Horas Cowork se
// pueden usar en cualquier centro: el calendario muestra también a clientes de otros centros que reservaron aquí
// (migracion_cowork_otros_centros.sql deja ver su nombre).

type Reserva = {
  id: string;
  user_id: string | null;
  contrato_id: string | null;
  espacio: string;
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  estado: string;
  asistencia: string | null;
  horas_cobradas: number | null;
};
type FilaCliente = { contratoId: string; userId: string; nombre: string; paquete: string; ventana: VentanaHoras; saldo: SaldoHoras };

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function lunesDe(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export default function HorasCoworkPage() {
  const supabase = createClient();
  const { cargando, centro, setCentro, esGlobal, permitido } = useCentroAdmin(["gerente"], ["gerente"]);
  const [lunes, setLunes] = useState(() => lunesDe(new Date()));
  const [clientes, setClientes] = useState<FilaCliente[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargandoDatos, setCargandoDatos] = useState(false);
  const [error, setError] = useState("");
  const [llegada, setLlegada] = useState<{ reserva: Reserva; horas: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i)), [lunes]);

  async function cargar(c: string) {
    setCargandoDatos(true);
    setError("");
    const { data: contratos, error: errC } = await supabase
      .from("contratos")
      .select("id, user_id, horas_bolsa, fecha_inicio, fecha_vencimiento, paquete_id")
      .eq("centro", c)
      .eq("estatus", "vigente")
      .gt("horas_bolsa", 0)
      .not("user_id", "is", null);
    if (errC) {
      setError("No se pudieron cargar los contratos: " + errC.message);
      setCargandoDatos(false);
      return;
    }
    const ids = (contratos || []).map((x) => x.id);
    const desde = iso(dias[0]);
    const hasta = iso(dias[6]);
    const [{ data: delContrato }, { data: semana }, { data: paquetes }] = await Promise.all([
      ids.length
        ? supabase.from("reservaciones").select("id, user_id, contrato_id, espacio, fecha, hora_inicio, hora_fin, estado, asistencia, horas_cobradas").in("contrato_id", ids)
        : Promise.resolve({ data: [] as Reserva[] }),
      supabase
        .from("reservaciones")
        .select("id, user_id, contrato_id, espacio, fecha, hora_inicio, hora_fin, estado, asistencia, horas_cobradas")
        .eq("centro", c)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha")
        .order("hora_inicio"),
      supabase.from("paquetes").select("id, nombre").eq("centro", c),
    ]);
    const deLaSemana = ((semana || []) as Reserva[]).filter((r) => esEspacioCowork(r.espacio));
    const userIds = Array.from(new Set([...(contratos || []).map((x) => x.user_id), ...deLaSemana.map((r) => r.user_id)].filter(Boolean))) as string[];
    const { data: perfiles } = userIds.length ? await supabase.from("profiles").select("id, nombre, empresa, nombre_fiscal").in("id", userIds) : { data: [] as any[] };
    const mapaNombres: Record<string, string> = {};
    for (const p of perfiles || []) mapaNombres[p.id] = p.nombre_fiscal || p.empresa || p.nombre || "Cliente";

    const filas: FilaCliente[] = (contratos || []).map((ct) => {
      const ventana = ventanaHoras(ct);
      const usadas = ((delContrato || []) as Reserva[]).filter((r) => r.contrato_id === ct.id && esEspacioCowork(r.espacio) && r.fecha >= ventana.desde && r.fecha <= ventana.hasta);
      return {
        contratoId: ct.id,
        userId: ct.user_id as string,
        nombre: mapaNombres[ct.user_id as string] || "Cliente",
        paquete: (paquetes || []).find((p) => p.id === ct.paquete_id)?.nombre || "",
        ventana,
        saldo: saldoHoras(Number(ct.horas_bolsa) || 0, usadas),
      };
    });
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    setNombres(mapaNombres);
    setClientes(filas);
    setReservas(deLaSemana);
    setCargandoDatos(false);
  }

  useEffect(() => {
    if (centro && permitido) cargar(centro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro, permitido, lunes]);

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    setGuardando(true);
    const { error: e } = await supabase.from("reservaciones").update(cambios).eq("id", id);
    setGuardando(false);
    if (e) return setError("No se pudo guardar: " + e.message);
    setLlegada(null);
    if (centro) cargar(centro);
  }

  function estadoDe(r: Reserva) {
    if (r.estado === "cancelada") return { texto: r.horas_cobradas ? "Cancelada tarde (se cobra)" : "Cancelada", color: "#888" };
    if (r.estado === "rechazada") return { texto: "Rechazada", color: "#888" };
    if (r.asistencia === "llego") return { texto: `Llegó · ${fmtHoras(Number(r.horas_cobradas) || 0)} h consumidas`, color: "#0F6E56" };
    if (r.asistencia === "no_llego") return { texto: "No llegó (se cobra)", color: "#A32D2D" };
    return { texto: r.estado === "pendiente" ? "Por confirmar · horas apartadas" : "Confirmada · horas apartadas", color: "#854F0B" };
  }

  const hoyISO = iso(new Date());

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Horas Cowork</p>
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
        ) : (
          <>
            <p style={{ fontSize: 12, color: "#888", margin: "0 0 10px" }}>
              Clientes con Horas Cowork (p. ej. el paquete de 30 horas). Al reservar, sus horas quedan apartadas; al registrar su llegada pasan a consumidas.
              Si cancela con 2 horas o más de anticipación se le devuelven.
            </p>
            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <p className="panel-section-label">Clientes con horas ({clientes.length})</p>
            {cargandoDatos ? (
              <p style={{ color: "#888", fontSize: 13 }}>Cargando…</p>
            ) : clientes.length === 0 ? (
              <div className="empty-card">Ningún contrato vigente con Horas Cowork en {centro}</div>
            ) : (
              <div className="cliente-list">
                {clientes.map((f) => (
                  <div key={f.contratoId} className="form-card" style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, color: "#0d1b3e" }}>{f.nombre}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                          {f.paquete ? f.paquete + " · " : ""}
                          {f.ventana.porVigencia ? `Vigencia del ${f.ventana.desde} al ${f.ventana.hasta}` : `Este mes (${f.ventana.desde} al ${f.ventana.hasta})`}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 18, color: "#0d1b3e" }}>
                          {fmtHoras(f.saldo.disponibles)} <span style={{ fontSize: 12, fontWeight: 400, color: "#888" }}>de {fmtHoras(f.saldo.totales)} h disponibles</span>
                        </p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                          Consumidas {fmtHoras(f.saldo.consumidas)} · Apartadas {fmtHoras(f.saldo.apartadas)}
                        </p>
                      </div>
                    </div>
                    <div className="horas-banco-bar" style={{ marginTop: 8 }}>
                      <div
                        className="horas-banco-bar-fill"
                        style={{ width: `${f.saldo.totales ? Math.min(((f.saldo.consumidas + f.saldo.apartadas) / f.saldo.totales) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
              <button type="button" className="tel-borrar-btn" onClick={() => setLunes(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() - 7))}>
                ‹ Semana anterior
              </button>
              <p className="panel-section-label" style={{ margin: 0 }}>
                {dias[0].getDate()}/{dias[0].getMonth() + 1} – {dias[6].getDate()}/{dias[6].getMonth() + 1}
              </p>
              <button type="button" className="tel-borrar-btn" onClick={() => setLunes(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7))}>
                Semana siguiente ›
              </button>
            </div>

            {dias.map((d) => {
              const fecha = iso(d);
              const delDia = reservas.filter((r) => r.fecha === fecha);
              return (
                <div key={fecha} className="form-card" style={{ marginBottom: 8, borderLeft: fecha === hoyISO ? "4px solid #f07e3a" : undefined }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#0d1b3e" }}>
                    {DIAS[d.getDay()]} {d.getDate()}/{d.getMonth() + 1}
                    {fecha === hoyISO ? " · Hoy" : ""}
                  </p>
                  {delDia.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>Sin reservaciones de Horas Cowork</p>
                  ) : (
                    delDia.map((r) => {
                      const est = estadoDe(r);
                      const viva = r.estado === "pendiente" || r.estado === "confirmada";
                      const yaEmpezo = fecha < hoyISO || (fecha === hoyISO && (r.hora_inicio || "") <= `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`);
                      return (
                        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid #f0f0f0" }}>
                          <span style={{ fontSize: 13 }}>
                            <b>
                              {(r.hora_inicio || "").slice(0, 5)}–{(r.hora_fin || "").slice(0, 5)}
                            </b>{" "}
                            · {(r.user_id && nombres[r.user_id]) || "Cliente"} · {fmtHoras(horasPlaneadas(r))} h
                            <span style={{ display: "block", fontSize: 12, color: est.color }}>{est.texto}</span>
                          </span>
                          {viva && !r.asistencia && (
                            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              {r.estado === "pendiente" && (
                                <button type="button" className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} disabled={guardando} onClick={() => actualizar(r.id, { estado: "confirmada" })}>
                                  Confirmar
                                </button>
                              )}
                              {yaEmpezo && (
                                <>
                                  <button
                                    type="button"
                                    className="tel-borrar-btn"
                                    style={{ color: "#0F6E56", fontWeight: 600 }}
                                    disabled={guardando}
                                    onClick={() => setLlegada({ reserva: r, horas: fmtHoras(horasPlaneadas(r)) })}
                                  >
                                    Registrar llegada
                                  </button>
                                  <button
                                    type="button"
                                    className="tel-borrar-btn"
                                    style={{ color: "#A32D2D" }}
                                    disabled={guardando}
                                    onClick={() => {
                                      if (confirm(`¿Marcar que no llegó? Sus ${fmtHoras(horasPlaneadas(r))} hora(s) quedan cobradas.`)) {
                                        actualizar(r.id, { asistencia: "no_llego", horas_cobradas: horasPlaneadas(r) });
                                      }
                                    }}
                                  >
                                    No llegó
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {llegada && (
        <div className="modal-overlay" onClick={() => !guardando && setLlegada(null)}>
          <div className="form-card" style={{ maxWidth: 380, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p className="contrato-cliente-nombre">Registrar llegada</p>
            <p style={{ fontSize: 13, color: "#555", margin: "4px 0 10px" }}>
              {(llegada.reserva.user_id && nombres[llegada.reserva.user_id]) || "Cliente"} · {llegada.reserva.fecha} ·{" "}
              {(llegada.reserva.hora_inicio || "").slice(0, 5)}–{(llegada.reserva.hora_fin || "").slice(0, 5)}
            </p>
            <p className="sub-label">Horas que usó (se descuentan de su paquete)</p>
            <input type="number" min="0" step="0.5" value={llegada.horas} onChange={(e) => setLlegada({ ...llegada, horas: e.target.value })} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn-enviar"
                style={{ flex: 1 }}
                disabled={guardando || !(Number(llegada.horas) >= 0)}
                onClick={() => actualizar(llegada.reserva.id, { asistencia: "llego", horas_cobradas: Number(llegada.horas), llegada_at: new Date().toISOString() })}
              >
                <span className="btn-enviar-text">{guardando ? "Guardando…" : "Registrar"}</span>
              </button>
              <button type="button" className="tel-borrar-btn" disabled={guardando} onClick={() => setLlegada(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
