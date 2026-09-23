import {
  LABEL_TIPO_ESPACIO_FIDELIDAD,
  TIPOS_ESPACIO_FIDELIDAD,
  formatFolioFidelidad,
  type TipoEspacioFidelidad,
} from "@/lib/fidelidad";

// Tarjeta visual de cliente frecuente — mismo diseño en las 3 pantallas que
// la usan (pedir tarjeta, consultar por folio, y panel de staff). Sin
// `sellos`/`regalo` se ve en blanco (vista previa antes de pedirla); con
// ellos, pinta qué casillas ya se sellaron y qué tocaría de regalo.
type SelloVisual = { numero: number; tipo_espacio: TipoEspacioFidelidad; detalle?: string | null };

export default function FidelidadCard({
  sellos = [],
  regalo = null,
  nombre,
  folio,
}: {
  sellos?: SelloVisual[];
  regalo?: { tipo_espacio: TipoEspacioFidelidad; detalle: string | null } | null;
  nombre?: string;
  folio?: number;
}) {
  const iconoDe = (t: TipoEspacioFidelidad) => TIPOS_ESPACIO_FIDELIDAD.find((x) => x.id === t)?.icono || "";

  return (
    <div className="fidcard">
      <div className="fidcard-header">
        <div className="fidcard-logo">
          <div className="fidcard-wordmark">
            <span>N</span>
            <img src="/images/nodus-icon.png" alt="" className="fidcard-logo-icon" />
            <span>DUS</span>
          </div>
          <p className="fidcard-flex">FLEX CENTER</p>
        </div>
        <div className="fidcard-titulos">
          <p className="fidcard-titulo">Tarjeta de cliente frecuente</p>
          <p className="fidcard-subtitulo">Gracias por ser de nuestros clientes más leales</p>
        </div>
      </div>

      {(nombre || folio) && (
        <div className="fidcard-titular">
          <p className="fidcard-titular-nombre">{nombre}</p>
          {folio ? <p className="fidcard-titular-folio">{formatFolioFidelidad(folio)}</p> : null}
        </div>
      )}

      <div className="fidcard-grid">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
          if (n === 9) {
            return (
              <div key={n} className="fidcard-casilla fidcard-casilla-regalo">
                {regalo ? (
                  <>
                    <img src={iconoDe(regalo.tipo_espacio)} alt="" className="fidcard-icon" />
                    {LABEL_TIPO_ESPACIO_FIDELIDAD[regalo.tipo_espacio]}
                  </>
                ) : (
                  <>
                    <img src="/images/icons/regalo.png" alt="" className="fidcard-icon" />
                    Servicio gratis
                  </>
                )}
              </div>
            );
          }
          const sello = sellos.find((s) => s.numero === n);
          return (
            <div key={n} className={`fidcard-casilla${sello ? " fidcard-casilla-llena" : ""}`}>
              {sello && <img src={iconoDe(sello.tipo_espacio)} alt="" className="fidcard-icon" />}
            </div>
          );
        })}
      </div>

      <div className="fidcard-footer">
        <p className="fidcard-web">www.nodus.mx</p>
        <div className="fidcard-social">
          <span className="fidcard-social-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="3.6" />
              <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="fidcard-social-icon fidcard-social-icon-f">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
            </svg>
          </span>
          <p className="fidcard-social-label">Nodus Flex Center</p>
        </div>
      </div>
    </div>
  );
}
