"use client";

import ConsultaTarjetaFidelidad from "@/app/components/ConsultaTarjetaFidelidad";
import Link from "next/link";

export default function ConsultarTarjetaFidelidadPage() {
  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/tarjeta-fidelidad">
          ← Regresar
        </Link>
        <p className="rep-title">Nodus Flex Center</p>
        <p className="rep-sub">Consultar mi tarjeta</p>
      </div>

      <div className="rep-content">
        <ConsultaTarjetaFidelidad />
      </div>
    </div>
  );
}
