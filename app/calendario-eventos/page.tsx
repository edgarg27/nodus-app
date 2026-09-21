"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { diasSinServicio, proximosDiasSinServicio, type DiaCentro } from "@/lib/festivosMx";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Los eventos los captura el staff en Experiencia del cliente → Eventos
// (tabla eventos_centro: fecha, hora y lugar son opcionales salvo la fecha).
type Evento = {
  id: string;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  hora: string | null;
  lugar: string | null;
  descripcion: string | null;
};

// "2026-11-15" → Date local a medianoche (new Date("YYYY-MM-DD") lo
// interpretaría en UTC y en México saldría un día antes).
function fechaLocal(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function hoyISO() {
  const h = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}`;
}

function mesDe(f: string) {
  const t = fechaLocal(f).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fechaLarga(f: string) {
  return fechaLocal(f).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function CalendarioEventosPage() {
  const supabase = createClient();
  const [centro, setCentro] = useState<string | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [verPasados, setVerPasados] = useState(false);
  const hoyFecha = new Date();
  const [mesVisto, setMesVisto] = useState(hoyFecha.getMonth());
  const [anioVisto, setAnioVisto] = useState(hoyFecha.getFullYear());
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [diasCentro, setDiasCentro] = useState<DiaCentro[]>([]);
  // Fecha de nacimiento del propio cliente (solo la suya, nunca la de otros).
  const [miCumple, setMiCumple] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      // El centro sale del perfil del cliente — no lo elige él, así siempre
      // ve solo los eventos de su propio centro.
      const { data: perfil } = await supabase.from("profiles").select("centro, email").eq("id", user.id).single();
      const c = perfil?.centro || null;
      setCentro(c);
      if (c) {
        const [{ data }, { data: dias }] = await Promise.all([
          supabase
            .from("eventos_centro")
            .select("id, titulo, fecha, hora, lugar, descripcion")
            .eq("centro", c)
            .order("fecha", { ascending: true }),
          supabase.from("dias_centro").select("id, fecha, tipo, motivo").eq("centro", c),
        ]);
        setEventos((data as Evento[]) || []);
        setDiasCentro((dias as DiaCentro[]) || []);

        // Cumpleaños: el staff los captura como contactos (tabla clientes)
        // y se ligan con esta cuenta por el correo. Solo se consulta el
        // contacto con el MISMO correo del cliente — los demás no llegan
        // nunca al navegador. (\ escapa _ y % que en ILIKE son comodines.)
        const correo = (perfil?.email || user.email || "").trim().toLowerCase();
        if (correo) {
          const patron = correo.replace(/[\\%_]/g, (ch) => "\\" + ch);
          const { data: yo } = await supabase
            .from("clientes")
            .select("fecha_nacimiento, email")
            .eq("centro", c)
            .ilike("email", patron);
          const mio = (yo || []).find((x) => (x.email || "").trim().toLowerCase() === correo);
          setMiCumple(mio?.fecha_nacimiento || null);
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoy = hoyISO();

  // ---------- Calendario de mes ----------
  const pad = (n: number) => String(n).padStart(2, "0");
  const primerDiaSemana = new Date(anioVisto, mesVisto, 1).getDay();
  const diasEnMes = new Date(anioVisto, mesVisto + 1, 0).getDate();
  const celdas: (number | null)[] = [
    ...Array(primerDiaSemana).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];
  const isoDia = (dia: number) => `${anioVisto}-${pad(mesVisto + 1)}-${pad(dia)}`;
  const festivosDelAnio = useMemo(() => diasSinServicio(anioVisto, diasCentro), [anioVisto, diasCentro]);
  // Día del mes del cumpleaños propio, si cae en el mes que se está viendo.
  const diaMiCumple = useMemo(() => {
    if (!miCumple) return null;
    const [, mes, dia] = miCumple.split("-").map(Number);
    return mes - 1 === mesVisto ? dia : null;
  }, [miCumple, mesVisto]);
  const eventosPorFecha = useMemo(() => {
    const map: Record<string, Evento[]> = {};
    eventos.forEach((ev) => {
      (map[ev.fecha] = map[ev.fecha] || []).push(ev);
    });
    return map;
  }, [eventos]);
  const proxFestivos = useMemo(() => proximosDiasSinServicio(hoy, 3, diasCentro), [hoy, diasCentro]);

  function cambiarMes(delta: number) {
    let m = mesVisto + delta;
    let a = anioVisto;
    if (m < 0) {
      m = 11;
      a--;
    } else if (m > 11) {
      m = 0;
      a++;
    }
    setMesVisto(m);
    setAnioVisto(a);
    setDiaAbierto(null);
  }

  const proximos = eventos.filter((ev) => ev.fecha >= hoy);
  const pasados = eventos.filter((ev) => ev.fecha < hoy).reverse();
  const visibles = verPasados ? pasados : proximos;

  // Agrupa por mes conservando el orden.
  const grupos: { mes: string; items: Evento[] }[] = [];
  visibles.forEach((ev) => {
    const mes = mesDe(ev.fecha);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === mes) ultimo.items.push(ev);
    else grupos.push({ mes, items: [ev] });
  });

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Calendario de eventos</p>
        <p className="rep-sub">{centro || "Tu centro"}</p>
      </div>

      <div className="rep-content">
        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => cambiarMes(-1)}>
                ‹ Anterior
              </button>
              <p className="panel-section-label" style={{ margin: 0 }}>
                {MESES[mesVisto]} {anioVisto}
              </p>
              <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => cambiarMes(1)}>
                Siguiente ›
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {["D", "L", "M", "M", "J", "V", "S"].map((d, i) => (
                <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#999", fontWeight: 600 }}>
                  {d}
                </div>
              ))}
              {celdas.map((dia, i) => {
                if (!dia) return <div key={i} />;
                const fechaDia = isoDia(dia);
                const festivo = festivosDelAnio[fechaDia];
                const evs = eventosPorFecha[fechaDia] || [];
                const esMiCumple = diaMiCumple === dia;
                const tieneContenido = !!festivo || evs.length > 0 || esMiCumple;
                const esHoy = fechaDia === hoy;
                return (
                  <div
                    key={i}
                    onClick={() => tieneContenido && setDiaAbierto(diaAbierto === fechaDia ? null : fechaDia)}
                    style={{
                      minHeight: 48,
                      borderRadius: 8,
                      background: festivo ? "#FBE9E9" : "#F7F7F7",
                      padding: 4,
                      cursor: tieneContenido ? "pointer" : "default",
                      border: diaAbierto === fechaDia ? "2px solid #0d1b3e" : esHoy ? "2px solid #f07e3a" : "1px solid transparent",
                    }}
                  >
                    <p style={{ fontSize: 12, margin: 0, color: festivo ? "#A32D2D" : "#555", fontWeight: esHoy ? 700 : 400 }}>
                      {dia}
                    </p>
                    <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      {festivo && <span style={{ fontSize: 11 }}>🚫</span>}
                      {esMiCumple && <span style={{ fontSize: 11 }}>🎂</span>}
                      {evs.length > 0 && <span style={{ fontSize: 11 }}>🎪</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "#888", margin: "8px 0 0" }}>
              🎪 Evento · 🚫 Día sin servicio, el centro no abre{miCumple ? " · 🎂 Tu cumpleaños" : ""}
            </p>

            {diaAbierto && (
              <div className="form-card" style={{ marginTop: 10 }}>
                <p className="sub-label">{fechaLarga(diaAbierto)}</p>
                {festivosDelAnio[diaAbierto] && (
                  <p className="contrato-detalle" style={{ color: "#A32D2D", fontWeight: 600 }}>
                    🚫 {festivosDelAnio[diaAbierto]} — el centro no abre este día
                  </p>
                )}
                {diaMiCumple !== null && diaAbierto === `${anioVisto}-${pad(mesVisto + 1)}-${pad(diaMiCumple)}` && (
                  <p className="contrato-detalle">🎂 ¡Tu cumpleaños!</p>
                )}
                {(eventosPorFecha[diaAbierto] || []).map((ev) => (
                  <p className="contrato-detalle" key={ev.id}>
                    🎪 {ev.titulo}
                    {ev.hora ? ` · ${ev.hora}` : ""}
                    {ev.lugar ? ` · ${ev.lugar}` : ""}
                  </p>
                ))}
              </div>
            )}

            {proxFestivos.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p className="panel-section-label">🚫 Próximos días sin servicio (el centro no abre)</p>
                {proxFestivos.map((f) => (
                  <div className="item-card" key={f.fecha} style={{ marginBottom: 6, flexDirection: "column", alignItems: "stretch" }}>
                    <div className="item-card-info">
                      <p className="item-card-titulo">{f.nombre}</p>
                      <p className="item-card-sub">{fechaLarga(f.fecha)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                📅 {verPasados ? "Eventos pasados" : "Próximos eventos"}
              </p>
              {pasados.length > 0 || verPasados ? (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600 }}
                  onClick={() => setVerPasados((v) => !v)}
                >
                  {verPasados ? "Ver próximos" : "Ver pasados"}
                </button>
              ) : null}
            </div>

            {visibles.length === 0 ? (
              <div className="empty-card">
                {verPasados ? "No hay eventos pasados" : `Por ahora no hay eventos programados en ${centro}`}
              </div>
            ) : (
              grupos.map((g) => (
                <div key={g.mes}>
                  <p className="sub-label" style={{ margin: "12px 0 6px", fontWeight: 700, color: "#0d1b3e" }}>
                    {g.mes}
                  </p>
                  {g.items.map((ev) => (
                    <div
                      className="item-card"
                      key={ev.id}
                      style={{ marginBottom: 8, flexDirection: "column", alignItems: "stretch", opacity: verPasados ? 0.75 : 1 }}
                    >
                      <div className="item-card-info">
                        <p className="item-card-titulo">{ev.titulo}</p>
                        <p className="item-card-sub">
                          {fechaLarga(ev.fecha)}
                          {ev.hora ? ` · ${ev.hora}` : ""}
                        </p>
                        {ev.lugar && <p className="item-card-extra">📍 {ev.lugar}</p>}
                        {ev.descripcion && (
                          <p className="item-card-extra" style={{ whiteSpace: "pre-line" }}>
                            {ev.descripcion}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
