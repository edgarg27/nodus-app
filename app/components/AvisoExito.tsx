"use client";

// Modal de éxito animado — mismo aspecto que ya usan Cotizar, Contratos y
// Prospectos (clases invitado-exito-* de globals.css).
export default function AvisoExito({
  titulo = "¡Se agregó con éxito!",
  mensaje,
  onCerrar,
}: {
  titulo?: string;
  mensaje: string;
  onCerrar: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="invitado-exito-card" onClick={(e) => e.stopPropagation()}>
        <div className="invitado-exito-icono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <p className="invitado-exito-titulo">{titulo}</p>
        <p className="invitado-exito-mensaje">{mensaje}</p>
        <button className="invitado-exito-btn" onClick={onCerrar}>
          Entendido
        </button>
      </div>
    </div>
  );
}
