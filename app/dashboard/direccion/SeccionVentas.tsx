import type { DatosDireccion } from "../datosDireccion";
import { BarrasMeses, Delta, Kpi, ListaBarras, deCentro, enMes, etiquetaMes, fechaCorta, mesAnterior, pct, ultimosMeses } from "./util";

// Ventas: prospectos (app/prospectos), cotizaciones (cotizaciones_comerciales;
// "cerrada" = ya generó contrato), tours y el seguimiento de prospectos.

const ESTADOS: { clave: string; label: string; color: string }[] = [
  { clave: "nuevo", label: "Nuevo", color: "#185fa5" },
  { clave: "contactado", label: "Contactado", color: "#854f0b" },
  { clave: "en_seguimiento", label: "En seguimiento", color: "#f07e3a" },
  { clave: "convertido", label: "Convertido", color: "#0f6e56" },
  { clave: "perdido", label: "Perdido", color: "#a32d2d" },
];

const cuenta = (n: number) => String(n);

export function prospectosDelMes(datos: DatosDireccion, centro: string, mes: string) {
  return datos.prospectos.filter((p) => enMes(p.created_at, mes) && deCentro(p.centro, centro));
}

export function tasaConversion(datos: DatosDireccion, centro: string, mes: string) {
  // Sobre los prospectos de los últimos 6 meses: el embudo tarda en cerrarse.
  const seis = new Set(ultimosMeses(mes, 6));
  const base = datos.prospectos.filter((p) => seis.has(p.created_at.slice(0, 7)) && deCentro(p.centro, centro));
  return { base: base.length, convertidos: base.filter((p) => p.estado === "convertido").length };
}

