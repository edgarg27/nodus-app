"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { verificarDisponibilidadOficina, type ResultadoDisponibilidad } from "@/lib/disponibilidadOficina";

type Oficina = { id: string; numero: string; tipo: string; paquete_default_id: string | null };
type Paquete = {
  id: string;
  nombre: string;
  tipo_espacio: string | null;
  precio_hora: number | null;
  precio_dia: number | null;
  precio_semana: number | null;
  precio_mes: number | null;
};

const MODALIDADES = ["Hora", "Día", "Semana", "Mes"] as const;
type Modalidad = (typeof MODALIDADES)[number];

function tarifaPaquete(p: Paquete | null, modalidad: string): number | null {
  if (!p) return null;
  if (modalidad === "Hora") return p.precio_hora;
  if (modalidad === "Día") return p.precio_dia;
  if (modalidad === "Semana") return p.precio_semana;
  if (modalidad === "Mes") return p.precio_mes;
  return null;
}

function formatFechaISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sumarPeriodo(fechaISO: string, modalidad: string, cantidad: number) {
  const f = new Date(fechaISO + "T00:00:00");
  if (modalidad === "Día") f.setDate(f.getDate() + cantidad);
  else if (modalidad === "Semana") f.setDate(f.getDate() + cantidad * 7);
  else f.setMonth(f.getMonth() + cantidad); // Mes (y default)
  return formatFechaISO(f);
}

