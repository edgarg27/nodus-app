"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type DayPassRow = {
  id: string;
  folio: number;
  tipo: "coworking" | "oficina_privada";
  centro: string;
  nombre: string;
  fecha: string; // 'YYYY-MM-DD'
  usado: boolean;
  usado_en: string | null;
  aceptado_por_nombre: string | null;
};

// Fecha de hoy en 'YYYY-MM-DD', en horario local (no UTC), para comparar
// directo contra pase.fecha sin desfases de zona horaria.
function hoyISO() {
  return new Date().toLocaleDateString("en-CA");
}

export default function DayPassCheckin({ id, miNombre }: { id: string; miNombre: string }) {
  const supabase = createClient();
  const [pase, setPase] = useState<DayPassRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aceptando, setAceptando] = useState(false);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function cargar() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("day_passes")
      .select("id, folio, tipo, centro, nombre, fecha, usado, usado_en, aceptado_por_nombre")
      .eq("id", id)
      .maybeSingle();
    if (fetchError || !data) {
      setError("Day Pass no encontrado");
      setPase(null);
    } else {
      setError("");
      setPase(data as DayPassRow);
    }
    setLoading(false);
  }

  async function aceptar() {
    if (!pase) return;
    setAceptando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // El .eq("usado", false) evita que, si dos personas lo escanean casi
    // al mismo tiempo, se sobreescriba quién lo aceptó primero.
    const { error: updateError } = await supabase
      .from("day_passes")
      .update({
        usado: true,
        usado_en: new Date().toISOString(),
        aceptado_por: user?.id,
        aceptado_por_nombre: miNombre,
      })
      .eq("id", pase.id)
      .eq("usado", false);
    setAceptando(false);
    if (updateError) {
      setError("No se pudo aceptar el Day Pass. Intenta de nuevo.");
      return;
    }
    cargar();
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando Day Pass...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!pase) {
    return (
      <div className="panel">
        <div className="sub-content">
          <div className="empty-card">{error || "Day Pass no encontrado"}</div>
        </div>
      </div>
    );
  }

  const hoy = hoyISO();
  const folioMostrar = "NODUS-" + String(pase.folio).padStart(3, "0");
  const tipoLabel = pase.tipo === "coworking" ? "Coworking" : "Oficina privada";

  let estado: "usado" | "vencido" | "futuro" | "listo" = "listo";
  if (pase.usado) estado = "usado";
  else if (pase.fecha < hoy) estado = "vencido";
  else if (pase.fecha > hoy) estado = "futuro";

  return (
    <div className="panel">
      <div className="rep-header">
        <p className="rep-title">Check-in de Day Pass</p>
        <p className="rep-sub">{folioMostrar}</p>
      </div>
      <div className="sub-content">
        <div className={`checkin-card checkin-${estado}`}>
          <p className="checkin-nombre">{pase.nombre}</p>

          <div className="checkin-detail-row">
            <span>Tipo</span>
            <strong>{tipoLabel}</strong>
          </div>
          <div className="checkin-detail-row">
            <span>Centro</span>
            <strong>{pase.centro}</strong>
          </div>
          <div className="checkin-detail-row">
            <span>Válido para</span>
            <strong>{pase.fecha}</strong>
          </div>

          {estado === "usado" && (
            <p className="checkin-msg checkin-msg-ok">
              ✅ Aceptado{pase.aceptado_por_nombre ? ` por ${pase.aceptado_por_nombre}` : ""}
              {pase.usado_en ? ` · ${new Date(pase.usado_en).toLocaleString("es-MX")}` : ""}
            </p>
          )}
          {estado === "vencido" && (
            <p className="checkin-msg checkin-msg-warn">
              ⚠️ Este Day Pass venció — era válido solo el {pase.fecha}.
            </p>
          )}
          {estado === "futuro" && (
            <p className="checkin-msg checkin-msg-warn">
              ⚠️ Este Day Pass es para el {pase.fecha}, todavía no aplica.
            </p>
          )}
          {error && <p className="checkin-msg checkin-msg-warn">{error}</p>}

          {estado === "listo" && (
            <button className="checkin-btn-aceptar" onClick={aceptar} disabled={aceptando}>
              {aceptando ? "Aceptando..." : "✅ Aceptar llegada"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
