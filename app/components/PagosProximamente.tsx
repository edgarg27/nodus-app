// Pantalla de "Próximamente" para los pagos en línea (tarjeta, SPEI, tarjetas guardadas) mientras están apagados
// (lib/pagosEnLinea.ts). Ofrece lo que sí se puede hacer hoy: pagar por transferencia y subir el comprobante.
export default function PagosProximamente({ titulo = "Pagos en línea" }: { titulo?: string }) {
  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/estado-cuenta">
          ← Estado de cuenta
        </a>
        <p className="rep-title">{titulo}</p>
      </div>
      <div className="rep-content">
        <div className="proximamente-card">
          <span className="proximamente-chip">Próximamente</span>
          <p className="proximamente-titulo">Muy pronto podrás pagar desde la app</p>
          <p className="proximamente-texto">
            Estamos preparando los pagos con tarjeta y por referencia. Mientras tanto, paga por transferencia y sube tu
            comprobante desde tu estado de cuenta, en el botón “Ya pagué, subir comprobante”.
          </p>
          <a className="pagar-btn-full" href="/estado-cuenta">
            Ir a mi estado de cuenta
          </a>
        </div>
      </div>
    </div>
  );
}

// Botón deshabilitado que reemplaza a los de "Pagar con tarjeta / SPEI / Liquidar saldo".
export function BotonPagoProximamente({ texto = "💳 Pago en línea" }: { texto?: string }) {
  return (
    <span className="pagar-btn-full pagar-btn-proximamente" aria-disabled="true">
      {texto} <small>Próximamente</small>
    </span>
  );
}
