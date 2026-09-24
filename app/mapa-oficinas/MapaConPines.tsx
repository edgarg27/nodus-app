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

// "libre" es un valor heredado de datos viejos con el mismo significado
// que "disponible" — sin este alias se pintaba gris (como "otro estado")
// en vez de verde, dando la falsa impresión de que la oficina no estaba
// libre de verdad.
const ESTADO_ALIAS: Record<string, string> = { libre: "disponible" };

// El pin no es un emoji — un emoji no se puede colorear vía CSS.
const COLOR_POR_ESTADO: Record<string, string> = {
  disponible: "#0F6E56", // verde
  ocupada: "#185FA5", // azul
  mantenimiento: "#8A8A8A", // gris
};
const COLOR_DEFAULT = "#8A8A8A"; // gris — cualquier otro valor de estado

const LABEL_POR_ESTADO: Record<string, string> = {
  disponible: "Disponible",
  ocupada: "Ocupada",
  mantenimiento: "Mantenimiento",
};

function estadoCanonico(estado: string) {
  return ESTADO_ALIAS[estado] || estado;
}

function colorPorEstado(estado: string) {
  return COLOR_POR_ESTADO[estadoCanonico(estado)] || COLOR_DEFAULT;
}

function labelEstado(estado: string) {
  return LABEL_POR_ESTADO[estadoCanonico(estado)] || "Otro estado";
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

  // Guarda la posición (en % del plano) de un pin. Se actualiza en pantalla
  // de inmediato y luego se relee para confirmar lo guardado.
  async function guardarPosicion(id: string, x: number, y: number) {
    setOficinas((prev) => prev.map((o) => (o.id === id ? { ...o, mapa_x: x, mapa_y: y } : o)));
    setColocando(true);
    // .select() para saber si de verdad se actualizó: con RLS un update sin
    // permiso no da error, solo regresa cero filas.
    const { data, error } = await supabase.from("oficinas").update({ mapa_x: x, mapa_y: y }).eq("id", id).select("id");
    setColocando(false);
    if (error || !data || data.length === 0) {
      alert("No se pudo guardar la posición del pin (¿tu usuario tiene permiso para editar oficinas?).");
    }
    fetchOficinas();
  }

  // Alternativa al arrastre: elegir una oficina de la bandeja (clic) y dar
  // clic en el plano.
  async function colocarPin(e: React.MouseEvent<HTMLImageElement>) {
    if (!modoEdicion || !oficinaAColocar || !imgRef.current) return;
    const p = coordsEnMapa(e.clientX, e.clientY);
    const id = oficinaAColocar;
    setOficinaAColocar("");
    await guardarPosicion(id, limitar(p.x), limitar(p.y));
  }

  // ---- Arrastrar pines (mouse y pantalla táctil) ----
  // Un pin ya colocado se mueve arrastrándolo; una oficina de la bandeja
  // (sin pin) se arrastra hasta el plano. Un toque sin movimiento sobre una
  // oficina de la bandeja la deja seleccionada para colocarla con un clic.
  type Arrastre = { id: string; origen: "pin" | "bandeja"; x: number; y: number; cx: number; cy: number };
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const arrastreRef = useRef<Arrastre | null>(null);
  const inicioRef = useRef({ x: 0, y: 0 });
  const seMovioRef = useRef(false);

  const limitar = (n: number) => Math.min(100, Math.max(0, n));

  function coordsEnMapa(clientX: number, clientY: number) {
    const rect = imgRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * 100, y: ((clientY - rect.top) / rect.height) * 100 };
  }

  function iniciarArrastre(e: React.PointerEvent, id: string, origen: "pin" | "bandeja") {
    if (!modoEdicion || !imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const p = coordsEnMapa(e.clientX, e.clientY);
    const a: Arrastre = { id, origen, x: limitar(p.x), y: limitar(p.y), cx: e.clientX, cy: e.clientY };
    arrastreRef.current = a;
    inicioRef.current = { x: e.clientX, y: e.clientY };
    seMovioRef.current = false;
    setArrastre(a);
  }

  useEffect(() => {
    if (!arrastre) return;
    const mover = (ev: PointerEvent) => {
      const a = arrastreRef.current;
      if (!a || !imgRef.current) return;
      if (Math.hypot(ev.clientX - inicioRef.current.x, ev.clientY - inicioRef.current.y) > 4) seMovioRef.current = true;
      const p = coordsEnMapa(ev.clientX, ev.clientY);
      const n = { ...a, x: limitar(p.x), y: limitar(p.y), cx: ev.clientX, cy: ev.clientY };
      arrastreRef.current = n;
      setArrastre(n);
    };
    const soltar = (ev: PointerEvent) => {
      const a = arrastreRef.current;
      arrastreRef.current = null;
      setArrastre(null);
      if (!a || !imgRef.current || ev.type === "pointercancel") return;
      if (!seMovioRef.current) {
        if (a.origen === "bandeja") setOficinaAColocar((prev) => (prev === a.id ? "" : a.id));
        return;
      }
      const p = coordsEnMapa(ev.clientX, ev.clientY);
      const dentro = p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
      if (a.origen === "bandeja" && !dentro) return; // la soltó fuera del plano
      guardarPosicion(a.id, limitar(p.x), limitar(p.y));
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrastre?.id]);

  // ---- Modal de disponibilidad ----
  const [modalAbierto, setModalAbierto] = useState(false);
  const [oficinaParaModal, setOficinaParaModal] = useState<string | null>(null);

  function abrirModal(oficinaId: string | null) {
    setOficinaParaModal(oficinaId);
    setModalAbierto(true);
  }

  // Los espacios de Coworking (A, AA, AB… ~350 en Bosques) no se ubican uno
  // por uno en el plano: si no tienen pin no se listan aquí ni en "Colocar
  // pines" (llenarían la pantalla). La ventana de disponibilidad sí sigue
  // recibiendo todas las oficinas, y cualquiera que ya tenga pin se sigue
  // mostrando normal.
  const oficinasVisibles = oficinas.filter(
    (o) => !(o.tipo?.trim().toLowerCase() === "coworking" && (o.mapa_x == null || o.mapa_y == null))
  );
  const oficinasConPin = oficinasVisibles.filter((o) => o.mapa_x != null && o.mapa_y != null);
  const oficinasSinPin = oficinasVisibles.filter((o) => o.mapa_x == null || o.mapa_y == null);

  // Bandeja de oficinas sin pin: un centro puede tener cientos (Bosques tiene
  // 351 puestos de coworking), así que se filtra y se limita lo que se dibuja.
  const MAX_BANDEJA = 60;
  const [busquedaBandeja, setBusquedaBandeja] = useState("");
  const [tipoBandeja, setTipoBandeja] = useState("");
  const tiposSinPin = Array.from(new Set(oficinasSinPin.map((o) => o.tipo))).sort((a, b) => a.localeCompare(b, "es"));
  const textoBandeja = busquedaBandeja.trim().toLowerCase();
  const bandejaFiltrada = oficinasSinPin.filter(
    (o) =>
      (!tipoBandeja || o.tipo === tipoBandeja) &&
      (!textoBandeja || `${o.numero} ${o.tipo}`.toLowerCase().includes(textoBandeja))
  );

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
          <p className="sub-label">
            Arrastra cada oficina al lugar que le corresponde en el plano. Los pines ya colocados también se arrastran
            para moverlos.
          </p>
          {oficinasSinPin.length > 0 ? (
            <>
              <p className="sub-label" style={{ marginTop: 4 }}>
                Sin colocar ({oficinasSinPin.length}) — arrástralas al plano, o toca una y da clic donde va
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Buscar por número o tipo"
                  value={busquedaBandeja}
                  onChange={(e) => setBusquedaBandeja(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <select value={tipoBandeja} onChange={(e) => setTipoBandeja(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="">Todos los tipos</option>
                  {tiposSinPin.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {bandejaFiltrada.length > MAX_BANDEJA && (
                <p className="item-card-sub" style={{ margin: 0 }}>
                  Mostrando {MAX_BANDEJA} de {bandejaFiltrada.length}: afina con el buscador o el tipo.
                </p>
              )}
              <div className="mapa-bandeja">
                {bandejaFiltrada.slice(0, MAX_BANDEJA).map((o) => (
                  <div
                    key={o.id}
                    className={`mapa-chip${oficinaAColocar === o.id ? " mapa-chip-sel" : ""}`}
                    onPointerDown={(e) => iniciarArrastre(e, o.id, "bandeja")}
                  >
                    <span className="oficina-box-dot" style={{ background: colorPorEstado(o.estado) }} />
                    {o.numero} · {o.tipo}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="nota-info" style={{ margin: 0 }}>
              ✓ Todas las oficinas de este centro ya tienen su pin.
            </p>
          )}
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
        {oficinasConPin.map((o) => {
          const moviendo = arrastre?.origen === "pin" && arrastre.id === o.id;
          const x = moviendo ? arrastre!.x : o.mapa_x;
          const y = moviendo ? arrastre!.y : o.mapa_y;
          return (
            <button
              key={o.id}
              title={`${o.numero} · ${o.tipo} · ${labelEstado(o.estado)}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!modoEdicion) abrirModal(o.id);
              }}
              onPointerDown={(e) => iniciarArrastre(e, o.id, "pin")}
              style={{
                position: "absolute",
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                // Crece con el plano: más ancho el layout, pin más grande.
                width: "clamp(16px, 2%, 30px)",
                aspectRatio: "1",
                borderRadius: "50%",
                background: colorPorEstado(o.estado),
                border: "2px solid white",
                boxShadow: moviendo ? "0 4px 12px rgba(0,0,0,0.5)" : "0 1px 4px rgba(0,0,0,0.4)",
                cursor: modoEdicion ? (moviendo ? "grabbing" : "grab") : "pointer",
                touchAction: modoEdicion ? "none" : undefined,
                zIndex: moviendo ? 5 : undefined,
                padding: 0,
              }}
            >
              {modoEdicion && <span className="mapa-pin-etiqueta">{o.numero}</span>}
            </button>
          );
        })}
      </div>

      {arrastre?.origen === "bandeja" && (
        <div className="mapa-fantasma" style={{ left: arrastre.cx, top: arrastre.cy }}>
          {oficinas.find((o) => o.id === arrastre.id)?.numero}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: "#666" }}>
        <span>🟢 Disponible</span>
        <span>🔵 Ocupada</span>
        <span>⚪ Mantenimiento / otro estado</span>
      </div>

      {oficinasVisibles.length > 0 && (
        <div className="oficinas-grid">
          {oficinasVisibles.map((o) => (
            <button
              key={o.id}
              type="button"
              className="oficina-box"
              title={`${o.numero} · ${o.tipo} · ${labelEstado(o.estado)}`}
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
