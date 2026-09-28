"use client";

import { useState } from "react";

// Resumen de gastos con gráficas (total, por centro, por departamento y
// por mes). Antes era la pestaña "Gastos" dentro de Cobranza; ahora vive
// arriba de la pantalla Gastos para los roles que ven todos los centros.
// Recibe los mismos gastos que ya carga la pantalla, así se actualiza al
// registrar uno nuevo.

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type GastoResumen = { monto: number; fecha: string; tipo: string | null; centro: string | null };

function renderBarras(titulo: string, datos: { etiqueta: string; valor: number }[], color: string) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const total = datos.reduce((s, d) => s + d.valor, 0);
  return (
    <div className="rep-ocupacion-card" style={{ marginBottom: 12 }}>
      <div className="rep-ocupacion-header">
        <span className="rep-ocupacion-centro">{titulo}</span>
        <span className="rep-ocupacion-porcentaje">${total.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {datos.map((d) => (
          <div key={d.etiqueta}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span>{d.etiqueta}</span>
              <b>${d.valor.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</b>
            </div>
            <div style={{ background: "#f0f0f0", borderRadius: 6, height: 10, overflow: "hidden" }}>
              <div style={{ width: `${(d.valor / max) * 100}%`, background: color, height: "100%", borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResumenGastos({ gastos }: { gastos: GastoResumen[] }) {
  const [anio, setAnio] = useState(new Date().getFullYear());

  const centros = Array.from(new Set(gastos.map((g) => g.centro || "Sin centro"))).sort();
  const porCentro = centros.map((c) => ({
    etiqueta: c,
    valor: gastos.filter((g) => (g.centro || "Sin centro") === c).reduce((s, g) => s + Number(g.monto), 0),
  }));
  const porDepto = ["sistemas", "operaciones", "admin"].map((t) => ({
    etiqueta: t === "sistemas" ? "🖥️ Sistemas" : t === "operaciones" ? "🔧 Operaciones" : "🧑‍💼 Admin",
    valor: gastos.filter((g) => (g.tipo || "admin") === t).reduce((s, g) => s + Number(g.monto), 0),
  }));
  const total = gastos.reduce((s, g) => s + Number(g.monto), 0);
  const anios = Array.from(new Set([...gastos.map((g) => new Date(g.fecha).getFullYear()), new Date().getFullYear()])).sort(
    (a, b) => b - a
  );
  const porMes = MESES.map((m, i) => ({
    etiqueta: m,
    valor: gastos
      .filter((g) => {
        const d = new Date(g.fecha);
        return d.getFullYear() === anio && d.getMonth() === i;
      })
      .reduce((s, g) => s + Number(g.monto), 0),
  }));

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="gastos-total-card">
        <p className="gastos-total-monto">${total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</p>
        <p className="gastos-total-lbl">Total de gastos · todos los centros y departamentos</p>
      </div>

      {renderBarras("💸 Gastos por centro", porCentro, "#F07E3A")}
      {renderBarras("🏷️ Gastos por departamento", porDepto, "#185FA5")}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <select className="ticket-admin-select" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {renderBarras(`📅 Gastos por mes (${anio})`, porMes, "#0F6E56")}
    </div>
  );
}
