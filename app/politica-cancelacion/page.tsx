import type { Metadata } from "next";
import {
  POLITICA_CANCELACION_INTRO,
  POLITICA_CANCELACION_SECCIONES,
  POLITICA_CANCELACION_VERSION,
} from "@/lib/politicaCancelacion";

export const metadata: Metadata = { title: "Política de cancelación y reembolsos · Nodus" };

// Página pública (no pide sesión): el cliente puede leerla antes de contratar o pagar.
export default function PoliticaCancelacionPage() {
  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">Política de cancelación y reembolsos</p>
        <p className="rep-sub">Nodus Flex Center</p>
      </div>
      <div className="sub-content" style={{ lineHeight: 1.55 }}>
        <p style={{ fontSize: 14, color: "#555" }}>{POLITICA_CANCELACION_INTRO}</p>
        {POLITICA_CANCELACION_SECCIONES.map((s) => (
          <section key={s.titulo} style={{ marginTop: 18 }}>
            <p className="sub-label" style={{ fontSize: 15, fontWeight: 700, color: "#0d1b3e" }}>
              {s.titulo}
            </p>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 14, color: "#333" }}>
              {s.puntos.map((t) => (
                <li key={t} style={{ marginBottom: 6 }}>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p style={{ fontSize: 12, color: "#888", marginTop: 22 }}>Versión {POLITICA_CANCELACION_VERSION}</p>
      </div>
    </div>
  );
}
