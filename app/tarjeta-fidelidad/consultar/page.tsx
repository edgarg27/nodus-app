"use client";

import { useState } from "react";
import { LABEL_TIPO_ESPACIO_FIDELIDAD, TipoEspacioFidelidad, calcularRegalo, type SelloFidelidad } from "@/lib/fidelidad";

type TarjetaConsulta = {
  folio: number;
  nombre: string;
  centro: string;
  estado: "activa" | "completada" | "canjeada";
  sellos: SelloFidelidad[];
};

const LABEL_ESTADO: Record<TarjetaConsulta["estado"], string> = {
  activa: "Activa",
  completada: "¡Completa! Ya puedes reclamar tu regalo",
  canjeada: "Regalo ya entregado",
};

export default function ConsultarTarjetaFidelidadPage() {
  const [folioInput, setFolioInput] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [tarjeta, setTarjeta] = useState<TarjetaConsulta | null>(null);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTarjeta(null);
    const folioNum = folioInput.replace(/\D/g, "");
    if (!folioNum) {
      setError("Escribe el número de folio de tu tarjeta");
      return;
    }
    setBuscando(true);
    const res = await fetch(`/api/tarjeta-fidelidad/${folioNum}`);
    setBuscando(false);
    if (!res.ok) {
      setError("No encontramos una tarjeta con ese folio");
      return;
    }
    setTarjeta(await res.json());
  }

  const regalo = tarjeta ? calcularRegalo(tarjeta.sellos) : null;

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
        <form className="form-card" onSubmit={buscar}>
          <p className="sub-label">Tu folio</p>
          <input
            type="text"
            placeholder="Ej. NODUS-FID-000123 o solo el número"
            value={folioInput}
            onChange={(e) => setFolioInput(e.target.value)}
          />
          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          <button className="reservar-btn" type="submit" disabled={buscando}>
            {buscando ? "Buscando..." : "Buscar mi tarjeta"}
          </button>
        </form>

        {tarjeta && (
          <div className="fidelidad-card" style={{ marginTop: 16 }}>
            <p className="fidelidad-card-titulo">
              Hola, {tarjeta.nombre.split(" ")[0]} · {tarjeta.centro}
            </p>
            <div className="fidelidad-grid">
              {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
                const sello = tarjeta.sellos.find((s) => s.numero === n);
                const esRegalo = n === 9;
                return (
                  <div
                    key={n}
                    className={`fidelidad-casilla${sello ? " fidelidad-casilla-llena" : ""}${esRegalo ? " fidelidad-casilla-regalo" : ""}`}
                  >
                    {esRegalo ? "🎁" : sello ? TIPOS_ICONO[sello.tipo_espacio] : n}
                  </div>
                );
              })}
            </div>
            <p className="fidelidad-card-nota">
              {tarjeta.sellos.length}/8 sellos · {LABEL_ESTADO[tarjeta.estado]}
            </p>
            {regalo && (
              <p className="fidelidad-card-nota" style={{ fontWeight: 600, color: "#0d1b3e" }}>
                {tarjeta.estado === "activa" ? "Si terminaras hoy, tu regalo sería: " : "Tu regalo es: "}
                {LABEL_TIPO_ESPACIO_FIDELIDAD[regalo.tipo_espacio]}
                {regalo.detalle ? ` (${regalo.detalle})` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TIPOS_ICONO: Record<TipoEspacioFidelidad, string> = {
  sala_juntas: "🤝",
  coworking: "💻",
  oficina_privada: "🏢",
  working_desk: "🪑",
};
