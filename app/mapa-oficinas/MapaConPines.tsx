"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ModalDisponibilidad from "./ModalDisponibilidad";

type Oficina = {
  id: string;
  numero: string;
  tipo: string;
  estado: string;
  mapa_x: number | null;
  mapa_y: number | null;
  paquete_default_id: string | null;
};

// El pin no es un emoji — un emoji no se puede colorear vía CSS.
const COLOR_POR_ESTADO: Record<string, string> = {
  disponible: "#0F6E56", // verde
  ocupada: "#185FA5", // azul
  mantenimiento: "#8A8A8A", // gris
};
const COLOR_DEFAULT = "#8A8A8A"; // gris — cualquier otro valor de estado

function colorPorEstado(estado: string) {
  return COLOR_POR_ESTADO[estado] || COLOR_DEFAULT;
}

export default function MapaConPines({
  centro,
  imagenUrl,
  puedeEditar,
}: {
  centro: string;
  imagenUrl: string;
  puedeEditar: boolean;
}) {
  const supabase = createClient();
  const imgRef = useRef<HTMLImageElement>(null);
  const [oficinas, setOficinas] = useState<Oficina[]>([]);

  useEffect(() => {
    fetchOficinas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  async function fetchOficinas() {
    const { data } = await supabase
      .from("oficinas")
      .select("id, numero, tipo, estado, mapa_x, mapa_y, paquete_default_id")
      .eq("centro", centro);
    // .order("numero") de Supabase ordena como texto (1, 10, 11, 2, 20...) —
    // aquí se ordena numéricamente (1, 2, 3...) y, si empatan, por tipo.
    setOficinas(
      (data || []).slice().sort((a, b) => {
        const na = parseInt(a.numero, 10);
        const nb = parseInt(b.numero, 10);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.numero.localeCompare(b.numero, "es", { numeric: true }) || a.tipo.localeCompare(b.tipo, "es");
      })
    );
  }

  // ---- Modo "Colocar pines" ----
  const [modoEdicion, setModoEdicion] = useState(false);
  const [oficinaAColocar, setOficinaAColocar] = useState("");
  const [colocando, setColocando] = useState(false);

  async function colocarPin(e: React.MouseEvent<HTMLImageElement>) {
    if (!modoEdicion || !oficinaAColocar || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setColocando(true);
    await supabase.from("oficinas").update({ mapa_x: x, mapa_y: y }).eq("id", oficinaAColocar);
    setColocando(false);
    fetchOficinas();
  }

  // ---- Modal de disponibilidad ----
  const [modalAbierto, setModalAbierto] = useState(false);
  const [oficinaParaModal, setOficinaParaModal] = useState<string | null>(null);

  function abrirModal(oficinaId: string | null) {
    setOficinaParaModal(oficinaId);
    setModalAbierto(true);
  }

  const oficinasConPin = oficinas.filter((o) => o.mapa_x != null && o.mapa_y != null);
  const oficinasSinPin = oficinas.filter((o) => o.mapa_x == null || o.mapa_y == null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => abrirModal(null)}>
          🔍 Verificar disponibilidad
        </button>
        {puedeEditar && (
          <button
            className="tel-borrar-btn"
            style={{ color: modoEdicion ? "#A32D2D" : "#0d1b3e", fontWeight: 600 }}
            onClick={() => {
              setModoEdicion((v) => !v);
              setOficinaAColocar("");
            }}
          >
            {modoEdicion ? "Salir de colocar pines" : "📍 Colocar pines"}
          </button>
        )}
      </div>

      {modoEdicion && (
        <div className="form-card" style={{ marginBottom: 8 }}>
          <p className="sub-label">Elige la oficina y da clic en la imagen para posicionar su pin</p>
          <select value={oficinaAColocar} onChange={(e) => setOficinaAColocar(e.target.value)}>
            <option value="">Selecciona una oficina</option>
            {oficinasSinPin.map((o) => (
              <option key={o.id} value={o.id}>
                {o.numero} · {o.tipo}
              </option>
            ))}
            {oficinasConPin.length > 0 && (
              <optgroup label="Ya tienen pin (reposicionar)">
                {oficinasConPin.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero} · {o.tipo} (reposicionar)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {colocando && <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>Guardando posición...</p>}
        </div>
      )}

      <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imagenUrl}
          alt={`Layout ${centro}`}
          onClick={colocarPin}
          style={{ width: "100%", display: "block", cursor: modoEdicion && oficinaAColocar ? "crosshair" : "default" }}
        />
        {oficinasConPin.map((o) => (
          <button
            key={o.id}
            title={`${o.numero} · ${o.tipo} · ${o.estado}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!modoEdicion) abrirModal(o.id);
            }}
            style={{
              position: "absolute",
              left: `${o.mapa_x}%`,
              top: `${o.mapa_y}%`,
              transform: "translate(-50%, -50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: colorPorEstado(o.estado),
              border: "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
              cursor: modoEdicion ? "default" : "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: "#666" }}>
        <span>🟢 Disponible</span>
        <span>🔵 Ocupada</span>
        <span>⚪ Otro estado</span>
      </div>

      {oficinas.length > 0 && (
        <div className="oficinas-grid">
          {oficinas.map((o) => (
            <button
              key={o.id}
              type="button"
              className="oficina-box"
              title={`${o.numero} · ${o.tipo} · ${o.estado}`}
              onClick={() => abrirModal(o.id)}
            >
              <span className="oficina-box-dot" style={{ background: colorPorEstado(o.estado) }} />
              <span className="oficina-box-numero">{o.numero}</span>
              <span className="oficina-box-tipo">{o.tipo}</span>
            </button>
          ))}
        </div>
      )}

      {modalAbierto && (
        <ModalDisponibilidad
          centro={centro}
          oficinas={oficinas}
          oficinaIdInicial={oficinaParaModal}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </div>
  );
}
