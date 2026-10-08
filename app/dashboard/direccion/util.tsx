import { fechaLocal } from "@/lib/fechaMexico";

// Piezas compartidas por las secciones del Panel de Dirección.

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export const moneda = (n: number) => `$${Math.round(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;

export const pct = (parte: number, total: number) => (total ? Math.round((parte / total) * 100) : 0);

// "2026-10" → "Octubre 2026"; corto: "oct 26"
export function etiquetaMes(mes: string, corto = false) {
  const [a, m] = mes.split("-").map(Number);
  if (corto) return `${MESES[m - 1].slice(0, 3).toLowerCase()} ${String(a).slice(2)}`;
  return `${MESES[m - 1]} ${a}`;
}

export function mesAnterior(mes: string, cuantos = 1) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 - cuantos, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Los últimos `n` meses terminando en `mes` (el más viejo primero).
export function ultimosMeses(mes: string, n: number) {
  return Array.from({ length: n }, (_, i) => mesAnterior(mes, n - 1 - i));
}

// Una fecha ("2026-10-05" o un timestamp) cae en el mes "2026-10".
export const enMes = (fecha: string | null | undefined, mes: string) => !!fecha && fecha.slice(0, 7) === mes;

export const deCentro = (centroFila: string | null | undefined, centro: string) =>
  centro === "todos" || (centroFila || "Sin centro") === centro;

export const fechaCorta = (f: string) =>
  fechaLocal(f.slice(0, 10)).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

// Variación contra el periodo anterior, con flecha y color.
export function Delta({ actual, anterior, invertir = false }: { actual: number; anterior: number; invertir?: boolean }) {
  if (!anterior) return <span className="dir-delta">{actual ? "Sin dato del mes anterior" : "—"}</span>;
  const cambio = Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
  const bueno = invertir ? cambio <= 0 : cambio >= 0;
  return (
    <span className={`dir-delta ${cambio === 0 ? "" : bueno ? "dir-delta-bien" : "dir-delta-mal"}`}>
      {cambio > 0 ? "▲" : cambio < 0 ? "▼" : "="} {Math.abs(cambio)}% vs mes anterior
    </span>
  );
}

export function Kpi({
  valor,
  etiqueta,
  color,
  extra,
}: {
  valor: React.ReactNode;
  etiqueta: string;
  color?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="dir-kpi">
      <p className="dir-kpi-num" style={color ? { color } : undefined}>
        {valor}
      </p>
      <p className="dir-kpi-label">{etiqueta}</p>
      {extra}
    </div>
  );
}

// Gráfica de barras sencilla (sin librerías): una o dos series por mes.
export function BarrasMeses({
  meses,
  series,
  formato = moneda,
}: {
  meses: string[];
  series: { nombre: string; color: string; valores: number[] }[];
  formato?: (n: number) => string;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  return (
    <div>
      <div className="dir-barras">
        {meses.map((mes, i) => (
          <div className="dir-barras-mes" key={mes}>
            <div className="dir-barras-grupo">
              {series.map((s) => (
                <div
                  key={s.nombre}
                  className="dir-barras-barra"
                  style={{ height: `${(s.valores[i] / max) * 100}%`, background: s.color }}
                  title={`${s.nombre} ${etiquetaMes(mes)}: ${formato(s.valores[i])}`}
                />
              ))}
            </div>
            <span className="dir-barras-etiqueta">{etiquetaMes(mes, true)}</span>
          </div>
        ))}
      </div>
      <div className="dir-leyenda">
        {series.map((s) => (
          <span key={s.nombre}>
            <i style={{ background: s.color }} /> {s.nombre}
          </span>
        ))}
      </div>
    </div>
  );
}

// Lista "etiqueta ........ valor" con barrita proporcional.
export function ListaBarras({
  filas,
  formato = moneda,
  color = "#0d1b3e",
  vacio = "Sin datos",
}: {
  filas: { etiqueta: string; valor: number; sub?: string }[];
  formato?: (n: number) => string;
  color?: string;
  vacio?: string;
}) {
  if (filas.length === 0) return <p className="dir-vacio">{vacio}</p>;
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <div className="dir-lista">
      {filas.map((f) => (
        <div className="dir-lista-fila" key={f.etiqueta}>
          <div className="dir-lista-texto">
            <span>
              {f.etiqueta}
              {f.sub && <small>{f.sub}</small>}
            </span>
            <strong>{formato(f.valor)}</strong>
          </div>
          <div className="dir-lista-barra">
            <div style={{ width: `${(f.valor / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
