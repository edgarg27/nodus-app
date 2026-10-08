import { pagoEstaCubierto } from "@/lib/pagosCategoria";
import type { DatosDireccion } from "../datosDireccion";
import { Kpi, ListaBarras, deCentro, enMes, etiquetaMes, moneda, pct, ultimosMeses } from "./util";

// Cartera = pagos generados que todavía no entran (todo lo que no está
// pagado). "Vencido" = ya pasó su fecha límite. Los que mandaron comprobante y
// esperan validación (en_revision) se cuentan aparte.
const NO_COBRABLES = new Set(["cancelado", "cancelada", "en_revision"]);

function diasVencido(fechaLimite: string, hoy: string) {
  const a = new Date(`${fechaLimite.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${hoy}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function resumenCartera(datos: DatosDireccion, centro: string) {
  const pendientes = datos.pagos.filter(
    (p) => !pagoEstaCubierto(p.estado) && !NO_COBRABLES.has(p.estado) && deCentro(p.centro, centro)
  );
  const total = pendientes.reduce((s, p) => s + p.monto, 0);
  const vencidos = pendientes.filter((p) => p.fecha_limite && diasVencido(p.fecha_limite, datos.hoy) > 0);
  const vencido = vencidos.reduce((s, p) => s + p.monto, 0);
  const enRevision = datos.pagos
    .filter((p) => p.estado === "en_revision" && deCentro(p.centro, centro))
    .reduce((s, p) => s + p.monto, 0);
  return { pendientes, total, vencidos, vencido, enRevision };
}

export function clientesActivos(datos: DatosDireccion, centro: string) {
  return datos.clientes.filter((c) => c.activo && !c.suspendido && deCentro(c.centro, centro));
}

export default function SeccionCartera({ datos, centro, mes }: { datos: DatosDireccion; centro: string; mes: string }) {
  const cartera = resumenCartera(datos, centro);
  const nombreCliente = new Map(datos.clientes.map((c) => [c.id, c.empresa ? `${c.nombre} · ${c.empresa}` : c.nombre || "Cliente"]));

  // Antigüedad de lo vencido
  const tramos = [
    { etiqueta: "Aún no vence", min: -Infinity, max: 0 },
    { etiqueta: "1 a 30 días vencido", min: 1, max: 30 },
    { etiqueta: "31 a 60 días vencido", min: 31, max: 60 },
    { etiqueta: "61 a 90 días vencido", min: 61, max: 90 },
    { etiqueta: "Más de 90 días vencido", min: 91, max: Infinity },
  ].map((t) => ({
    etiqueta: t.etiqueta,
    valor: cartera.pendientes
      .filter((p) => p.fecha_limite)
      .filter((p) => {
        const d = diasVencido(p.fecha_limite as string, datos.hoy);
        return d >= t.min && d <= t.max;
      })
      .reduce((s, p) => s + p.monto, 0),
  }));
  const sinFecha = cartera.pendientes.filter((p) => !p.fecha_limite).reduce((s, p) => s + p.monto, 0);
  if (sinFecha) tramos.push({ etiqueta: "Sin fecha límite", valor: sinFecha });

  // Quién debe más
  const deudaPorCliente = new Map<string, number>();
  cartera.pendientes.forEach((p) => {
    const k = p.user_id || "sin-cliente";
    deudaPorCliente.set(k, (deudaPorCliente.get(k) || 0) + p.monto);
  });
  const deudores = Array.from(deudaPorCliente.entries())
    .map(([id, valor]) => ({ etiqueta: nombreCliente.get(id) || "Sin cliente ligado", valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  // Cobrado a tiempo: de los pagos con fecha límite en el mes, cuántos se
  // pagaron a más tardar ese día.
  const conLimiteEnMes = datos.pagos.filter((p) => enMes(p.fecha_limite, mes) && deCentro(p.centro, centro));
  const aTiempo = conLimiteEnMes.filter(
    (p) => pagoEstaCubierto(p.estado) && p.fecha_pago && p.fecha_limite && p.fecha_pago.slice(0, 10) <= p.fecha_limite.slice(0, 10)
  );

  // Clientes
  const activos = clientesActivos(datos, centro);
  const suspendidos = datos.clientes.filter((c) => c.activo && c.suspendido && deCentro(c.centro, centro)).length;
  const altas = (m: string) => datos.todosContratos.filter((c) => c.user_id && enMes(c.fecha_inicio, m) && deCentro(c.centro, centro)).length;
  const bajas = (m: string) => datos.todosContratos.filter((c) => enMes(c.fecha_baja, m) && deCentro(c.centro, centro)).length;
  const meses = ultimosMeses(mes, 6);

  // Los que más han pagado en los últimos 12 meses
  const doceMeses = new Set(ultimosMeses(mes, 12));
  const pagadoPorCliente = new Map<string, number>();
  datos.pagos
    .filter((p) => pagoEstaCubierto(p.estado) && p.fecha_pago && doceMeses.has(p.fecha_pago.slice(0, 7)) && deCentro(p.centro, centro))
    .forEach((p) => {
      if (!p.user_id) return;
      pagadoPorCliente.set(p.user_id, (pagadoPorCliente.get(p.user_id) || 0) + p.monto);
    });
  const topClientes = Array.from(pagadoPorCliente.entries())
    .map(([id, valor]) => ({ etiqueta: nombreCliente.get(id) || "Cliente", valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  const porCentro = new Map<string, number>();
  activos.forEach((c) => porCentro.set(c.centro || "Sin centro", (porCentro.get(c.centro || "Sin centro") || 0) + 1));

  return (
    <>
      <p className="dir-subtitulo">💳 Lo que nos deben</p>
      <div className="dir-kpis">
        <Kpi valor={moneda(cartera.total)} etiqueta="Por cobrar" />
        <Kpi valor={moneda(cartera.vencido)} etiqueta={`Vencido (${cartera.vencidos.length} pagos)`} color={cartera.vencido ? "#a32d2d" : undefined} />
        <Kpi valor={moneda(cartera.enRevision)} etiqueta="Comprobantes por validar" />
        <Kpi
          valor={conLimiteEnMes.length ? `${pct(aTiempo.length, conLimiteEnMes.length)}%` : "—"}
          etiqueta={`Pagado a tiempo en ${etiquetaMes(mes)}`}
          extra={<span className="dir-delta">{aTiempo.length} de {conLimiteEnMes.length} pagos</span>}
        />
      </div>
      <div className="dir-grid-2">
        <div className="dir-card">
          <p className="dir-card-titulo">Antigüedad de lo pendiente</p>
          <ListaBarras filas={tramos.filter((t) => t.valor)} color="#a32d2d" vacio="No hay pagos pendientes" />
        </div>
        <div className="dir-card">
          <p className="dir-card-titulo">Clientes con mayor adeudo</p>
          <ListaBarras filas={deudores} color="#a32d2d" vacio="Nadie debe 🎉" />
        </div>
      </div>

      <p className="dir-subtitulo">👥 Clientes</p>
      <div className="dir-kpis">
        <Kpi valor={activos.length} etiqueta="Clientes activos" />
        <Kpi valor={altas(mes)} etiqueta={`Contratos nuevos en ${etiquetaMes(mes)}`} color="#0f6e56" />
        <Kpi valor={bajas(mes)} etiqueta={`Bajas en ${etiquetaMes(mes)}`} color={bajas(mes) ? "#a32d2d" : undefined} />
        <Kpi valor={suspendidos} etiqueta="Cuentas suspendidas" color={suspendidos ? "#a32d2d" : undefined} />
      </div>
      <div className="dir-grid-2">
        <div className="dir-card">
          <p className="dir-card-titulo">Altas y bajas · últimos 6 meses</p>
          <div className="dir-tabla-envoltura dir-tabla-plana">
            <table className="dir-tabla">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th style={{ textAlign: "right" }}>Altas</th>
                  <th style={{ textAlign: "right" }}>Bajas</th>
                  <th style={{ textAlign: "right" }}>Neto</th>
                </tr>
              </thead>
              <tbody>
                {meses
                  .slice()
                  .reverse()
                  .map((m) => {
                    const neto = altas(m) - bajas(m);
                    return (
                      <tr key={m}>
                        <td>{etiquetaMes(m)}</td>
                        <td style={{ textAlign: "right" }}>{altas(m)}</td>
                        <td style={{ textAlign: "right" }}>{bajas(m)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: neto > 0 ? "#0f6e56" : neto < 0 ? "#a32d2d" : undefined }}>
                          {neto > 0 ? `+${neto}` : neto}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="dir-card">
          <p className="dir-card-titulo">Clientes que más han pagado · 12 meses</p>
          <ListaBarras filas={topClientes} color="#0f6e56" vacio="Sin pagos en los últimos 12 meses" />
        </div>
      </div>
      {centro === "todos" && porCentro.size > 1 && (
        <div className="dir-card">
          <p className="dir-card-titulo">Clientes activos por centro</p>
          <ListaBarras
            filas={Array.from(porCentro.entries())
              .map(([etiqueta, valor]) => ({ etiqueta, valor }))
              .sort((a, b) => b.valor - a.valor)}
            formato={(n) => String(n)}
          />
        </div>
      )}
    </>
  );
}
