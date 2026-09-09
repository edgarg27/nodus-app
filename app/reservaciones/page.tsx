"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const HORAS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8am a 8pm
const COLORES_CONFETTI = ["#f07e3a", "#0d1b3e", "#2bbd7e", "#ffd166", "#5b8dee"];

const ESPACIOS_DEFAULT = [
  { id: "Sala de Juntas A", icono: "🤝" },
  { id: "Sala de Juntas B", icono: "🤝" },
  { id: "Coworking", icono: "💻" },
  { id: "Sala de Capacitación", icono: "📚" },
];

// Algunos centros solo tienen una sala real — se muestra únicamente esa,
// en vez de las 4 opciones genéricas.
const ESPACIOS_POR_CENTRO: Record<string, { id: string; icono: string }[]> = {
  Bosques: [{ id: "Sala de 10 personas", icono: "🤝" }],
};

// startsWith en vez de igualdad exacta para poder clasificar también
// oficinas numeradas armadas dinámicamente (ej. "Coworking 1", "Coworking 2")
// en centros sin un espacio genérico de Coworking en el catálogo estático.
function esSalaDeJuntas(espacio: string) {
  return !espacio.startsWith("Coworking") && !espacio.startsWith("Sala de Capacitación");
}

// Festivos oficiales de México (ajusta/agrega según el año)
const DIAS_FESTIVOS_MX = [
  "2026-01-01", // Año Nuevo
  "2026-02-02", // Día de la Constitución (observado)
  "2026-03-16", // Natalicio de Benito Juárez (observado)
  "2026-05-01", // Día del Trabajo
  "2026-09-16", // Independencia
  "2026-11-16", // Revolución (observado)
  "2026-12-25", // Navidad
];

function esFueraDeHorario(fechaISO: string, hora: number) {
  if (DIAS_FESTIVOS_MX.includes(fechaISO)) return true;
  const dia = new Date(fechaISO + "T00:00:00").getDay(); // 0 = domingo, 6 = sábado
  if (dia === 0) return true; // domingo, todo el día
  if (dia === 6 && hora >= 14) return true; // sábado después de las 2pm
  if (dia >= 1 && dia <= 5 && hora >= 20) return true; // entre semana después de las 8pm
  return false;
}

