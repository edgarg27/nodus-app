"use client";

import { useState } from "react";
import { LABEL_TIPO_ESPACIO_FIDELIDAD, calcularRegalo, type SelloFidelidad } from "@/lib/fidelidad";
import FidelidadCard from "@/app/components/FidelidadCard";

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

// Buscador por folio + tarjeta digital con nombre, folio y sellos. Se usa en
// la pantalla de consulta, en "¿Eres cliente frecuente?" y al terminar una
// solicitud de servicio.
export default function ConsultaTarjetaFidelidad() {
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
    let res: Response | null = null;
    try {
      res = await fetch(`/api/tarjeta-fidelidad/${folioNum}`);
    } catch {
      // cae al mensaje de abajo
    }
    setBuscando(false);
    if (!res) {
      setError("No se pudo consultar tu tarjeta. Intenta de nuevo.");
      return;
    }
    if (res.status === 429) {
      setError("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
      return;
    }
    if (!res.ok) {
      setError("No encontramos una tarjeta con ese folio");
      return;
    }
    setTarjeta(await res.json());
  }

  const regalo = tarjeta ? calcularRegalo(tarjeta.sellos) : null;

  return (
    <>
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
          {buscando ? "Buscando..." : "Ver mi tarjeta"}
        </button>
      </form>

      {tarjeta && (
        <>
          <p className="sub-label" style={{ marginTop: 4 }}>
            Hola, {tarjeta.nombre.split(" ")[0]} · {tarjeta.centro}
          </p>
          <FidelidadCard sellos={tarjeta.sellos} regalo={regalo} nombre={tarjeta.nombre} folio={tarjeta.folio} />
          <p className="fidelidad-card-nota" style={{ color: "#8b93a7" }}>
            {tarjeta.sellos.length}/8 sellos · {LABEL_ESTADO[tarjeta.estado]}
          </p>
          {regalo && (
            <p className="fidelidad-card-nota" style={{ fontWeight: 600, color: "#0d1b3e" }}>
              {tarjeta.estado === "activa" ? "Si terminaras hoy, tu regalo sería: " : "Tu regalo es: "}
              {LABEL_TIPO_ESPACIO_FIDELIDAD[regalo.tipo_espacio]}
              {regalo.detalle ? ` (${regalo.detalle})` : ""}
            </p>
          )}
        </>
      )}
    </>
  );
}
