"use client";

import { useState } from "react";
import { fechaLocal } from "@/lib/fechaMexico";
import { CENTROS_REPORTE } from "@/lib/centrosReporte";

// Resumen de gastos en recuadros (total, por pagar, pagado, por centro, en qué se gasta
// y por mes). Antes era la pestaña "Gastos" dentro de Cobranza; ahora vive arriba de la
// pantalla Gastos para los roles que ven todos los centros. Recibe los mismos gastos
// que ya carga la pantalla, así se actualiza al registrar o pagar uno.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type GastoResumen = {
  monto: number;
  fecha: string;
  tipo: string | null;
  centro: string | null;
  estado_pago?: string | null;
  categoria?: string | null;
  concepto?: string | null;
};

// "¿En qué se gasta?": se agrupa por la categoría que ponen al registrar o, si no la
// pusieron, por el concepto (ej. "Sillas"). Se juntan los que solo cambian en
// mayúsculas, acentos o espacios ("papeleria" y "Papelería" son lo mismo).
const MAX_RUBROS = 6;
const claveRubro = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const bonito = (t: string) => {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

function porRubro(gs: GastoResumen[]) {
  const grupos = new Map<string, { etiqueta: string; valor: number }>();
  for (const g of gs) {
    const texto = (g.categoria || "").trim() || (g.concepto || "").trim() || "Sin categoría";
    const k = claveRubro(texto);
    const actual = grupos.get(k) || { etiqueta: bonito(texto), valor: 0 };
    actual.valor += Number(g.monto);
    grupos.set(k, actual);
  }
  const lista = Array.from(grupos.values()).sort((a, b) => b.valor - a.valor);
  if (lista.length <= MAX_RUBROS) return lista;
  const otros = lista.slice(MAX_RUBROS - 1).reduce((s, r) => s + r.valor, 0);
  return [...lista.slice(0, MAX_RUBROS - 1), { etiqueta: "Otros", valor: otros }];
}

const pesos = (n: number) => `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
const suma = (gs: GastoResumen[]) => gs.reduce((s, g) => s + Number(g.monto), 0);

function Kpi({ valor, etiqueta, detalle, color }: { valor: string; etiqueta: string; detalle: string; color: string }) {
  return (
    <div className="rg-kpi">
      <p className="rg-kpi-valor" style={{ color }}>
        {valor}
      </p>
      <p className="rg-kpi-lbl">{etiqueta}</p>
      <p className="rg-kpi-det">{detalle}</p>
    </div>
  );
}

function Barras({
  titulo,
  datos,
  color,
  seleccionado,
  onElegir,
}: {
  titulo: string;
  datos: { etiqueta: string; valor: number }[];
  color: string;
  // Por centro: el centro elegido se resalta y tocar un renglón lo elige.
  seleccionado?: string;
  onElegir?: (etiqueta: string) => void;
}) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  return (
    <div className="rg-card">
      <p className="rg-card-titulo">{titulo}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {datos.map((d) => (
          <div
            key={d.etiqueta}
            onClick={onElegir ? () => onElegir(d.etiqueta) : undefined}
            style={{
              cursor: onElegir ? "pointer" : undefined,
              opacity: seleccionado && seleccionado !== d.etiqueta ? 0.45 : 1,
              fontWeight: seleccionado === d.etiqueta ? 700 : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span>{d.etiqueta}</span>
              <b>{pesos(d.valor)}</b>
            </div>
            <div style={{ background: "#f0f2f6", borderRadius: 6, height: 7, overflow: "hidden" }}>
              <div style={{ width: `${(d.valor / max) * 100}%`, background: color, height: "100%", borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResumenGastos({ gastos: todos }: { gastos: GastoResumen[] }) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  // "" = todos los centros. Con un centro elegido, todo el resumen es de ese centro.
  const [centroSel, setCentroSel] = useState("");
  const gastos = centroSel ? todos.filter((g) => (g.centro || "Sin centro") === centroSel) : todos;

  const estado = (g: GastoResumen) => g.estado_pago || "pendiente";
  const pendientes = gastos.filter((g) => estado(g) === "pendiente");
  const pagados = gastos.filter((g) => estado(g) === "pagado");
  const rechazados = gastos.filter((g) => estado(g) === "no_pagado");
  const cuenta = (n: number) => `${n} gasto${n === 1 ? "" : "s"}`;

  // Todos los centros, aunque todavía no tengan gastos (salen en $0).
  const centros = Array.from(new Set([...CENTROS_REPORTE, ...todos.map((g) => g.centro || "Sin centro")]));
  const porCentro = centros
    .map((c) => ({ etiqueta: c, valor: suma(todos.filter((g) => (g.centro || "Sin centro") === c)) }))
    .sort((a, b) => b.valor - a.valor);
  const rubros = porRubro(gastos);
  // Sistemas y Operaciones solo registran gastos en Bosques: el recuadro por área sale
  // en el resumen de todos los centros y en el de Bosques, no en los demás.
  const verArea = !centroSel || centroSel === "Bosques";
  const porArea = ["admin", "sistemas", "operaciones"].map((t) => ({
    etiqueta: t === "sistemas" ? "Sistemas" : t === "operaciones" ? "Operaciones" : "Administración",
    valor: suma(gastos.filter((g) => (g.tipo || "admin") === t)),
  }));

  const anios = Array.from(new Set([...todos.map((g) => fechaLocal(g.fecha).getFullYear()), new Date().getFullYear()])).sort((a, b) => b - a);
  const porMes = MESES.map((m, i) => ({
    etiqueta: m,
    valor: suma(
      gastos.filter((g) => {
        const d = fechaLocal(g.fecha);
        return d.getFullYear() === anio && d.getMonth() === i;
      })
    ),
  }));
  const maxMes = Math.max(...porMes.map((m) => m.valor), 1);
  const totalAnio = porMes.reduce((s, m) => s + m.valor, 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="rg-centros">
        {["", ...centros].map((c) => (
          <button key={c || "todos"} type="button" className={"rg-centro" + (centroSel === c ? " activo" : "")} onClick={() => setCentroSel(c)}>
            {c || "Todos los centros"}
          </button>
        ))}
      </div>

      <div className="rg-kpis">
        <Kpi valor={pesos(suma(gastos))} etiqueta="Total de gastos" detalle={`${cuenta(gastos.length)} · ${centroSel || "todos los centros"}`} color="#0d1b3e" />
        <Kpi valor={pesos(suma(pendientes))} etiqueta="Por pagar" detalle={cuenta(pendientes.length)} color="#C98A00" />
        <Kpi valor={pesos(suma(pagados))} etiqueta="Pagado" detalle={cuenta(pagados.length)} color="#0F6E56" />
        <Kpi valor={pesos(suma(rechazados))} etiqueta="No se paga" detalle={cuenta(rechazados.length)} color="#A32D2D" />
      </div>

      <div className={"rg-fila" + (verArea ? " rg-fila-3" : "")}>
        <Barras
          titulo="Por centro"
          datos={porCentro}
          color="#F07E3A"
          seleccionado={centroSel}
          onElegir={(c) => setCentroSel(centroSel === c ? "" : c)}
        />
        {rubros.length > 0 ? (
          <Barras titulo={centroSel ? `¿En qué se gasta? · ${centroSel}` : "¿En qué se gasta?"} datos={rubros} color="#185FA5" />
        ) : (
          <div className="rg-card">
            <p className="rg-card-titulo">{centroSel ? `¿En qué se gasta? · ${centroSel}` : "¿En qué se gasta?"}</p>
            <p style={{ fontSize: 12, color: "#8a93a8", margin: 0 }}>Todavía no hay gastos{centroSel ? ` en ${centroSel}` : ""}.</p>
          </div>
        )}
        {verArea && <Barras titulo={centroSel ? `Por área · ${centroSel}` : "Por área"} datos={porArea} color="#0F6E56" />}
      </div>

      <div className="rg-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <p className="rg-card-titulo" style={{ margin: 0 }}>
            Por mes{centroSel ? ` · ${centroSel}` : ""} · {pesos(totalAnio)}
          </p>
          <select className="ticket-admin-select" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="rg-meses">
          {porMes.map((m) => (
            <div key={m.etiqueta} className="rg-mes" title={`${m.etiqueta}: ${pesos(m.valor)}`}>
              <span className="rg-mes-valor">{m.valor > 0 ? pesos(m.valor) : ""}</span>
              <div className="rg-mes-barra-wrap">
                <div className="rg-mes-barra" style={{ height: `${(m.valor / maxMes) * 100}%`, opacity: m.valor > 0 ? 1 : 0 }} />
              </div>
              <span className="rg-mes-lbl">{m.etiqueta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