function lunesDeLaSemana(fecha: Date) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatFechaISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatHora(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

type Reservacion = {
  id: string;
  espacio: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
};

type CoffeeBreakPaquete = {
  id: string;
  numero: number;
  nombre: string;
  precio_persona: number;
  alimentos: string;
  bebidas: string;
  minimo_personas: number;
  activo: boolean;
  promocion_activa: boolean;
  descuento_porcentaje: number;
  promocion_hasta: string | null;
  promocion_texto: string | null;
};

type Seleccion = { fecha: string; horaInicio: number; horaFin: number } | null;
type Categoria = "sala" | "bolsa";

function ReservacionesInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoriaDesdeUrl: Categoria = searchParams.get("categoria") === "bolsa" ? "bolsa" : "sala";
  const contratoIdDesdeUrl = searchParams.get("contratoId") || "";

  const [categoria, setCategoria] = useState<Categoria>(categoriaDesdeUrl);
  const [espacio, setEspacio] = useState("");
  const [inicioSemana, setInicioSemana] = useState(lunesDeLaSemana(new Date()));
  const [reservas, setReservas] = useState<Reservacion[]>([]);
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const [contratoId, setContratoId] = useState("");
  const [horasSalaTotales, setHorasSalaTotales] = useState(0);
  const [horasSalaRestantes, setHorasSalaRestantes] = useState(0);
  const [horasBolsaTotales, setHorasBolsaTotales] = useState(0);
  const [horasBolsaRestantes, setHorasBolsaRestantes] = useState(0);
  const [oficinasBolsaDelCentro, setOficinasBolsaDelCentro] = useState<{ id: string; icono: string }[]>([]);
  const [precioHoraExtra, setPrecioHoraExtra] = useState(150);
  const [miCentro, setMiCentro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);

  const confettiReservacion = useMemo(() => {
    if (!enviado) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      duracion: 1.8 + Math.random() * 0.9,
      color: COLORES_CONFETTI[i % COLORES_CONFETTI.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enviado]);

  // ---- Coffee Break opcional (modal dentro del flujo de reserva) ----
  const [modalCoffeeAbierto, setModalCoffeeAbierto] = useState(false);
  const [coffeeBreakPaquetes, setCoffeeBreakPaquetes] = useState<CoffeeBreakPaquete[]>([]);
  const [quiereCoffee, setQuiereCoffee] = useState<boolean | null>(null);
  const [paqueteCoffeeId, setPaqueteCoffeeId] = useState<string | null>(null);
  const [personasCoffee, setPersonasCoffee] = useState<number | "">("");

  useEffect(() => {
    supabase
      .from("coffee_break_paquetes")
      .select("*")
      .eq("activo", true)
      .then(({ data }) => setCoffeeBreakPaquetes(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paqueteCoffee = coffeeBreakPaquetes.find((p) => p.id === paqueteCoffeeId) || null;
  const personasCoffeeNum = Number(personasCoffee) || 0;
  const coffeeBreakFaltaMinimo = !!(
    paqueteCoffee && personasCoffeeNum > 0 && personasCoffeeNum < paqueteCoffee.minimo_personas
  );
  const totalCoffeeBreak = paqueteCoffee
    ? paqueteCoffee.precio_persona * personasCoffeeNum * (paqueteCoffee.promocion_activa ? 1 - paqueteCoffee.descuento_porcentaje / 100 : 1)
    : 0;

  function abrirModalCoffee() {
    if (!seleccion) return;
    setQuiereCoffee(null);
    setPaqueteCoffeeId(null);
    setPersonasCoffee("");
    setError("");
    setModalCoffeeAbierto(true);
  }

  function continuarConReserva() {
    setError("");
    if (quiereCoffee) {
      if (!paqueteCoffeeId) {
        setError("Elige un paquete de coffee break");
        return;
      }
      if (!personasCoffeeNum || coffeeBreakFaltaMinimo) {
        setError(`Ese paquete requiere un mínimo de ${paqueteCoffee?.minimo_personas} persona(s)`);
        return;
      }
    }
    setModalCoffeeAbierto(false);
    confirmarReserva();
  }

  const espaciosDelCentro = (miCentro && ESPACIOS_POR_CENTRO[miCentro]) || ESPACIOS_DEFAULT;
  const salaEspacios = useMemo(() => espaciosDelCentro.filter((e) => esSalaDeJuntas(e.id)), [espaciosDelCentro]);
  // Si el catálogo estático no trae ningún espacio de bolsa para este centro
  // (caso Bosques: solo tiene "Sala de 10 personas"), se arma dinámicamente
  // desde oficinas reales de tipo Coworking/Sala de Capacitación.
  const bolsaEspaciosEstaticos = useMemo(() => espaciosDelCentro.filter((e) => !esSalaDeJuntas(e.id)), [espaciosDelCentro]);
  const bolsaEspacios = bolsaEspaciosEstaticos.length > 0 ? bolsaEspaciosEstaticos : oficinasBolsaDelCentro;
  const espaciosDeLaCategoria = categoria === "sala" ? salaEspacios : bolsaEspacios;

  const sinHorasDefinidas = horasSalaTotales === 0 && horasBolsaTotales === 0;
  const puedeMostrarSala = salaEspacios.length > 0 && (horasSalaTotales > 0 || sinHorasDefinidas);
  const puedeMostrarBolsa = bolsaEspacios.length > 0 && (horasBolsaTotales > 0 || sinHorasDefinidas);
  const categoriaNoDisponible = categoria === "sala" ? !puedeMostrarSala : !puedeMostrarBolsa;

  const diasSemana = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicioSemana);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [inicioSemana]);

  useEffect(() => {
    cargarHorasYCentro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia la lista de espacios de la categoría activa (por cambio de
  // categoría o porque ya cargó el centro), asegura que "espacio" apunte a
  // uno válido de esa categoría.
  useEffect(() => {
    if (espaciosDeLaCategoria.length === 0) {
      setEspacio("");
      return;
    }
    if (!espaciosDeLaCategoria.some((e) => e.id === espacio)) {
      setEspacio(espaciosDeLaCategoria[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, espaciosDeLaCategoria]);

  useEffect(() => {
    if (!espacio) return;
    cargarReservasSemana();
    setSeleccion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espacio, inicioSemana]);

  // Tiempo real: si otro cliente reserva/cancela algo mientras tienes el
  // calendario abierto, se actualiza solo sin tener que recargar la página.
  useEffect(() => {
    if (!espacio) return;
    const canal = supabase
      .channel(`reservaciones-${espacio}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservaciones", filter: `espacio=eq.${espacio}` },
        () => {
          cargarReservasSemana();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espacio]);

  async function cargarHorasYCentro() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("centro").eq("id", user.id).single();
    const c = profile?.centro || null;
    setMiCentro(c);

    // Si el catálogo estático no tiene ningún espacio de bolsa para este
    // centro, se arma desde las oficinas reales (ver sección 6.10.1 de
    // DOCUMENTACION_COTIZAR.md).
    const espaciosDelCentroLocal = (c && ESPACIOS_POR_CENTRO[c]) || ESPACIOS_DEFAULT;
    const tieneBolsaEstatica = espaciosDelCentroLocal.some((e) => !esSalaDeJuntas(e.id));
    if (c && !tieneBolsaEstatica) {
      const { data: oficinasData } = await supabase.from("oficinas").select("numero, tipo").eq("centro", c).order("numero");
      const dinamicos = (oficinasData || [])
        .filter((o) => o.tipo && !esSalaDeJuntas(o.tipo))
        .map((o) => ({ id: `${o.tipo} ${o.numero}`, icono: "💻" }));
      setOficinasBolsaDelCentro(dinamicos);
    }

    // Resuelve el contrato: el de la URL si es vigente y del cliente, si no
    // el más reciente vigente como respaldo.
    const { data: contratosVigentes } = await supabase
      .from("contratos")
      .select("id, horas_sala_juntas, horas_bolsa")
      .eq("user_id", user.id)
      .eq("estatus", "vigente")
      .order("created_at", { ascending: false });

    const contratoValido =
      (contratoIdDesdeUrl && (contratosVigentes || []).find((ct) => ct.id === contratoIdDesdeUrl)) ||
      (contratosVigentes || [])[0] ||
      null;

    const idContrato = contratoValido?.id || "";
    setContratoId(idContrato);
    const salaTotales = Number(contratoValido?.horas_sala_juntas || 0);
    const bolsaTotales = Number(contratoValido?.horas_bolsa || 0);
    setHorasSalaTotales(salaTotales);
    setHorasBolsaTotales(bolsaTotales);

    // Las horas se cuentan solo dentro del mes calendario actual — al
    // empezar un mes nuevo, se renuevan automáticamente. Scopeado al
    // contrato elegido (un cliente puede tener más de uno vigente).
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split("T")[0];
    const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split("T")[0];

    let salaUsadas = 0;
    let bolsaUsadas = 0;
    if (idContrato) {
      const { data: usadas } = await supabase
        .from("reservaciones")
        .select("hora_inicio, hora_fin, espacio")
        .eq("user_id", user.id)
        .eq("contrato_id", idContrato)
        .in("estado", ["pendiente", "confirmada"])
        .gte("fecha", inicioMes)
        .lte("fecha", finMes);

      (usadas || []).forEach((r) => {
        if (!r.espacio || !r.hora_inicio || !r.hora_fin) return;
        const horas = parseInt(r.hora_fin.split(":")[0]) - parseInt(r.hora_inicio.split(":")[0]);
        if (esSalaDeJuntas(r.espacio)) salaUsadas += horas;
        else bolsaUsadas += horas;
      });
    }
    setHorasSalaRestantes(salaTotales - salaUsadas);
    setHorasBolsaRestantes(bolsaTotales - bolsaUsadas);

    if (c) {
      const { data: precio } = await supabase
        .from("precios_sala_juntas")
        .select("precio_hora")
        .eq("centro", c)
        .maybeSingle();
      setPrecioHoraExtra(Number(precio?.precio_hora ?? 150));
    }

    setLoading(false);
  }

  async function cargarReservasSemana() {
    const desde = formatFechaISO(diasSemanaRef());
    const hasta = formatFechaISO(new Date(inicioSemana.getTime() + 6 * 86400000));
    const { data } = await supabase
      .from("reservaciones")
      .select("id, espacio, fecha, hora_inicio, hora_fin, estado")
      .eq("espacio", espacio)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .in("estado", ["pendiente", "confirmada"]);
    setReservas(data || []);
  }

  function diasSemanaRef() {
    return inicioSemana;
  }

  function estaOcupado(fechaISO: string, hora: number) {
    return reservas.some((r) => {
      if (r.fecha !== fechaISO || !r.hora_inicio || !r.hora_fin) return false;
      const ini = parseInt(r.hora_inicio.split(":")[0]);
      const fin = parseInt(r.hora_fin.split(":")[0]);
      return hora >= ini && hora < fin;
    });
  }

  function esPasado(fechaISO: string, hora: number) {
    const ahora = new Date();
    const [y, m, d] = fechaISO.split("-").map(Number);
    const fechaHora = new Date(y, m - 1, d, hora);
    return fechaHora < ahora;
  }

  const esBolsaActual = categoria === "bolsa";
  const horasDisponiblesReales = Math.max(esBolsaActual ? horasBolsaRestantes : horasSalaRestantes, 0);

  // Horas Bolsa (a diferencia de Sala de Juntas) no admite "fuera de
  // horario" — esos horarios quedan bloqueados por completo, no
  // seleccionables (regla #17 de DOCUMENTACION_COTIZAR.md).
  function bloqueadoPorHorario(fechaISO: string, hora: number) {
    return esBolsaActual && esFueraDeHorario(fechaISO, hora);
  }

  function rangoLibre(fechaISO: string, ini: number, fin: number) {
    for (let h = ini; h < fin; h++) {
      if (estaOcupado(fechaISO, h) || esPasado(fechaISO, h) || bloqueadoPorHorario(fechaISO, h)) return false;
    }
    return true;
  }

  function clickSlot(fechaISO: string, hora: number) {
    if (estaOcupado(fechaISO, hora) || esPasado(fechaISO, hora) || bloqueadoPorHorario(fechaISO, hora)) return;

    if (!seleccion || seleccion.fecha !== fechaISO) {
      setSeleccion({ fecha: fechaISO, horaInicio: hora, horaFin: hora + 1 });
    } else if (hora === seleccion.horaInicio) {
      setSeleccion(null);
    } else if (hora > seleccion.horaInicio) {
      const duracionNueva = hora + 1 - seleccion.horaInicio;
      // Horas Bolsa se topa en el banco de horas restante — no se puede
      // exceder, ni pagando (a diferencia de Sala de Juntas).
      if (esBolsaActual && duracionNueva > horasDisponiblesReales) return;
      if (rangoLibre(fechaISO, seleccion.horaInicio, hora + 1)) {
        setSeleccion({ ...seleccion, horaFin: hora + 1 });
      }
    } else {
      const duracionNueva = seleccion.horaFin - hora;
      if (esBolsaActual && duracionNueva > horasDisponiblesReales) return;
      if (rangoLibre(fechaISO, hora, seleccion.horaFin)) {
        setSeleccion({ fecha: fechaISO, horaInicio: hora, horaFin: seleccion.horaFin });
      }
    }
  }

  const duracionSeleccion = seleccion ? seleccion.horaFin - seleccion.horaInicio : 0;
  const esRoomDeJuntas = !esBolsaActual;
  const horasIncluidas = esRoomDeJuntas ? Math.min(duracionSeleccion, horasDisponiblesReales) : duracionSeleccion;
  const horasExtra = esRoomDeJuntas ? Math.max(duracionSeleccion - horasDisponiblesReales, 0) : 0;
  const costoExtra = horasExtra * precioHoraExtra;
  const seleccionFueraHorario = useMemo(() => {
    if (!seleccion || esBolsaActual) return false;
    for (let h = seleccion.horaInicio; h < seleccion.horaFin; h++) {
      if (esFueraDeHorario(seleccion.fecha, h)) return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion, esBolsaActual]);

  function cambiarCategoria(c: Categoria) {
    setCategoria(c);
    setSeleccion(null);
  }

  async function confirmarReserva() {
    if (!seleccion) return;
    setError("");
    setEnviando(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sesión expirada, vuelve a iniciar sesión");
      setEnviando(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre, email, centro")
      .eq("id", user.id)
      .single();

    const centro = profile?.centro || "Aguascalientes";
    const horarioTexto = `${formatHora(seleccion.horaInicio)} - ${formatHora(seleccion.horaFin)}`;

    const { data: nuevaReserva, error: insertError } = await supabase
      .from("reservaciones")
      .insert({
        user_id: user.id,
        espacio,
        fecha: seleccion.fecha,
        hora: horarioTexto,
        hora_inicio: `${String(seleccion.horaInicio).padStart(2, "0")}:00`,
        hora_fin: `${String(seleccion.horaFin).padStart(2, "0")}:00`,
        centro,
        estado: "pendiente",
        fuera_horario: seleccionFueraHorario,
        horas_incluidas: horasIncluidas,
        horas_extra: horasExtra,
        costo_extra: costoExtra,
        contrato_id: contratoId || null,
        coffee_break_paquete_id: quiereCoffee && paqueteCoffee ? paqueteCoffee.id : null,
        coffee_break_personas: quiereCoffee && paqueteCoffee ? personasCoffeeNum : null,
        coffee_break_total: quiereCoffee && paqueteCoffee ? totalCoffeeBreak : null,
      })
      .select()
      .single();

    if (insertError || !nuevaReserva) {
      // Código 23P01 = violación de la restricción de exclusión que evita
      // traslapes de horario (ver migracion_no_traslape_reservaciones.sql)
      // — alguien más reservó ese mismo horario primero.
      if (insertError?.code === "23P01") {
        setError("Ese horario ya fue tomado por alguien más justo antes que tú. Elige otro horario.");
        setSeleccion(null);
        cargarReservasSemana();
      } else {
        setError("No se pudo guardar la reservación. Intenta de nuevo.");
      }
      setEnviando(false);
      return;
    }

    const mensaje = seleccionFueraHorario
      ? `⚠️ ${profile?.nombre || "Un cliente"} solicitó ${espacio} el ${seleccion.fecha} (${horarioTexto}) — FUERA DE HORARIO, recepción debe cotizarla antes de confirmar.`
      : `${profile?.nombre || "Un cliente"} solicitó ${espacio} el ${seleccion.fecha} (${horarioTexto})`;
    await supabase.from("notificaciones").insert({
      centro,
      tipo: "nueva_reservacion",
      mensaje,
      reservacion_id: nuevaReserva.id,
    });

    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("rol", "admin")
      .eq("centro", centro);
    const emailsAdmin = (admins || []).map((a) => a.email).filter(Boolean);

    if (emailsAdmin.length > 0) {
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            tipo: "nueva_reservacion",
            to: emailsAdmin,
            espacio,
            fecha: seleccion.fecha,
            horario: seleccionFueraHorario ? `${horarioTexto} (FUERA DE HORARIO — cotizar)` : horarioTexto,
            clienteNombre: profile?.nombre,
            centro,
          },
        });
      } catch {
        // no crítico
      }
    }

    setEnviando(false);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="panel">
        <div className="rep-header">
          <p className="rep-title">Reservación enviada</p>
        </div>
        <div className="sub-content">
          <div className="exito-card">
            <div className="confetti">
              {confettiReservacion.map((c) => (
                <span
                  key={c.id}
                  className="confetti-pieza"
                  style={{
                    left: `${c.left}%`,
                    background: c.color,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.duracion}s`,
                  }}
                />
              ))}
            </div>

            <div className="exito-icono">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <p className="exito-titulo">Solicitud enviada</p>
            <p className="exito-mensaje">
              Tu solicitud está pendiente. Te avisaremos aquí y por correo en cuanto el centro la confirme.
            </p>
            <button className="exito-btn" onClick={() => router.push("/mis-reservaciones")}>
              Ver mis reservaciones
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Reservar espacio</p>
        <p className="rep-sub">{miCentro || "Selecciona tu horario"}</p>
      </div>

      <div className="sub-content">
        {puedeMostrarSala && puedeMostrarBolsa && (
          <div className="cal-espacio-tabs">
            <button
              className={"cal-espacio-tab" + (categoria === "sala" ? " active" : "")}
              onClick={() => cambiarCategoria("sala")}
            >
              🤝 Sala de Juntas
            </button>
            <button
              className={"cal-espacio-tab" + (categoria === "bolsa" ? " active" : "")}
              onClick={() => cambiarCategoria("bolsa")}
            >
              🎟️ Horas Bolsa
            </button>
          </div>
        )}

        {categoriaNoDisponible ? (
          <div className="empty-card">
            {categoria === "sala"
              ? "Tu contrato no incluye horas de Sala de Juntas en este centro."
              : "Tu contrato no incluye Horas Bolsa (Coworking / Sala de Capacitación) en este centro."}
          </div>
        ) : (
          <>
            {!loading && (categoria === "sala" ? horasSalaTotales > 0 : horasBolsaTotales > 0) && (
              <div className="horas-banco-card">
                <div>
                  <p className="horas-banco-num">{Math.max(horasDisponiblesReales, 0)}</p>
                  <p className="horas-banco-lbl">{categoria === "sala" ? "horas de sala de juntas" : "horas bolsa"}</p>
                </div>
                <div className="horas-banco-bar-wrap">
                  <div className="horas-banco-bar">
                    <div
                      className="horas-banco-bar-fill"
                      style={{
                        width: `${
                          (categoria === "sala" ? horasSalaTotales : horasBolsaTotales)
                            ? Math.min(
                                (horasDisponiblesReales / (categoria === "sala" ? horasSalaTotales : horasBolsaTotales)) * 100,
                                100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <p className="horas-banco-detalle">
                    {horasDisponiblesReales} de {categoria === "sala" ? horasSalaTotales : horasBolsaTotales} horas disponibles
                  </p>
                </div>
              </div>
            )}

            {espaciosDeLaCategoria.length > 1 && (
              <div className="cal-espacio-tabs">
                {espaciosDeLaCategoria.map((e) => (
                  <button
                    key={e.id}
                    className={"cal-espacio-tab" + (espacio === e.id ? " active" : "")}
                    onClick={() => setEspacio(e.id)}
                  >
                    {e.icono} {e.id}
                  </button>
                ))}
              </div>
            )}

            <div className="cal-semana-nav">
              <button onClick={() => setInicioSemana(new Date(inicioSemana.getTime() - 7 * 86400000))}>
                ‹
              </button>
              <span className="cal-semana-label">
                {diasSemana[0].toLocaleDateString("es-MX", { day: "numeric", month: "short" })} –{" "}
                {diasSemana[6].toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
              </span>
              <button onClick={() => setInicioSemana(new Date(inicioSemana.getTime() + 7 * 86400000))}>
                ›
              </button>
            </div>

            <div className="cal-grid-wrap">
              <div className="cal-grid">
                <div className="cal-head-cell"></div>
                {diasSemana.map((d) => (
                  <div className="cal-head-cell" key={d.toISOString()}>
                    {DIAS_CORTOS[d.getDay()]}
                    <span className="num">{d.getDate()}</span>
                  </div>
                ))}

                {HORAS.map((h) => (
                  <Fragment key={`row-${h}`}>
                    <div className="cal-hour-cell" key={`h-${h}`}>
                      {h}:00
                    </div>
                    {diasSemana.map((d) => {
                      const fechaISO = formatFechaISO(d);
                      const ocupado = estaOcupado(fechaISO, h);
                      const pasado = esPasado(fechaISO, h);
                      const bloqueado = !ocupado && !pasado && bloqueadoPorHorario(fechaISO, h);
                      const fueraHorario = !ocupado && !pasado && !esBolsaActual && esFueraDeHorario(fechaISO, h);
                      const sel =
                        seleccion &&
                        seleccion.fecha === fechaISO &&
                        h >= seleccion.horaInicio &&
                        h < seleccion.horaFin;
                      return (
                        <div
                          key={`${fechaISO}-${h}`}
                          className={
                            "cal-slot" +
                            (sel
                              ? " seleccionado"
                              : ocupado
                              ? " ocupado"
                              : pasado || bloqueado
                              ? " pasado"
                              : fueraHorario
                              ? " fuera-horario"
                              : "")
                          }
                          title={
                            ocupado
                              ? "Ocupado"
                              : pasado
                              ? "Ya pasó"
                              : bloqueado
                              ? "Fuera de horario — no disponible para Horas Bolsa"
                              : fueraHorario
                              ? "Fuera de horario normal — se cobra extra, sujeto a cotización de recepción"
                              : `${formatHora(h)}`
                          }
                          onClick={() => clickSlot(fechaISO, h)}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>

            <div className="cal-leyenda">
              <span className="cal-leyenda-item">
                <span className="cal-leyenda-dot" style={{ background: "#8fe0b3" }} /> Libre
              </span>
              <span className="cal-leyenda-item">
                <span className="cal-leyenda-dot" style={{ background: "#f29494" }} /> Ocupado
              </span>
              {esBolsaActual ? (
                <span className="cal-leyenda-item">
                  <span className="cal-leyenda-dot" style={{ background: "#d8d8d8" }} /> Fuera de horario (no disponible)
                </span>
              ) : (
                <span className="cal-leyenda-item">
                  <span className="cal-leyenda-dot" style={{ background: "#ffc766" }} /> Fuera de horario (extra)
                </span>
              )}
              <span className="cal-leyenda-item">
                <span className="cal-leyenda-dot" style={{ background: "#f07e3a" }} /> Tu selección
              </span>
              <span className="cal-leyenda-item">
                <span className="cal-leyenda-dot" style={{ background: "#d8d8d8" }} /> Ya pasó
              </span>
            </div>

            {seleccion && (
              <div className="resumen-reserva-card">
                <p className="resumen-reserva-title">Resumen de reservación</p>
                <div className="resumen-reserva-row">
                  <span className="resumen-reserva-label">Espacio</span>
                  <span className="resumen-reserva-val">{espacio}</span>
                </div>
                <div className="resumen-reserva-row">
                  <span className="resumen-reserva-label">Fecha</span>
                  <span className="resumen-reserva-val">{seleccion.fecha}</span>
                </div>
                <div className="resumen-reserva-row">
                  <span className="resumen-reserva-label">Horario</span>
                  <span className="resumen-reserva-val">
                    {formatHora(seleccion.horaInicio)} - {formatHora(seleccion.horaFin)}
                  </span>
                </div>
                <div className="resumen-reserva-row">
                  <span className="resumen-reserva-label">Duración</span>
                  <span className="resumen-reserva-val">{duracionSeleccion} hora(s)</span>
                </div>
                {esRoomDeJuntas ? (
                  <div className="nota-info">
                    {horasExtra > 0 ? (
                      <>
                        ✅ {horasIncluidas} hora(s) cubiertas por tu contrato.
                        <br />
                        💲 {horasExtra} hora(s) extra a ${precioHoraExtra}/hora ={" "}
                        <b>${costoExtra.toLocaleString("es-MX")}</b> — se le cobrarán aparte.
                      </>
                    ) : (
                      `Te quedarán ${horasDisponiblesReales - duracionSeleccion} hora(s) del mes después de esta reserva`
                    )}
                  </div>
                ) : (
                  <div className="nota-info">
                    Te quedarán {horasDisponiblesReales - duracionSeleccion} hora(s) bolsa del mes después de esta reserva
                  </div>
                )}
                {seleccionFueraHorario && (
                  <div className="nota-info" style={{ background: "rgba(255, 199, 102, 0.2)", color: "#a3701f" }}>
                    ⚠️ Este horario está fuera del horario normal (domingo, festivo, sábado después
                    de las 2pm o entre semana después de las 8pm). Se cobra extra y está sujeto a que
                    recepción te mande la cotización antes de confirmarse.
                  </div>
                )}
                <div className="nota-info">⏳ Tu reservación quedará pendiente hasta que el centro la confirme.</div>
              </div>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

            <button
              className="reservar-btn"
              onClick={abrirModalCoffee}
              disabled={!seleccion || enviando}
            >
              {enviando ? "Enviando..." : "Solicitar reservación"}
            </button>
          </>
        )}
      </div>

      {modalCoffeeAbierto && (
        <div className="modal-overlay" onClick={() => !enviando && setModalCoffeeAbierto(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">☕ ¿Quieres agregar Coffee Break?</p>

            {quiereCoffee === null && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => setQuiereCoffee(true)}>
                  Sí, agregar
                </button>
                <button className="tel-borrar-btn" onClick={() => setQuiereCoffee(false)}>
                  No, gracias
                </button>
              </div>
            )}

            {quiereCoffee === true && (
              <>
                {coffeeBreakPaquetes.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#999", marginTop: 8 }}>
                    No hay paquetes de coffee break disponibles en este momento.
                  </p>
                ) : (
                  <>
                    <p className="sub-label" style={{ marginTop: 8 }}>
                      Paquete
                    </p>
                    <select value={paqueteCoffeeId || ""} onChange={(e) => setPaqueteCoffeeId(e.target.value || null)}>
                      <option value="">Selecciona un paquete</option>
                      {coffeeBreakPaquetes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} · ${Number(p.precio_persona).toLocaleString("es-MX")}/persona · mínimo {p.minimo_personas}
                        </option>
                      ))}
                    </select>
                    {paqueteCoffee && (
                      <>
                        <p className="sub-label" style={{ marginTop: 8 }}>
                          Número de personas
                        </p>
                        <input
                          type="number"
                          min={1}
                          value={personasCoffee}
                          onChange={(e) => setPersonasCoffee(e.target.value ? Number(e.target.value) : "")}
                        />
                        {coffeeBreakFaltaMinimo && (
                          <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>
                            Ese paquete requiere un mínimo de {paqueteCoffee.minimo_personas} persona(s)
                          </p>
                        )}
                        {personasCoffeeNum > 0 && !coffeeBreakFaltaMinimo && (
                          <p style={{ fontSize: 12, color: "#0F6E56", margin: "6px 0 0" }}>
                            Total estimado: ${totalCoffeeBreak.toLocaleString("es-MX")}
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}

            {quiereCoffee !== null && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="tel-borrar-btn" onClick={() => setQuiereCoffee(null)} disabled={enviando}>
                  Atrás
                </button>
                <button
                  className="reservar-btn"
                  onClick={continuarConReserva}
                  disabled={enviando || (quiereCoffee === true && (!paqueteCoffeeId || !personasCoffeeNum || coffeeBreakFaltaMinimo))}
                >
                  {enviando ? "Enviando..." : "Confirmar reservación"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReservacionesPage() {
  return (
    <Suspense fallback={null}>
      <ReservacionesInner />
    </Suspense>
  );
}
