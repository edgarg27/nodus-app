"use client";

import ConsultaTarjetaFidelidad from "@/app/components/ConsultaTarjetaFidelidad";

export default function ConsultarTarjetaFidelidadPage() {
  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/tarjeta-fidelidad">
          ← Regresar
        </a>
        <p className="rep-title">Nodus Flex Center</p>
        <p className="rep-sub">Consultar mi tarjeta</p>
      </div>

      <div className="rep-content">
        <ConsultaTarjetaFidelidad />
      </div>
    </div>
  );
}
