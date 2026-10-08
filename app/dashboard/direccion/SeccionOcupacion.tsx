"use client";

import { useState } from "react";
import type { DatosDireccion } from "../datosDireccion";
import { Kpi, fechaCorta, moneda } from "./util";

// Ocupación: mismo cálculo que el dashboard y Reportes (lib/ocupacion.ts).

const RANGOS = [
  { clave: "vencidos", label: "Ya vencidos", min: -Infinity, max: -1 },
  { clave: "30", label: "Próximos 30 días", min: 0, max: 30 },
  { clave: "60", label: "31 a 60 días", min: 31, max: 60 },
  { clave: "90", label: "61 a 90 días", min: 61, max: 90 },
] as const;

export function colorOcupacion(p: number) {
  if (p >= 85) return "#0f6e56";
  if (p >= 60) return "#f07e3a";
  return "#a32d2d";
}

export function resumenOcupacion(datos: DatosDireccion, centro: string) {
  const centros = centro === "todos" ? datos.centros : datos.centros.filter((c) => c.centro === centro);
  const contratos = centro === "todos" ? datos.contratos : datos.contratos.filter((c) => c.centro === centro);
  const total = centros.reduce((s, c) => s + c.total, 0);
  const ocupadas = centros.reduce((s, c) => s + c.ocupadas, 0);
  return { centros, contratos, total, ocupadas, porcentaje: total ? Math.round((ocupadas / total) * 100) : 0 };
}

export default function SeccionOcupacion({
  datos,
  centro,
  mostrarPrecios = false,
}: {
  datos: DatosDireccion;
  centro: string;
  // Captive: "Ver disponibles" con el precio de lista mensual de cada espacio.
  mostrarPrecios?: boolean;
}) {
  const [rango, setRango] = useState<(typeof RANGOS)[number]["clave"]>("30");
  const { centros, contratos, total, ocupadas, porcentaje } = resumenOcupacion(datos, centro);
  const proximos90 = contratos.filter((c) => c.dias >= 0);
  const rentaEnRiesgo = contratos.reduce((s, c) => s + c.rentaMensual, 0);
  const rangoSel = RANGOS.find((r) => r.clave === rango) || RANGOS[1];
  const listaRango = contratos.filter((c) => c.dias >= rangoSel.min && c.dias <= rangoSel.max);
  const cuantos = (r: (typeof RANGOS)[number]) => contratos.filter((c) => c.dias >= r.min && c.dias <= r.max).length;

  return (
    <>
      <div className="dir-kpis">
        <Kpi valor={`${porcentaje}%`} etiqueta="Ocupación" color={colorOcupacion(porcentaje)} />
        <Kpi
          valor={
            <>
              {ocupadas}
              <span className="dir-kpi-de"> / {total}</span>
            </>
          }
          etiqueta="Espacios ocupados"
        />
        <Kpi valor={total - ocupadas} etiqueta="Disponibles" />
        <Kpi valor={proximos90.length} etiqueta="Contratos vencen en 90 días" />
        <Kpi valor={moneda(rentaEnRiesgo)} etiqueta="Renta mensual por renovar" />
      </div>
      <p className="dir-nota">
        El coworking de cada centro cuenta como un solo espacio, igual que en Reportes. &quot;Renta mensual por renovar&quot; suma los
        contratos vencidos y los que vencen en los próximos 90 días.
      </p>

      <div className="dir-centros">
        {centros.map((c) => (
          <div className="dir-centro" key={c.centro}>
            <div className="dir-centro-cabeza">
              <p className="dir-centro-nombre">{c.centro}</p>
              <p className="dir-centro-pct" style={{ color: colorOcupacion(c.porcentaje) }}>
                {c.porcentaje}%
              </p>
            </div>
            <div className="dir-barra-ocupacion" aria-hidden="true">
              <div style={{ width: `${c.porcentaje}%`, background: colorOcupacion(c.porcentaje) }} />
            </div>
            <p className="dir-centro-sub">
              {c.ocupadas} de {c.total} ocupados · {c.disponibles} disponibles
            </p>
            <div className="dir-tipos">
              {c.porTipo.map((t) => (
                <div className="dir-tipo" key={t.tipo}>
                  <span>{t.tipo}</span>
                  <strong>{t.tipo === "Coworking" ? (t.ocupadas ? "Con clientes" : "Sin clientes") : `${t.ocupadas}/${t.total}`}</strong>
                </div>
              ))}
            </div>
            {c.disponiblesLista.length > 0 && (
              <details className="dir-disponibles">
                <summary>
                  {mostrarPrecios ? "Ver disponibles y precios" : "Ver disponibles"} ({c.disponiblesLista.length})
                </summary>
                {mostrarPrecios ? (
                  <div className="dir-precios">
                    {c.disponiblesLista.map((o) => (
                      <div className="dir-precio" key={`${o.tipo}-${o.numero}`}>
                        <span>{`${o.tipo} ${o.numero}`.trim()}</span>
                        <strong>{o.precioMes ? `${moneda(o.precioMes)}/mes` : "Sin precio"}</strong>
                      </div>
                    ))}
                    <p className="dir-nota">Precio de lista mensual, el mismo con que se cotiza.</p>
                  </div>
                ) : (
                  <p>{c.disponiblesLista.map((o) => `${o.tipo} ${o.numero}`.trim()).join(" · ")}</p>
                )}
              </details>
            )}
          </div>
        ))}
        {centros.length === 0 && <div className="empty-card">Sin espacios registrados</div>}
      </div>

      <p className="dir-subtitulo">📅 Contratos por vencer</p>
      <div className="dir-rangos">
        {RANGOS.map((r) => (
          <button
            key={r.clave}
            type="button"
            className={`dir-rango${rango === r.clave ? " dir-rango-on" : ""}${r.clave === "vencidos" ? " dir-rango-alerta" : ""}`}
            onClick={() => setRango(r.clave)}
          >
            {r.label} ({cuantos(r)})
          </button>
        ))}
      </div>
      {listaRango.length === 0 ? (
        <div className="empty-card">Ningún contrato en este rango</div>
      ) : (
        <div className="dir-tabla-envoltura">
          <table className="dir-tabla">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Centro</th>
                <th>Espacio</th>
                <th>Vence</th>
                <th style={{ textAlign: "right" }}>Renta mensual</th>
              </tr>
            </thead>
            <tbody>
              {listaRango.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.cliente}</strong>
                    {c.empresa && <span className="dir-tabla-sub">{c.empresa}</span>}
                  </td>
                  <td>{c.centro}</td>
                  <td>{c.espacio}</td>
                  <td>
                    {fechaCorta(c.fechaVencimiento)}
                    <span className={`dir-tabla-sub${c.dias < 0 ? " dir-vencido" : ""}`}>
                      {c.dias < 0 ? `Venció hace ${-c.dias} días` : c.dias === 0 ? "Vence hoy" : `En ${c.dias} días`}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{c.rentaMensual ? moneda(c.rentaMensual) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
