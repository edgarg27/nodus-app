"use client";

import { useMemo, useState } from "react";
import { exportarExcelHojas } from "@/lib/exportExcel";
import { useDatosReporte, useFiltrosReporte } from "./FiltrosReporte";
import type { EventoSeguimiento, PersonaSeguimiento } from "@/app/api/reportes/seguimiento-equipo/route";

type Datos = { personas: PersonaSeguimiento[]; eventos: EventoSeguimiento[] };

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// "hace 3 días", "hoy", "ayer" (para la última actualización de cada persona).
function hace(iso: string | null) {
  if (!iso) return "Nunca";
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  return `Hace ${dias} días`;
}

const COLOR_ESTADO: Record<EventoSeguimiento["estado"], string> = { Hecha: "#0f6e56", Pendiente: "#185fa5", Atrasada: "#a32d2d" };

// "Seguimiento de prospectos del equipo" (/reportes): cómo van actualizando el seguimiento las administradoras
// (y quien registre prospectos), y lo último que registró cada una. Datos de /api/reportes/seguimiento-equipo.
export default function SeguimientoEquipo({ esGlobal, centroFijo }: { esGlobal: boolean; centroFijo?: string | null }) {
  const f = useFiltrosReporte(esGlobal, centroFijo);
  const { datos, cargando, error } = useDatosReporte<Datos>("/api/reportes/seguimiento-equipo", f.params());
  // Clic en una persona: la lista muestra solo lo suyo.
  const [personaId, setPersonaId] = useState("");
  const personas = datos?.personas || [];
  const eventos = useMemo(
    () => (datos?.eventos || []).filter((e) => !personaId || e.personaId === personaId),
    [datos, personaId]
  );
  const nombrePersona = personas.find((p) => p.id === personaId)?.nombre;

  function exportar() {
    exportarExcelHojas(`seguimiento-equipo-${f.centro || "todos"}-${f.desde}-a-${f.hasta}`.replace(/\s+/g, "_"), {
      "Por persona": personas.map((p) => ({
        Persona: p.nombre,
        Centro: p.centro || "",
        "Prospectos registrados": p.prospectosRegistrados,
        "Actividades registradas": p.actividadesRegistradas,
        "Actividades hechas": p.hechas,
        "Atrasadas hoy": p.atrasadas,
        "Prospectos sin contactar": p.sinContactar,
        "Última actualización": p.ultimaActualizacion ? fechaHora(p.ultimaActualizacion) : "",
      })),
      Movimientos: (datos?.eventos || []).map((e) => ({
        Cuándo: fechaHora(e.cuando),
        Quién: e.persona,
        Qué: `${e.evento} ${e.tipo.toLowerCase()}`,
        Prospecto: e.prospecto,
        Empresa: e.empresa || "",
        Centro: e.centro || "",
        Nota: e.descripcion || "",
        "Fecha programada": e.fechaProgramada,
        Estado: e.estado,
      })),
    });
  }

  return (
    <div className="pm-card">
      <div className="pm-cab">
        <div>
          <p className="pm-titulo">Seguimiento de prospectos del equipo</p>
          <p className="pm-sub">
            {f.textoPeriodo}
            {f.centro ? ` · ${f.centro}` : esGlobal ? " · Todos los centros" : ""}
          </p>
        </div>
        <button type="button" className="btn-exportar" onClick={exportar} disabled={personas.length === 0}>
          📥 Excel
        </button>
      </div>
      {f.filtros()}
      {error ? (
        <p className="pm-vacio" style={{ color: "#a32d2d" }}>
          {error}
        </p>
      ) : cargando ? (
        <p className="pm-vacio">Cargando…</p>
      ) : personas.length === 0 ? (
        <p className="pm-vacio">Sin movimientos de seguimiento en este periodo</p>
      ) : (
        <>
          <div className="pm-tabla-wrap">
            <table className="pm-tabla">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th className="pm-num">Prospectos registrados</th>
                  <th className="pm-num">Actividades registradas</th>
                  <th className="pm-num">Hechas</th>
                  <th className="pm-num">Atrasadas hoy</th>
                  <th className="pm-num">Sin contactar</th>
                  <th>Última actualización</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((p) => (
                  <tr
                    key={p.id}
                    className={"pm-fila" + (personaId === p.id ? " activa" : "")}
                    onClick={() => setPersonaId(personaId === p.id ? "" : p.id)}
                    title="Ver lo que registró esta persona"
                  >
                    <td>
                      <strong>{p.nombre}</strong>
                      {p.centro && <div className="pm-mini">{p.centro}</div>}
                    </td>
                    <td className="pm-num">{p.prospectosRegistrados}</td>
                    <td className="pm-num">{p.actividadesRegistradas}</td>
                    <td className="pm-num" style={{ color: "#0f6e56", fontWeight: 700 }}>
                      {p.hechas}
                    </td>
                    <td className="pm-num" style={{ color: p.atrasadas ? "#a32d2d" : undefined, fontWeight: p.atrasadas ? 700 : 400 }}>
                      {p.atrasadas}
                    </td>
                    <td className="pm-num" style={{ color: p.sinContactar ? "#a3701f" : undefined, fontWeight: p.sinContactar ? 700 : 400 }}>
                      {p.sinContactar}
                    </td>
                    <td className="pm-nowrap">
                      {hace(p.ultimaActualizacion)}
                      {p.ultimaActualizacion && <div className="pm-mini">{fechaHora(p.ultimaActualizacion)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pm-ventas-cab">
            <p className="pm-titulo" style={{ fontSize: 14 }}>
              Últimos movimientos ({eventos.length})
            </p>
            {nombrePersona && (
              <button type="button" className="tel-borrar-btn" onClick={() => setPersonaId("")}>
                Solo {nombrePersona} · ver todos
              </button>
            )}
          </div>
          {eventos.length === 0 ? (
            <p className="pm-vacio">Sin movimientos en este periodo</p>
          ) : (
            <div className="pm-tabla-wrap">
              <table className="pm-tabla">
                <thead>
                  <tr>
                    <th>Cuándo</th>
                    <th>Quién</th>
                    <th>Qué</th>
                    <th>Prospecto</th>
                    <th>Nota</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((e) => (
                    <tr key={e.id}>
                      <td className="pm-nowrap">{fechaHora(e.cuando)}</td>
                      <td>{e.persona}</td>
                      <td className="pm-nowrap">
                        {e.evento} {e.tipo.toLowerCase()}
                        <div className="pm-mini">Para el {e.fechaProgramada}</div>
                      </td>
                      <td>
                        <strong>{e.prospecto}</strong>
                        {(e.empresa || (esGlobal && !f.centro && e.centro)) && (
                          <div className="pm-mini">{[e.empresa, esGlobal && !f.centro ? e.centro : null].filter(Boolean).join(" · ")}</div>
                        )}
                      </td>
                      <td>{e.descripcion || <span className="pm-mini">Sin nota</span>}</td>
                      <td className="pm-nowrap" style={{ color: COLOR_ESTADO[e.estado], fontWeight: 600 }}>
                        {e.estado}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="pm-nota">
        Registradas: actividades que la persona agregó en el periodo. Hechas: las que palomeó en el periodo. Atrasadas:
        pendientes suyas cuya fecha ya pasó. Sin contactar: prospectos que registró, siguen en &quot;Nuevo&quot; y no tienen
        ninguna actividad. Da clic en una persona para ver solo lo suyo.
      </p>
    </div>
  );
}
