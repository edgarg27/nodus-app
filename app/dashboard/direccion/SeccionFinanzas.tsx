import { CATEGORIA_PAGO_INFO, categorizarPago, pagoEstaCubierto } from "@/lib/pagosCategoria";
import type { DatosDireccion } from "../datosDireccion";
import { BarrasMeses, Delta, Kpi, ListaBarras, deCentro, enMes, mesAnterior, moneda, pct, ultimosMeses } from "./util";

// Ingresos = dinero que efectivamente entró (pagos pagados, por fecha de pago),
// igual que Ingresos por Centro; gastos = tabla gastos por fecha.
export function totalesMes(datos: DatosDireccion, centro: string, mes: string) {
  const ingresos = datos.pagos
    .filter((p) => pagoEstaCubierto(p.estado) && enMes(p.fecha_pago, mes) && deCentro(p.centro, centro))
    .reduce((s, p) => s + p.monto, 0);
  const gastos = datos.gastos
    .filter((g) => enMes(g.fecha, mes) && deCentro(g.centro, centro))
    .reduce((s, g) => s + g.monto, 0);
  return { ingresos, gastos, utilidad: ingresos - gastos };
}

export function ingresoRecurrente(datos: DatosDireccion, centro: string) {
  return datos.todosContratos
    .filter((c) => c.estatus === "vigente" && c.user_id && deCentro(c.centro, centro))
    .reduce((s, c) => s + (Number(c.renta_mensual) || 0), 0);
}

export default function SeccionFinanzas({ datos, centro, mes }: { datos: DatosDireccion; centro: string; mes: string }) {
  const actual = totalesMes(datos, centro, mes);
  const anterior = totalesMes(datos, centro, mesAnterior(mes));
  const margen = pct(actual.utilidad, actual.ingresos);
  const recurrente = ingresoRecurrente(datos, centro);

  const meses = ultimosMeses(mes, 6);
  const porMes = meses.map((m) => totalesMes(datos, centro, m));

  const ingresosPorCategoria = new Map<string, number>();
  datos.pagos
    .filter((p) => pagoEstaCubierto(p.estado) && enMes(p.fecha_pago, mes) && deCentro(p.centro, centro))
    .forEach((p) => {
      const cat = CATEGORIA_PAGO_INFO[categorizarPago(p.concepto)].label;
      ingresosPorCategoria.set(cat, (ingresosPorCategoria.get(cat) || 0) + p.monto);
    });

  const gastosPorCategoria = new Map<string, number>();
  datos.gastos
    .filter((g) => enMes(g.fecha, mes) && deCentro(g.centro, centro))
    .forEach((g) => {
      const cat = (g.categoria || "Sin categoría").trim();
      gastosPorCategoria.set(cat, (gastosPorCategoria.get(cat) || 0) + g.monto);
    });

  const nombresCentros = Array.from(
    new Set([...datos.pagos.map((p) => p.centro), ...datos.gastos.map((g) => g.centro)].map((c) => c || "Sin centro"))
  )
    .filter((c) => centro === "todos" || c === centro)
    .sort((a, b) => a.localeCompare(b, "es"));
  const porCentro = nombresCentros
    .map((c) => ({ centro: c, ...totalesMes(datos, c, mes) }))
    .filter((c) => c.ingresos || c.gastos);

  const aFilas = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([etiqueta, valor]) => ({ etiqueta, valor }))
      .sort((a, b) => b.valor - a.valor);

  return (
    <>
      <div className="dir-kpis">
        <Kpi valor={moneda(actual.ingresos)} etiqueta="Ingresos cobrados" extra={<Delta actual={actual.ingresos} anterior={anterior.ingresos} />} />
        <Kpi valor={moneda(actual.gastos)} etiqueta="Gastos" extra={<Delta actual={actual.gastos} anterior={anterior.gastos} invertir />} />
        <Kpi
          valor={moneda(actual.utilidad)}
          etiqueta="Utilidad"
          color={actual.utilidad >= 0 ? "#0f6e56" : "#a32d2d"}
          extra={<Delta actual={actual.utilidad} anterior={anterior.utilidad} />}
        />
        <Kpi valor={`${margen}%`} etiqueta="Margen" color={margen >= 0 ? "#0f6e56" : "#a32d2d"} />
        <Kpi valor={moneda(recurrente)} etiqueta="Ingreso recurrente mensual" extra={<span className="dir-delta">Rentas de contratos vigentes</span>} />
      </div>

      <div className="dir-card">
        <p className="dir-card-titulo">Ingresos vs gastos · últimos 6 meses</p>
        <BarrasMeses
          meses={meses}
          series={[
            { nombre: "Ingresos", color: "#185fa5", valores: porMes.map((t) => t.ingresos) },
            { nombre: "Gastos", color: "#f07e3a", valores: porMes.map((t) => t.gastos) },
          ]}
        />
      </div>

      <div className="dir-grid-2">
        <div className="dir-card">
          <p className="dir-card-titulo">Ingresos por concepto</p>
          <ListaBarras filas={aFilas(ingresosPorCategoria)} color="#185fa5" vacio="Sin ingresos este mes" />
        </div>
        <div className="dir-card">
          <p className="dir-card-titulo">Gastos por categoría</p>
          <ListaBarras filas={aFilas(gastosPorCategoria)} color="#f07e3a" vacio="Sin gastos este mes" />
        </div>
      </div>

      <div className="dir-card">
        <p className="dir-card-titulo">Por centro</p>
        {porCentro.length === 0 ? (
          <p className="dir-vacio">Sin movimientos este mes</p>
        ) : (
          <div className="dir-tabla-envoltura dir-tabla-plana">
            <table className="dir-tabla">
              <thead>
                <tr>
                  <th>Centro</th>
                  <th style={{ textAlign: "right" }}>Ingresos</th>
                  <th style={{ textAlign: "right" }}>Gastos</th>
                  <th style={{ textAlign: "right" }}>Utilidad</th>
                  <th style={{ textAlign: "right" }}>Margen</th>
                </tr>
              </thead>
              <tbody>
                {porCentro.map((c) => (
                  <tr key={c.centro}>
                    <td>
                      <strong>{c.centro}</strong>
                    </td>
                    <td style={{ textAlign: "right" }}>{moneda(c.ingresos)}</td>
                    <td style={{ textAlign: "right" }}>{moneda(c.gastos)}</td>
                    <td style={{ textAlign: "right", color: c.utilidad >= 0 ? "#0f6e56" : "#a32d2d", fontWeight: 700 }}>
                      {moneda(c.utilidad)}
                    </td>
                    <td style={{ textAlign: "right" }}>{pct(c.utilidad, c.ingresos)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