export default function ModalDisponibilidad({
  centro,
  oficinas,
  oficinaIdInicial,
  onClose,
}: {
  centro: string;
  oficinas: Oficina[];
  oficinaIdInicial: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  useEffect(() => {
    supabase
      .from("paquetes")
      .select("id, nombre, tipo_espacio, precio_hora, precio_dia, precio_semana, precio_mes")
      .eq("centro", centro)
      .then(({ data }) => setPaquetes(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  const [oficinaId, setOficinaId] = useState(oficinaIdInicial || "");
  const oficina = oficinas.find((o) => o.id === oficinaId) || null;

  const paquetesDelTipo = useMemo(
    () => (oficina ? paquetes.filter((p) => p.tipo_espacio === oficina.tipo) : []),
    [paquetes, oficina]
  );

  const [paqueteId, setPaqueteId] = useState("");
  const [paqueteBloqueado, setPaqueteBloqueado] = useState(false);
  const paquete = paquetes.find((p) => p.id === paqueteId) || null;

  // Mismo mecanismo de auto-bloqueo por `paquete_default_id` que
  // CotizarForm.tsx — reimplementado aquí porque este es un componente
  // independiente.
  useEffect(() => {
    if (!oficina) {
      setPaqueteId("");
      setPaqueteBloqueado(false);
      return;
    }
    if (oficina.paquete_default_id) {
      const p = paquetes.find((x) => x.id === oficina.paquete_default_id) || null;
      if (p) {
        setPaqueteId(p.id);
        setPaqueteBloqueado(true);
        const disponibles = MODALIDADES.filter((m) => tarifaPaquete(p, m) != null);
        setModalidad(disponibles.includes("Mes") ? "Mes" : (disponibles[0] as Modalidad) || "Mes");
        return;
      }
    }
    setPaqueteId("");
    setPaqueteBloqueado(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oficina?.id, paquetes]);

  function elegirPaquete(id: string) {
    if (paqueteBloqueado) return;
    setPaqueteId(id);
  }

  const [fechaInicio, setFechaInicio] = useState(formatFechaISO(new Date()));
  // Si no hay paquete elegido, la modalidad queda fija en "Mes" (tarifa
  // directa de la oficina) — la elección de Hora/Día/Semana solo tiene
  // sentido cuando hay un paquete con esas tarifas definidas.
  const [modalidad, setModalidad] = useState<Modalidad>("Mes");
  const [cantidad, setCantidad] = useState("1");
  const modalidadEfectiva: Modalidad = paquete ? modalidad : "Mes";

  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDisponibilidad | null>(null);
  const [claveVerificada, setClaveVerificada] = useState("");

  const clave = `${oficinaId}|${paqueteId}|${fechaInicio}|${modalidadEfectiva}|${cantidad}`;
  const verificado = resultado !== null && clave === claveVerificada;

  async function verificar() {
    if (!oficinaId || !fechaInicio) return;
    setVerificando(true);
    const fechaFin = sumarPeriodo(fechaInicio, modalidadEfectiva, Number(cantidad) || 1);
    const res = await verificarDisponibilidadOficina(supabase, {
      oficinaId,
      fechaInicio,
      fechaFin,
      modalidad: modalidadEfectiva,
      horaInicio: modalidadEfectiva === "Hora" ? 9 : undefined,
      horaFin: modalidadEfectiva === "Hora" ? 10 : undefined,
    });
    setResultado(res);
    setClaveVerificada(clave);
    setVerificando(false);
  }

  function continuarARegistrarPlan() {
    if (!oficina) return;
    const params = new URLSearchParams({
      centro,
      tipoEspacio: oficina.tipo,
      oficinaId,
      fechaInicio,
      modalidad: modalidadEfectiva,
      cantidad,
    });
    if (paqueteId) params.set("paqueteId", paqueteId);
    router.push(`/registrar-plan?${params.toString()}`);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="modal-nombre">🔍 Verificar disponibilidad</p>

        <p className="sub-label">Oficina</p>
        <select
          value={oficinaId}
          onChange={(e) => {
            setOficinaId(e.target.value);
            setResultado(null);
          }}
        >
          <option value="">Selecciona una oficina</option>
          {oficinas.map((o) => (
            <option key={o.id} value={o.id}>
              {o.numero} · {o.tipo}
            </option>
          ))}
        </select>

        {oficina && paquetesDelTipo.length > 0 && (
          <>
            <p className="sub-label" style={{ marginTop: 8 }}>
              Paquete (opcional)
            </p>
            <select value={paqueteId} onChange={(e) => elegirPaquete(e.target.value)} disabled={paqueteBloqueado}>
              <option value="">Sin paquete (tarifa directa de la oficina)</option>
              {paquetesDelTipo.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            {paqueteBloqueado && (
              <p style={{ fontSize: 11, color: "#a3701f", margin: "4px 0 0" }}>
                🔒 Este paquete se asignó automáticamente por la oficina elegida y no se puede cambiar.
              </p>
            )}
          </>
        )}

        <p className="sub-label" style={{ marginTop: 8 }}>
          Fecha de inicio
        </p>
        <input
          type="date"
          value={fechaInicio}
          onChange={(e) => {
            setFechaInicio(e.target.value);
            setResultado(null);
          }}
        />

        <div className="tel-form-grid" style={{ marginTop: 8 }}>
          <div>
            <p className="sub-label">Modalidad</p>
            <select
              value={modalidadEfectiva}
              disabled={!paquete}
              onChange={(e) => {
                setModalidad(e.target.value as Modalidad);
                setResultado(null);
              }}
            >
              {MODALIDADES.map((m) => (
                <option key={m} value={m} disabled={!!paquete && tarifaPaquete(paquete, m) == null}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="sub-label">Cantidad</p>
            <input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => {
                setCantidad(e.target.value);
                setResultado(null);
              }}
            />
          </div>
        </div>

        <button
          className="tel-borrar-btn"
          style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 10 }}
          disabled={!oficinaId || !fechaInicio || verificando}
          onClick={verificar}
        >
          {verificando ? "Verificando..." : "Verificar disponibilidad"}
        </button>

        {verificado && resultado && (
          <p
            style={{
              fontSize: 13,
              marginTop: 8,
              color: resultado.disponible ? "#0F6E56" : "#A32D2D",
              fontWeight: 600,
            }}
          >
            {resultado.disponible ? "✓ Disponible" : `✗ Ocupado — ${resultado.motivo}`}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="tel-borrar-btn" onClick={onClose}>
            Cerrar
          </button>
          <button
            className="reservar-btn"
            disabled={!verificado || !resultado?.disponible}
            onClick={continuarARegistrarPlan}
          >
            Continuar a Registrar Plan →
          </button>
        </div>
      </div>
    </div>
  );
}
