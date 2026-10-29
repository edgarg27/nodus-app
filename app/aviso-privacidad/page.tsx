import type { Metadata } from "next";
import {
  AVISO_PRIVACIDAD_FECHA,
  AVISO_PRIVACIDAD_SECCIONES,
  CORREO_PRIVACIDAD,
  RESPONSABLE,
} from "@/lib/avisoPrivacidad";

export const metadata: Metadata = { title: "Aviso de privacidad · Nodus" };

// Página pública (no pide sesión): se enlaza desde el login y desde "Agendar sin cuenta".
export default function AvisoPrivacidadPage() {
  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/login">
          ← Regresar
        </a>
        <p className="rep-title">Aviso de privacidad</p>
        <p className="rep-sub">Nodus Flex Center</p>
      </div>
      <div className="sub-content aviso-privacidad">
        <p className="aviso-privacidad-intro">{RESPONSABLE}</p>
        {AVISO_PRIVACIDAD_SECCIONES.map((s) => (
          <section key={s.titulo}>
            <h2>{s.titulo}</h2>
            {s.texto && <p>{s.texto}</p>}
            {s.puntos && (
              <ol>
                {s.puntos.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            )}
            {s.cierre && <p>{s.cierre}</p>}
          </section>
        ))}
        <p className="aviso-privacidad-contacto">
          ¿Dudas sobre tus datos? Escríbenos a <a href={`mailto:${CORREO_PRIVACIDAD}`}>{CORREO_PRIVACIDAD}</a>.
        </p>
        <p className="aviso-privacidad-fecha">La fecha de actualización del presente aviso es {AVISO_PRIVACIDAD_FECHA}.</p>
      </div>
    </div>
  );
}
