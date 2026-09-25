"use client";

import Checkbox from "@/app/components/Checkbox";
import { POLITICA_CANCELACION_RESUMEN, POLITICA_CANCELACION_URL } from "@/lib/politicaCancelacion";

// Aviso de la política de cancelación y reembolsos antes de pagar, con casilla para
// aceptarla. El servidor vuelve a pedir la versión aceptada (no solo se confía en la
// casilla): ver POLITICA_CANCELACION_VERSION.
export default function AceptoPolitica({
  acepto,
  onChange,
  deshabilitado,
}: {
  acepto: boolean;
  onChange: (v: boolean) => void;
  deshabilitado?: boolean;
}) {
  return (
    <div className="nota-info" style={{ lineHeight: 1.5 }}>
      <p style={{ margin: "0 0 8px" }}>{POLITICA_CANCELACION_RESUMEN}</p>
      <Checkbox checked={acepto} onChange={onChange} disabled={deshabilitado}>
        He leído y acepto la{" "}
        <a href={POLITICA_CANCELACION_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
          política de cancelación y reembolsos
        </a>
      </Checkbox>
    </div>
  );
}