export default function SeccionVentas({ datos, centro, mes }: { datos: DatosDireccion; centro: string; mes: string }) {
  const nuevos = prospectosDelMes(datos, centro, mes);
  const nuevosAnterior = prospectosDelMes(datos, centro, mesAnterior(mes));
  const conversion = tasaConversion(datos, centro, mes);
  const cotizaciones = datos.cotizaciones.filter((c) => enMes(c.created_at, mes) && deCentro(c.centro, centro));
  const cerradas = cotizaciones.filter((c) => c.contrato_id);
  const tours = datos.tours.filter((t) => enMes(t.fecha, mes) && deCentro(t.centro, centro));

  const meses = ultimosMeses(mes, 6);
  const nuevosPorMes = meses.map((m) => prospectosDelMes(datos, centro, m).length);
  const cotizPorMes = meses.map((m) => datos.cotizaciones.filter((c) => enMes(c.created_at, m) && deCentro(c.centro, centro)).length);

  const embudo = ESTADOS.map((e) => ({ etiqueta: e.label, valor: nuevos.filter((p) => p.estado === e.clave).length }));

  const medios = new Map<string, number>();
  nuevos.forEach((p) => medios.set(p.medio || "Sin medio", (medios.get(p.medio || "Sin medio") || 0) + 1));

  // Desempeño por persona en el mes
  const centroDeProspecto = new Map(datos.prospectos.map((p) => [p.id, p.centro]));
  type Fila = { prospectos: number; cotizaciones: number; hechas: number; atrasadas: number; convertidos: number };
  const porPersona = new Map<string, Fila>();
  const fila = (id: string | null) => {
    const k = id || "sin-registro";
    if (!porPersona.has(k)) porPersona.set(k, { prospectos: 0, cotizaciones: 0, hechas: 0, atrasadas: 0, convertidos: 0 });
    return porPersona.get(k) as Fila;
  };
  nuevos.forEach((p) => {
    fila(p.registrado_por).prospectos++;
    if (p.estado === "convertido") fila(p.registrado_por).convertidos++;
  });
  cotizaciones.forEach((c) => fila(c.created_by).cotizaciones++);
  datos.actividades
    .filter((a) => deCentro(centroDeProspecto.get(a.prospecto_id), centro))
    .forEach((a) => {
      if (a.completada && enMes(a.fecha, mes)) fila(a.creado_por).hechas++;
      if (!a.completada && a.fecha < datos.hoy) fila(a.creado_por).atrasadas++;
    });
  const personas = Array.from(porPersona.entries())
    .map(([id, f]) => ({ nombre: datos.personal[id] || "Sin registrar", ...f }))
    .filter((p) => p.prospectos || p.cotizaciones || p.hechas || p.atrasadas)
    .sort((a, b) => b.prospectos + b.cotizaciones - (a.prospectos + a.cotizaciones));

  const perdidos = datos.prospectos
    .filter((p) => p.estado === "perdido" && p.comentario_perdido && deCentro(p.centro, centro))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);

  return (
    <>
      <div className="dir-kpis">
        <Kpi
          valor={nuevos.length}
          etiqueta={`Prospectos nuevos en ${etiquetaMes(mes)}`}
          extra={<Delta actual={nuevos.length} anterior={nuevosAnterior.length} />}
        />
        <Kpi
          valor={conversion.base ? `${pct(conversion.convertidos, conversion.base)}%` : "—"}
          etiqueta="Conversión a cliente"
          color="#0f6e56"
          extra={<span className="dir-delta">{conversion.convertidos} de {conversion.base} prospectos (6 meses)</span>}
        />
        <Kpi valor={cotizaciones.length} etiqueta="Cotizaciones hechas" />
        <Kpi
          valor={cerradas.length}
          etiqueta="Cotizaciones cerradas"
          color="#0f6e56"
          extra={<span className="dir-delta">{pct(cerradas.length, cotizaciones.length)}% se volvieron contrato</span>}
        />
        <Kpi valor={tours.length} etiqueta="Tours agendados" />
      </div>

      <div className="dir-card">
        <p className="dir-card-titulo">Prospectos y cotizaciones · últimos 6 meses</p>
        <BarrasMeses
          meses={meses}
          formato={cuenta}
          series={[
            { nombre: "Prospectos nuevos", color: "#185fa5", valores: nuevosPorMes },
            { nombre: "Cotizaciones", color: "#0f6e56", valores: cotizPorMes },
          ]}
        />
      </div>

      <div className="dir-grid-2">
        <div className="dir-card">
          <p className="dir-card-titulo">¿Cómo van los prospectos de {etiquetaMes(mes)}?</p>
          <ListaBarras filas={embudo} formato={cuenta} color="#185fa5" vacio="Sin prospectos este mes" />
        </div>
        <div className="dir-card">
          <p className="dir-card-titulo">¿Por dónde llegan?</p>
          <ListaBarras
            filas={Array.from(medios.entries())
              .map(([etiqueta, valor]) => ({ etiqueta, valor }))
              .sort((a, b) => b.valor - a.valor)}
            formato={cuenta}
            color="#f07e3a"
            vacio="Sin prospectos este mes"
          />
        </div>
      </div>

      <div className="dir-card">
        <p className="dir-card-titulo">Desempeño por persona · {etiquetaMes(mes)}</p>
        {personas.length === 0 ? (
          <p className="dir-vacio">Sin actividad este mes</p>
        ) : (
          <div className="dir-tabla-envoltura dir-tabla-plana">
            <table className="dir-tabla">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th style={{ textAlign: "right" }}>Prospectos</th>
                  <th style={{ textAlign: "right" }}>Cotizaciones</th>
                  <th style={{ textAlign: "right" }}>Seguimientos hechos</th>
                  <th style={{ textAlign: "right" }}>Seguimientos atrasados</th>
                  <th style={{ textAlign: "right" }}>Convertidos</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((p) => (
                  <tr key={p.nombre}>
                    <td>
                      <strong>{p.nombre}</strong>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.prospectos}</td>
                    <td style={{ textAlign: "right" }}>{p.cotizaciones}</td>
                    <td style={{ textAlign: "right" }}>{p.hechas}</td>
                    <td style={{ textAlign: "right", color: p.atrasadas ? "#a32d2d" : undefined, fontWeight: p.atrasadas ? 700 : 400 }}>
                      {p.atrasadas}
                    </td>
                    <td style={{ textAlign: "right", color: "#0f6e56", fontWeight: 700 }}>{p.convertidos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dir-nota" style={{ marginTop: 8 }}>
          Seguimientos atrasados: actividades pendientes cuya fecha ya pasó, al día de hoy.
        </p>
      </div>

      <div className="dir-card">
        <p className="dir-card-titulo">¿Por qué se pierden? · últimos prospectos perdidos</p>
        {perdidos.length === 0 ? (
          <p className="dir-vacio">Sin prospectos perdidos con motivo</p>
        ) : (
          <div className="dir-perdidos">
            {perdidos.map((p) => (
              <div key={p.id} className="dir-perdido">
                <p>
                  <strong>{p.nombre}</strong>
                  <span>
                    {p.centro || "Sin centro"} · {fechaCorta(p.created_at)}
                  </span>
                </p>
                <p className="dir-perdido-motivo">“{p.comentario_perdido}”</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
