import { CarruselDestacados, type BannerDestacado } from "@/app/components/CarruselBanners";
import type { DatosDireccion } from "../datosDireccion";
import { clientesActivos, resumenCartera } from "./SeccionCartera";
import { ingresoRecurrente, totalesMes } from "./SeccionFinanzas";
import { colorOcupacion, resumenOcupacion } from "./SeccionOcupacion";
import { prospectosDelMes, tasaConversion } from "./SeccionVentas";
import { Delta, Kpi, deCentro, etiquetaMes, mesAnterior, moneda, pct } from "./util";

export type Seccion = "resumen" | "ocupacion" | "finanzas" | "cartera" | "ventas";

// La foto del mes en una sola pantalla, y lo que requiere atención.
export default function SeccionResumen({
  datos,
  centro,
  mes,
  onIr,
  banners,
}: {
  datos: DatosDireccion;
  centro: string;
  mes: string;
  onIr: (s: Seccion) => void;
  banners: BannerDestacado[];
}) {
  const ocupacion = resumenOcupacion(datos, centro);
  const fin = totalesMes(datos, centro, mes);
  const finAnterior = totalesMes(datos, centro, mesAnterior(mes));
  const cartera = resumenCartera(datos, centro);
  const activos = clientesActivos(datos, centro).length;
  const nuevos = prospectosDelMes(datos, centro, mes).length;
  const nuevosAnterior = prospectosDelMes(datos, centro, mesAnterior(mes)).length;
  const conversion = tasaConversion(datos, centro, mes);

  // Alertas: solo lo que pide una decisión.
  const alertas: { texto: string; seccion: Seccion; grave: boolean }[] = [];
  const vencidos = ocupacion.contratos.filter((c) => c.dias < 0);
  if (vencidos.length)
    alertas.push({ texto: `${vencidos.length} contrato(s) ya vencieron y siguen como vigentes: renovar o dar de baja.`, seccion: "ocupacion", grave: true });
  const en30 = ocupacion.contratos.filter((c) => c.dias >= 0 && c.dias <= 30);
  if (en30.length)
    alertas.push({
      texto: `${en30.length} contrato(s) vencen en los próximos 30 días (${moneda(en30.reduce((s, c) => s + c.rentaMensual, 0))} de renta mensual).`,
      seccion: "ocupacion",
      grave: false,
    });
  ocupacion.centros
    .filter((c) => c.total && c.porcentaje < 60)
    .forEach((c) => alertas.push({ texto: `${c.centro} está al ${c.porcentaje}% de ocupación (${c.disponibles} espacios libres).`, seccion: "ocupacion", grave: false }));
  if (cartera.vencido)
    alertas.push({ texto: `${moneda(cartera.vencido)} en pagos vencidos (${cartera.vencidos.length} pagos).`, seccion: "cartera", grave: true });
  if (fin.utilidad < 0) alertas.push({ texto: `En ${etiquetaMes(mes)} los gastos superan a los ingresos por ${moneda(-fin.utilidad)}.`, seccion: "finanzas", grave: true });
  const centroDeProspecto = new Map(datos.prospectos.map((p) => [p.id, p.centro]));
  const atrasadas = datos.actividades.filter((a) => !a.completada && a.fecha < datos.hoy && deCentro(centroDeProspecto.get(a.prospecto_id), centro)).length;
  if (atrasadas) alertas.push({ texto: `${atrasadas} seguimiento(s) de prospectos atrasados.`, seccion: "ventas", grave: false });

  return (
    <>
      <div className="dir-kpis">
        <Kpi valor={`${ocupacion.porcentaje}%`} etiqueta="Ocupación" color={colorOcupacion(ocupacion.porcentaje)} />
        <Kpi valor={moneda(fin.ingresos)} etiqueta={`Ingresos de ${etiquetaMes(mes)}`} extra={<Delta actual={fin.ingresos} anterior={finAnterior.ingresos} />} />
        <Kpi
          valor={moneda(fin.utilidad)}
          etiqueta="Utilidad del mes"
          color={fin.utilidad >= 0 ? "#0f6e56" : "#a32d2d"}
          extra={<span className="dir-delta">Margen {pct(fin.utilidad, fin.ingresos)}%</span>}
        />
        <Kpi valor={moneda(ingresoRecurrente(datos, centro))} etiqueta="Ingreso recurrente mensual" />
      </div>
      <div className="dir-kpis">
        <Kpi valor={moneda(cartera.vencido)} etiqueta="Por cobrar vencido" color={cartera.vencido ? "#a32d2d" : undefined} extra={<span className="dir-delta">De {moneda(cartera.total)} por cobrar</span>} />
        <Kpi valor={activos} etiqueta="Clientes activos" />
        <Kpi valor={nuevos} etiqueta="Prospectos nuevos" extra={<Delta actual={nuevos} anterior={nuevosAnterior} />} />
        <Kpi
          valor={conversion.base ? `${pct(conversion.convertidos, conversion.base)}%` : "—"}
          etiqueta="Conversión a cliente"
          extra={<span className="dir-delta">Últimos 6 meses</span>}
        />
      </div>

      {/* El carrusel va al lado de las alertas (no encima de los indicadores)
          para no empujar los números hacia abajo. */}
      <div className={banners.length ? "dir-resumen-fila" : undefined}>
      {banners.length > 0 && (
        <div className="dir-card dir-carrusel">
          <CarruselDestacados banners={banners} />
        </div>
      )}
      <div className="dir-card">
        <p className="dir-card-titulo">⚠️ Requiere atención</p>
        {alertas.length === 0 ? (
          <p className="dir-vacio">Todo en orden 👌</p>
        ) : (
          <div className="dir-alertas">
            {alertas.map((a, i) => (
              <button key={i} type="button" className={`dir-alerta${a.grave ? " dir-alerta-grave" : ""}`} onClick={() => onIr(a.seccion)}>
                <span>{a.texto}</span>
                <span className="dir-alerta-ir">Ver →</span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  );
}
