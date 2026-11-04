"use client";

import { useEffect, useState } from "react";
import { recargoConIva } from "@/lib/formaPago";
import { quitarIva, totalDesdeSubtotal } from "@/lib/adicionales";

// Agregar a una factura sin timbrar una penalización por atraso u otro adicional del catálogo, con su clave del SAT.
// Se usa en Integrar por cliente y en el estado de cuenta. El monto se captura + IVA, como en Adicionales, y se
// agrega con IVA.

export const CLAVE_PENALIZACION = "penalizacion_mora";

export type CargoNuevo = { adicionalTipo: string; descripcion: string; monto: number };

type Servicio = { clave: string; etiqueta: string; concepto: string; precio: number | null };

export default function CargoFactura({
  base,
  ocupado,
  textoBoton,
  onAgregar,
}: {
  // Sobre qué monto se sugiere el 3% de la penalización (con IVA incluido).
  base: number;
  ocupado?: boolean;
  textoBoton: string;
  onAgregar: (c: CargoNuevo) => void;
}) {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [clave, setClave] = useState(CLAVE_PENALIZACION);
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState("");
  // La penalización sugerida conserva su 3% exacto con IVA si no se cambió.
  const montoConIva = totalDesdeSubtotal(monto, clave === CLAVE_PENALIZACION && base > 0 ? recargoConIva(base) : null);

  function elegir(lista: Servicio[], nuevaClave: string) {
    const s = lista.find((x) => x.clave === nuevaClave);
    setClave(nuevaClave);
    setDescripcion(s?.concepto || "");
    setError("");
    if (nuevaClave === CLAVE_PENALIZACION) setMonto(base > 0 ? String(quitarIva(recargoConIva(base))) : "");
    else setMonto(s?.precio != null ? String(quitarIva(s.precio)) : "");
  }

  useEffect(() => {
    fetch("/api/catalogo-servicios")
      .then((r) => r.json())
      .then((d) => {
        const lista: Servicio[] = d.servicios || [];
        setServicios(lista);
        elegir(lista, lista.some((s) => s.clave === CLAVE_PENALIZACION) ? CLAVE_PENALIZACION : lista[0]?.clave || "");
      })
      .catch(() => setError("No se pudo cargar el catálogo de servicios"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function agregar() {
    const m = montoConIva;
    if (!clave) return setError("Elige el servicio");
    if (!descripcion.trim()) return setError("Escribe la descripción");
    if (!(m > 0)) return setError("Escribe un monto mayor a cero");
    onAgregar({ adicionalTipo: clave, descripcion: descripcion.trim(), monto: m });
    elegir(servicios, clave);
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <div>
          <p className="sub-label">Servicio</p>
          <select value={clave} onChange={(e) => elegir(servicios, e.target.value)}>
            {servicios.map((s) => (
              <option key={s.clave} value={s.clave}>
                {s.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="sub-label">Descripción en la factura</p>
          <input type="text" maxLength={200} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        <div>
          <p className="sub-label">Monto + IVA</p>
          <input type="number" min={0} step="0.01" placeholder="Sin IVA" value={monto} onChange={(e) => setMonto(e.target.value)} />
          {montoConIva > 0 && <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>Con IVA: ${montoConIva.toLocaleString("es-MX")}</p>}
        </div>
      </div>
      {clave === CLAVE_PENALIZACION && (
        <p style={{ fontSize: 12, color: "#854F0B", margin: "8px 0 0" }}>
          El monto sugerido es el 3% y se puede cambiar. El cobro diario ya genera solo un recargo del 3% a partir del día siguiente al día de pago (el 11): revisa sus estados de cuenta para no
          cobrarlo dos veces.
        </p>
      )}
      {error && <p style={{ fontSize: 13, color: "#A32D2D", margin: "8px 0 0" }}>{error}</p>}
      <button type="button" className="btn-exportar fac-naranja" style={{ marginTop: 10 }} disabled={ocupado || servicios.length === 0} onClick={agregar}>
        {textoBoton}
      </button>
    </div>
  );
}
