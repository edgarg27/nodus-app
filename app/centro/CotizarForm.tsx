"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Checkbox from "@/app/components/Checkbox";
import { conIva, llevaIva } from "@/lib/adicionales";
import { esOficinaPrivada, rentaMensualConIva, type FormaPago } from "@/lib/formaPago";
import CapacidadSalaIcono, { extraerCapacidadSala } from "@/app/components/CapacidadSalaIcono";

// Mismo look que ya usan los inputs de .tel-form-grid (ver app/globals.css)
// — los <select> de Tipo de espacio/Tamaño de sala no vivían dentro de esa
// grilla, así que no heredaban ese estilo y se veían con el <select> por
// defecto del navegador.
const estiloSelect: CSSProperties = {
  width: "100%",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  color: "#1a1a1a",
  background: "#fafafa",
  fontFamily: "inherit",
};

// Helpers de fecha/hora — este proyecto no tiene un lib/reservaciones.ts
// compartido, se duplican inline igual que ya hacen app/reservaciones/page.tsx
// y app/centro/CentroPanel.tsx.
import { HORAS_CALENDARIO as HORAS, esFueraDeHorario } from "@/lib/horarioSala";
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

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

type Cliente = {
  id: string;
  nombre: string;
  email: string;
  empresa: string | null;
  telefono: string | null;
  rfc: string | null;
};
// Lead registrado en la pestaña Prospectos de Centro — no tiene cuenta
// (profiles.id), así que solo sirve para precargar nombre/contacto al
// cotizar, nunca para ligar cliente_id.
type ProspectoBusqueda = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  interes: string | null;
  medio: string | null;
  rfc: string | null;
};
type Oficina = {
  id: string;
  numero: string;
  tipo: string;
  estado: string;
  precio: string | null;
  deposito_garantia: number | null;
  cliente_id: string | null;
  paquete_default_id: string | null;
};
type Paquete = {
  id: string;
  nombre: string;
  descripcion: string | null;
  incluye_horas_sala_juntas: number | null;
  horas_bolsa: number | null;
  tipo_espacio: string | null;
  precio_hora: number | null;
  precio_dia: number | null;
  precio_semana: number | null;
  precio_mes: number | null;
  bloquea_reasignacion: boolean;
};
// Tamaños de sala de juntas con tarifas fijas por tramo (no lineales como
// los paquetes), editables desde /precios-sala-juntas.
type PrecioSala = { id: string; centro: string; tamano: string; precio_hora: number; precio_medio_dia: number; precio_dia: number };
// Coffee Break — paquetes globales (no por centro), los mismos que se
// ofrecen al cliente al reservar (ver app/reservaciones/page.tsx). Aquí se
// ofrecen igual como agregado opcional al cotizar, por si el cliente
// también lo quiere.
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
const SALA_JUNTAS_TIPO = "Sala de Juntas";
type CatalogoAdicional = { id: string; nombre: string; descripcion: string | null; costo_unitario: number };
type AdicionalDraft = {
  clave: string;
  // Presente solo si ya existe en contrato_adicionales (se cargó del
  // contrato que se está renovando/agregando) — sin esto no hay manera de
  // saber, al guardar, si hay que actualizar/eliminar la fila real o
  // insertar una nueva.
  id?: string;
  adicional_id: string | null;
  concepto: string;
  descripcion: string | null;
  costo_unitario: number;
  cantidad: number;
};

const TIPOS_PROSPECTO = ["Nuevo", "Referido", "Recurrente", "Otro"];
const MEDIOS_CONTACTO = ["Teléfono", "Redes sociales", "Referido", "Página web", "Otro"];
const MODALIDADES = ["Hora", "Día", "Semana", "Mes"] as const;
type Modalidad = (typeof MODALIDADES)[number];
const LABEL_MODALIDAD: Record<Modalidad, string> = { Hora: "hora", Día: "día", Semana: "semana", Mes: "mes" };
const LABEL_MODALIDAD_PLURAL: Record<Modalidad, string> = { Hora: "horas", Día: "días", Semana: "semanas", Mes: "meses" };

function tarifaPaquete(p: Paquete | null, modalidad: string): number | null {
  if (!p) return null;
  if (modalidad === "Hora") return p.precio_hora;
  if (modalidad === "Día") return p.precio_dia;
  if (modalidad === "Semana") return p.precio_semana;
  if (modalidad === "Mes") return p.precio_mes;
  return null;
}

function sumarPeriodo(fechaISO: string, modalidad: string, cantidad: number) {
  const f = new Date(fechaISO + "T00:00:00");
  if (modalidad === "Día") f.setDate(f.getDate() + cantidad);
  else if (modalidad === "Semana") f.setDate(f.getDate() + cantidad * 7);
  else f.setMonth(f.getMonth() + cantidad); // Mes (y default para oficinas)
  return formatFechaISO(f);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function CotizarForm({
  centro,
  clientePreseleccionadoId,
  onRegistrado,
  tipoEspacioPreseleccionado,
  oficinaPreseleccionadaId,
  paquetePreseleccionadoId,
  fechaInicioPreseleccionada,
  modalidadPreseleccionada,
  cantidadPreseleccionada,
  prospectoIdPreseleccionado,
  prospectoNombrePreseleccionado,
  prospectoTelefonoPreseleccionado,
  prospectoEmailPreseleccionado,
  prospectoInteresPreseleccionado,
  prospectoRfcPreseleccionado,
}: {
  centro: string;
  clientePreseleccionadoId?: string;
  onRegistrado: () => void;
  tipoEspacioPreseleccionado?: string;
  oficinaPreseleccionadaId?: string;
  paquetePreseleccionadoId?: string;
  fechaInicioPreseleccionada?: string;
  modalidadPreseleccionada?: string;
  cantidadPreseleccionada?: string;
  // Handoff desde la pestaña Prospectos de Centro (ver botón "🧾 Cotizar"
  // en cada tarjeta) — no hay cliente todavía, así que esto solo precarga
  // observaciones/tipo de prospecto para no perder el contexto del lead. El
  // id sí se persiste (prospecto_id en cotizaciones_comerciales) para que
  // /prospectos pueda detectar el seguimiento automático.
  prospectoIdPreseleccionado?: string;
  prospectoNombrePreseleccionado?: string;
  prospectoTelefonoPreseleccionado?: string;
  prospectoEmailPreseleccionado?: string;
  prospectoInteresPreseleccionado?: string;
  prospectoRfcPreseleccionado?: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [oficinas, setOficinas] = useState<Oficina[]>([]);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [catalogoAdicionales, setCatalogoAdicionales] = useState<CatalogoAdicional[]>([]);
  const [preciosSala, setPreciosSala] = useState<PrecioSala[]>([]);
  const [coffeeBreakPaquetes, setCoffeeBreakPaquetes] = useState<CoffeeBreakPaquete[]>([]);
  // Ocupación en vivo por oficina — una oficina se considera ocupada si
  // algún contrato vigente la tiene asignada, sin depender de que
  // `oficinas.estado` se haya actualizado a mano.
  const [ocupacionPorOficina, setOcupacionPorOficina] = useState<
    Record<string, { clienteNombre: string; fechaVencimiento: string }>
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  async function cargarDatos() {
    setLoading(true);
    const [clisRes, ofisRes, paqsRes, catRes, contratosRes, salaRes, coffeeRes, prospsRes] = await Promise.all([
      supabase.from("profiles").select("id, nombre, email, empresa, telefono, rfc").eq("rol", "cliente").eq("centro", centro),
      supabase
        .from("oficinas")
        .select("id, numero, tipo, estado, precio, deposito_garantia, cliente_id, paquete_default_id")
        .eq("centro", centro)
        .order("numero"),
      supabase.from("paquetes").select("*").eq("centro", centro).order("nombre"),
      supabase.from("adicionales_catalogo").select("*").eq("centro", centro).eq("activo", true).order("nombre"),
      supabase
        .from("contratos")
        .select("oficina_id, user_id, fecha_vencimiento")
        .eq("centro", centro)
        .eq("estatus", "vigente")
        .not("oficina_id", "is", null)
        // Un contrato "vigente" sin user_id nunca se concluyó (se quedó a
        // medias antes de crear la cuenta del cliente) — no cuenta como
        // ocupación real, o bloquearía oficinas libres para siempre.
        .not("user_id", "is", null),
      supabase.from("precios_cotizacion_sala_juntas").select("*").eq("centro", centro).order("tamano"),
      supabase.from("coffee_break_paquetes").select("*").eq("activo", true).order("numero", { ascending: true }),
      supabase
        .from("prospectos")
        .select("id, nombre, telefono, email, interes, medio, rfc")
        .eq("centro", centro)
        .order("created_at", { ascending: false }),
    ]);
    setClientes(clisRes.data || []);
    setOficinas(ofisRes.data || []);
    setPaquetes(paqsRes.data || []);
    setCatalogoAdicionales(catRes.data || []);
    // Se ordenan de mayor a menor tamaño (ej. 10, 8, 6) en vez de dejar el
    // orden alfabético que trae la base de datos (que mezclaba 10, 6, 8).
    setPreciosSala(
      [...(salaRes.data || [])].sort((a, b) => (parseInt(String(b.tamano)) || 0) - (parseInt(String(a.tamano)) || 0))
    );
    setCoffeeBreakPaquetes(coffeeRes.data || []);
    setProspectosBusqueda(prospsRes.data || []);

    const contratosConOficina = contratosRes.data || [];
    const userIds = Array.from(new Set(contratosConOficina.map((c) => c.user_id).filter(Boolean)));
    const { data: perfiles } =
      userIds.length > 0
        ? await supabase.from("profiles").select("id, nombre").in("id", userIds)
        : { data: [] as { id: string; nombre: string }[] };
    const nombrePorUserId = Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre]));

    const mapaOcupacion: Record<string, { clienteNombre: string; fechaVencimiento: string }> = {};
    contratosConOficina.forEach((c) => {
      if (!c.oficina_id) return;
      mapaOcupacion[c.oficina_id] = {
        clienteNombre: (c.user_id && nombrePorUserId[c.user_id]) || "Cliente",
        fechaVencimiento: c.fecha_vencimiento,
      };
    });
    setOcupacionPorOficina(mapaOcupacion);

    setLoading(false);
  }

  // ---------- Cliente precargado (viene de un cliente real ya existente,
  // ver /dashboard → botón "Cotizar" de un cliente puntual) ----------
  const [clienteId, setClienteId] = useState(clientePreseleccionadoId || "");
  const [preseleccionLiberada, setPreseleccionLiberada] = useState(false);
  const cliente = clientes.find((c) => c.id === clienteId) || null;
  const clientePrecargado = !!clientePreseleccionadoId && !preseleccionLiberada;

  function etiquetaCliente(c: Cliente) {
    return `${c.nombre}${c.empresa ? ` (${c.empresa})` : ""}`;
  }

  // ---------- Cliente existente (opcional) ----------
  // Buscador de clientes que YA tienen cuenta (profiles.rol = "cliente") —
  // a diferencia del buscador de Prospecto de abajo, elegir uno aquí SÍ
  // liga cliente_id de verdad. Sin esto, cotizar para un cliente existente
  // sin llegar por la URL con clienteId (ver /dashboard → "Cotizar" de un
  // cliente puntual) no tenía forma de ligarse — el contrato quedaba con
  // user_id null y, al aprobarlo, se trataba como si fuera cliente nuevo.
  const [busquedaClienteExistente, setBusquedaClienteExistente] = useState("");
  const [mostrarListaClientesExistentes, setMostrarListaClientesExistentes] = useState(false);
  const clientesExistentesFiltrados = useMemo(() => {
    if (!busquedaClienteExistente.trim()) return clientes;
    const q = busquedaClienteExistente.toLowerCase();
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.telefono?.toLowerCase().includes(q)
    );
  }, [busquedaClienteExistente, clientes]);

  function seleccionarClienteExistente(c: Cliente) {
    setClienteId(c.id);
    setBusquedaClienteExistente(c.nombre);
    setMostrarListaClientesExistentes(false);
    // Un cliente real reemplaza cualquier prospecto que se hubiera elegido
    // antes — no tiene sentido ligar los dos a la vez.
    setProspectoSeleccionadoId("");
    setBusqueda("");
    setNombreContesta(c.nombre);
    setTelefonoContesta(c.telefono || "");
    setCorreoContesta(c.email || "");
    setRfc(c.rfc || "");
  }

  function limpiarClienteExistente() {
    setClienteId("");
    setBusquedaClienteExistente("");
    setMostrarListaClientesExistentes(false);
  }

  // ---------- Prospecto (opcional) ----------
  // Buscador de leads ya registrados en la pestaña Prospectos — NO liga un
  // cliente_id real (los prospectos no tienen cuenta), solo precarga
  // nombre/observaciones igual que el handoff por URL desde esa pestaña.
  const [busqueda, setBusqueda] = useState(prospectoNombrePreseleccionado || "");
  const [prospectoSeleccionadoId, setProspectoSeleccionadoId] = useState(prospectoIdPreseleccionado || "");
  const [mostrarListaClientes, setMostrarListaClientes] = useState(false);
  const [prospectosBusqueda, setProspectosBusqueda] = useState<ProspectoBusqueda[]>([]);
  const prospectosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return prospectosBusqueda;
    const q = busqueda.toLowerCase();
    return prospectosBusqueda.filter(
      (p) =>
        p.nombre?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.telefono?.toLowerCase().includes(q)
    );
  }, [busqueda, prospectosBusqueda]);

  function seleccionarClienteBusqueda(p: ProspectoBusqueda) {
    setProspectoSeleccionadoId(p.id);
    setBusqueda(p.nombre);
    setMostrarListaClientes(false);
    // Precarga los campos reales de "Datos comerciales" en vez de amontonar
    // todo en Observaciones — así queda igual de estructurado que si el
    // staff lo hubiera tecleado a mano.
    setNombreContesta(p.nombre);
    setTelefonoContesta(p.telefono || "");
    setCorreoContesta(p.email || "");
    setRfc(p.rfc || "");
    if (p.medio && MEDIOS_CONTACTO.includes(p.medio)) setMedioContacto(p.medio);
    if (p.interes) setObservaciones((prev) => (prev.trim() ? prev : `Interés: ${p.interes}`));
  }

  function limpiarClienteBusqueda() {
    setProspectoSeleccionadoId("");
    setBusqueda("");
    setMostrarListaClientes(false);
  }

  // Paquetes que este cliente ya tiene registrados en un contrato (que no
  // haya sido rechazado) — no se le puede volver a asignar el mismo
  // paquete dos veces. No aplica a reservaciones (paquetes tipo Día/Hora
  // son consumibles y se pueden repetir), ni a paquetes marcados como
  // repetibles (paquete.bloquea_reasignacion === false, ver /paquetes).
  const [paquetesYaRegistrados, setPaquetesYaRegistrados] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!clienteId) {
      setPaquetesYaRegistrados(new Set());
      return;
    }
    let cancelado = false;
    (async () => {
      const { data: cots } = await supabase
        .from("cotizaciones_comerciales")
        .select("paquete_id, contrato_id")
        .eq("cliente_id", clienteId)
        .not("paquete_id", "is", null)
        .not("contrato_id", "is", null);
      const contratoIds = Array.from(new Set((cots || []).map((c) => c.contrato_id).filter((id): id is string => !!id)));
      if (contratoIds.length === 0) {
        if (!cancelado) setPaquetesYaRegistrados(new Set());
        return;
      }
      const { data: conts } = await supabase.from("contratos").select("id, estatus").in("id", contratoIds);
      const estatusPorContrato: Record<string, string | null> = {};
      (conts || []).forEach((c) => {
        estatusPorContrato[c.id] = c.estatus;
      });
      const bloqueaPorId: Record<string, boolean> = {};
      paquetes.forEach((p) => {
        bloqueaPorId[p.id] = p.bloquea_reasignacion;
      });
      const bloqueados = new Set(
        (cots || [])
          .filter(
            (c) =>
              c.contrato_id &&
              estatusPorContrato[c.contrato_id] !== "rechazado" &&
              bloqueaPorId[c.paquete_id as string] !== false
          )
          .map((c) => c.paquete_id as string)
      );
      if (!cancelado) setPaquetesYaRegistrados(bloqueados);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  // ---------- Tipo de espacio / Oficina o Paquete ----------
  // Working Desk no se ofrece en Bosques (ahí no existen; solo hay una
  // oficina de ese tipo registrada como placeholder, sin contratos) — en los
  // demás centros sigue apareciendo igual.
  const tiposEspacioDisponibles = useMemo(() => {
    return Array.from(new Set(oficinas.map((o) => o.tipo).filter(Boolean)))
      .filter((t) => !(centro === "Bosques" && t.trim().toLowerCase() === "working desk"))
      .sort();
  }, [oficinas, centro]);

  const [tipoEspacio, setTipoEspacio] = useState("");

  const oficinasDelTipo = useMemo(() => {
    return oficinas
      .filter((o) => o.tipo === tipoEspacio)
      .sort((a, b) => {
        const aOcupada = !!ocupacionPorOficina[a.id];
        const bOcupada = !!ocupacionPorOficina[b.id];
        if (!aOcupada && bOcupada) return -1; // disponibles primero
        if (aOcupada && !bOcupada) return 1;
        return a.numero.localeCompare(b.numero, "es", { numeric: true });
      });
  }, [oficinas, tipoEspacio, ocupacionPorOficina]);

  // Coworking: los espacios se llaman A, B… Z, AA… AZ y se eligen en dos
  // pasos — primero la letra, y si esa letra tiene varios espacios (la "A"
  // agrupa A, AA, AB… AZ) se despliega su tabla para escoger cuál. Las
  // letras que tienen un solo espacio se eligen directo.
  const esCoworkingSel = tipoEspacio.trim().toLowerCase() === "coworking";
  const [grupoEspacioAbierto, setGrupoEspacioAbierto] = useState<string | null>(null);
  const [paqueteListaAbierta, setPaqueteListaAbierta] = useState(false);
  const gruposEspacios = useMemo(() => {
    const mapa = new Map<string, Oficina[]>();
    for (const o of oficinasDelTipo) {
      const letra = (o.numero || "").trim().charAt(0).toUpperCase();
      if (!mapa.has(letra)) mapa.set(letra, []);
      mapa.get(letra)!.push(o);
    }
    return Array.from(mapa.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([letra, lista]) => [
        letra,
        [...lista].sort((a, b) => a.numero.length - b.numero.length || a.numero.localeCompare(b.numero, "es")),
      ] as [string, Oficina[]]);
  }, [oficinasDelTipo]);

  const paquetesDelTipo = useMemo(() => {
    return paquetes.filter((p) => p.tipo_espacio === tipoEspacio);
  }, [paquetes, tipoEspacio]);

  const esSalaJuntas = tipoEspacio === SALA_JUNTAS_TIPO;
  const [salaTamanoId, setSalaTamanoId] = useState("");
  const salaSeleccionada = preciosSala.find((s) => s.id === salaTamanoId) || null;

  // ---------- Calendario de disponibilidad de Sala de Juntas — misma
  // vista/lógica que usa el cliente en /reservaciones?categoria=sala
  // (semana con celdas Libre/Ocupado/Fuera de horario/Ya pasó/Tu selección),
  // adaptada aquí para que el admin elija fecha+hora clickeando en vez de un
  // <input type="date"> genérico. Solo se usa como selector visual — esto
  // NO crea la reservación real (ver crearCotizacionSalaJuntas). ----------
  const [inicioSemanaSala, setInicioSemanaSala] = useState(() => lunesDeLaSemana(new Date()));
  const [reservasSala, setReservasSala] = useState<{ fecha: string; hora_inicio: string; hora_fin: string }[]>([]);
  type SeleccionSala = { fecha: string; horaInicio: number; horaFin: number } | null;
  const [seleccionSala, setSeleccionSala] = useState<SeleccionSala>(null);

  const diasSemanaSala = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicioSemanaSala);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [inicioSemanaSala]);

  useEffect(() => {
    if (!esSalaJuntas || !centro) return;
    const desde = formatFechaISO(diasSemanaSala[0]);
    const hasta = formatFechaISO(diasSemanaSala[6]);
    (async () => {
      const { data } = await supabase
        .from("reservaciones")
        .select("fecha, hora_inicio, hora_fin, espacio")
        .eq("centro", centro)
        .not("espacio", "ilike", "Coworking%")
        .not("espacio", "ilike", "Sala de Capacitación%")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .in("estado", ["pendiente", "confirmada"]);
      setReservasSala(data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSalaJuntas, centro, inicioSemanaSala]);

  function estaOcupadoSala(fechaISO: string, hora: number) {
    return reservasSala.some((r) => {
      if (r.fecha !== fechaISO || !r.hora_inicio || !r.hora_fin) return false;
      const ini = parseInt(r.hora_inicio.split(":")[0]);
      const fin = parseInt(r.hora_fin.split(":")[0]);
      return hora >= ini && hora < fin;
    });
  }

  function esPasadoSala(fechaISO: string, hora: number) {
    const ahora = new Date();
    const [y, m, d] = fechaISO.split("-").map(Number);
    return new Date(y, m - 1, d, hora) < ahora;
  }

  function rangoLibreSala(fechaISO: string, ini: number, fin: number) {
    for (let h = ini; h < fin; h++) {
      if (estaOcupadoSala(fechaISO, h) || esPasadoSala(fechaISO, h)) return false;
    }
    return true;
  }

  // Selección libre de horas, igual que hace el cliente en /reservaciones:
  // el primer click fija 1 hora; clicks siguientes en la misma fecha
  // extienden o recortan el rango hacia donde se haga click.
  function clickSlotSala(fechaISO: string, hora: number) {
    if (estaOcupadoSala(fechaISO, hora) || esPasadoSala(fechaISO, hora)) return;

    if (!seleccionSala || seleccionSala.fecha !== fechaISO) {
      setSeleccionSala({ fecha: fechaISO, horaInicio: hora, horaFin: hora + 1 });
      return;
    }
    if (hora === seleccionSala.horaInicio && seleccionSala.horaFin === seleccionSala.horaInicio + 1) {
      setSeleccionSala(null);
      return;
    }
    if (hora >= seleccionSala.horaInicio) {
      if (rangoLibreSala(fechaISO, seleccionSala.horaInicio, hora + 1)) {
        setSeleccionSala({ ...seleccionSala, horaFin: hora + 1 });
      }
    } else {
      if (rangoLibreSala(fechaISO, hora, seleccionSala.horaFin)) {
        setSeleccionSala({ fecha: fechaISO, horaInicio: hora, horaFin: seleccionSala.horaFin });
      }
    }
  }

  const duracionSalaSeleccion = seleccionSala ? seleccionSala.horaFin - seleccionSala.horaInicio : 0;

  // El precio se calcula automático para cualquier cantidad de horas, sin
  // restricciones (igual que el cliente puede elegir libremente su
  // horario). Si la duración cae exacto en uno de los 3 tramos con tarifa
  // fija de la tabla (1 hora / 4-6 horas / 1 día) se usa esa tarifa tal
  // cual; para cualquier otra cantidad de horas se prorratea usando la
  // tarifa por hora como base.
  const salaPrecio = useMemo(() => {
    if (!salaSeleccionada || !duracionSalaSeleccion) return null;
    if (duracionSalaSeleccion === 1 && salaSeleccionada.precio_hora) return salaSeleccionada.precio_hora;
    if (duracionSalaSeleccion >= 4 && duracionSalaSeleccion <= 6 && salaSeleccionada.precio_medio_dia)
      return salaSeleccionada.precio_medio_dia;
    if (duracionSalaSeleccion >= 10 && salaSeleccionada.precio_dia) return salaSeleccionada.precio_dia;
    if (salaSeleccionada.precio_hora) return round2(salaSeleccionada.precio_hora * duracionSalaSeleccion);
    return null;
  }, [salaSeleccionada, duracionSalaSeleccion]);

  // Cada vez que hay una selección válida en el calendario, se refleja en
  // fechaInicio/fechaFin (compartidos con el resto del formulario).
  useEffect(() => {
    if (!esSalaJuntas) return;
    if (seleccionSala) {
      setFechaInicio(seleccionSala.fecha);
      setFechaFin(seleccionSala.fecha);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSalaJuntas, seleccionSala]);

  // Cambiar de tamaño invalida la selección anterior en el calendario.
  useEffect(() => {
    setSeleccionSala(null);
  }, [salaTamanoId]);

  // El selector de "Tipo de cotización / venta" (Reserva vs Contrato) se
  // quitó de la vista — este formulario ahora SOLO genera cotizaciones (el
  // contrato de verdad, si el cliente acepta, se da de alta después a mano
  // en /contratos). Varias secciones de abajo (Precio, botón de enviar)
  // siguen dependiendo de que tipoCotizacionVenta tenga un valor, así que
  // se fija internamente sin mostrar el selector: "Reserva" para Sala de
  // Juntas (no se usa para nada, ver crearCotizacionSalaJuntas) y
  // "Contrato" para el resto, que es el único camino que ya queda en
  // crearCotizacion().
  useEffect(() => {
    if (esSalaJuntas && !tipoCotizacionVenta) setTipoCotizacionVenta("Reserva");
    if (!esSalaJuntas && !tipoCotizacionVenta) setTipoCotizacionVenta("Contrato");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSalaJuntas]);

  const [oficinaId, setOficinaId] = useState("");
  const [paqueteId, setPaqueteId] = useState("");
  const [modalidadPaquete, setModalidadPaquete] = useState<Modalidad | "">("");
  // true cuando el paquete se auto-seleccionó por `oficinas.paquete_default_id`
  // de la oficina elegida — regla dura: esa oficina siempre se cotiza con
  // ese paquete, el <select> de Paquete se deshabilita mientras esto sea true.
  const [paqueteBloqueado, setPaqueteBloqueado] = useState(false);
  const [avisoPaqueteVinculado, setAvisoPaqueteVinculado] = useState("");
  const oficina = oficinas.find((o) => o.id === oficinaId) || null;
  const paquete = paquetes.find((p) => p.id === paqueteId) || null;

  // Si el paquete elegido resulta bloqueado para el cliente actual (ya sea
  // porque se cambió de cliente después de elegir el paquete, o porque
  // recién llegó la respuesta de paquetesYaRegistrados), se limpia solo.
  useEffect(() => {
    if (paqueteId && paquetesYaRegistrados.has(paqueteId)) {
      setPaqueteId("");
      setModalidadPaquete("");
      setPaqueteBloqueado(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paquetesYaRegistrados]);

  function seleccionarTipoEspacio(t: string) {
    setTipoEspacio(t);
    setOficinaId("");
    setPaqueteId("");
    setModalidadPaquete("");
    setPrecioLista("");
    setDepositoGarantia("");
    setPaqueteBloqueado(false);
    setAvisoPaqueteVinculado("");
    setSalaTamanoId("");
    setSeleccionSala(null);
    // El Coffee Break es exclusivo de Sala de Juntas — si el usuario lo había
    // marcado y luego cambia a Coworking/Oficina Privada, se limpia para que
    // no se quede una selección fantasma bloqueando el envío del formulario.
    setQuiereCoffee(false);
    setPaqueteCoffeeId("");
    setPersonasCoffee("");
  }

  // En modo "agregar" este mismo <select> de Tipo de espacio no elige la
  // oficina principal (esa sigue siendo la del contrato, bloqueada) — solo
  // filtra la cuadrícula de la oficina EXTRA que se va a sumar. Por eso no
  // puede llamar a seleccionarTipoEspacio: esa función limpia oficinaId/
  // paqueteId asumiendo que se está eligiendo la oficina principal, y
  // vaciarlos aquí rompía espacioListo (la tarjeta de Desglose completa
  // desaparecía) cada vez que el staff cambiaba de tipo para buscar la
  // oficina que quería agregar.
  function seleccionarTipoEspacioParaAgregar(t: string) {
    setTipoEspacio(t);
    setOficinaNuevaId("");
  }

  // La oficina (espacio físico a asignar) y el paquete (tarifa a aplicar)
  // son selecciones independientes: elegir una NO desmarca la otra. El
  // depósito siempre lo determina el paquete cuando hay uno elegido; si no
  // hay paquete, se usa el depósito propio de la oficina. El precio de
  // lista se recalcula aparte (ver efecto abajo) porque también depende
  // de la cantidad capturada.
  function actualizarDepositoSegunSeleccion(ofcId: string, pqId: string) {
    if (pqId) {
      const p = paquetes.find((x) => x.id === pqId) || null;
      setDepositoGarantia(p?.precio_mes != null ? String(p.precio_mes) : "0");
    } else if (ofcId) {
      const o = oficinas.find((x) => x.id === ofcId) || null;
      setDepositoGarantia(o?.deposito_garantia != null ? String(o.deposito_garantia) : "0");
    } else {
      setDepositoGarantia("");
    }
  }

  function seleccionarOficina(id: string) {
    setOficinaId(id);
    const oficinaElegida = oficinas.find((o) => o.id === id) || null;
    const paqueteVinculado = oficinaElegida?.paquete_default_id
      ? paquetesDelTipo.find((p) => p.id === oficinaElegida.paquete_default_id) || null
      : null;

    // El bloqueo es incondicional, incluso si el staff ya había elegido
    // otro paquete a mano — elegir una oficina con vínculo siempre
    // sobreescribe la selección manual previa (regla dura, no sugerencia).
    // Excepción: si ese paquete ya está registrado para el cliente actual,
    // no se puede forzar — se libera el selector y se avisa.
    if (paqueteVinculado && !paquetesYaRegistrados.has(paqueteVinculado.id)) {
      setPaqueteId(paqueteVinculado.id);
      const disponibles = MODALIDADES.filter((m) => tarifaPaquete(paqueteVinculado, m) != null);
      setModalidadPaquete(disponibles.includes("Mes") ? "Mes" : disponibles[0] || "");
      setPaqueteBloqueado(true);
      setAvisoPaqueteVinculado("");
      actualizarDepositoSegunSeleccion(id, paqueteVinculado.id);
    } else {
      // El comentario de arriba decía "se libera el selector", pero nunca
      // se limpiaba paqueteId — se quedaba pegado al paquete de la oficina
      // elegida anteriormente. Por eso, con un cliente que ya trae un
      // paquete registrado (típico al renovar), todas las oficinas de ese
      // tipo parecían mostrar "el mismo paquete": en realidad era el mismo
      // valor viejo sin limpiar, no el paquete real de cada oficina.
      setPaqueteId("");
      setModalidadPaquete("");
      setPaqueteBloqueado(false);
      actualizarDepositoSegunSeleccion(id, "");
      setAvisoPaqueteVinculado(
        paqueteVinculado
          ? `Esta oficina está vinculada al paquete "${paqueteVinculado.nombre}", pero este cliente ya lo tiene registrado — elige otro paquete o continúa sin uno.`
          : ""
      );
    }
  }
  function seleccionarPaquete(id: string) {
    if (paqueteBloqueado) return; // defensa en profundidad, el <select> ya está disabled
    if (id && paquetesYaRegistrados.has(id)) return;
    setPaqueteId(id);
    const p = paquetes.find((x) => x.id === id) || null;
    const disponibles = MODALIDADES.filter((m) => tarifaPaquete(p, m) != null);
    const modalidadDefault: Modalidad | "" = id ? (disponibles.includes("Mes") ? "Mes" : disponibles[0] || "") : "";
    setModalidadPaquete(modalidadDefault);
    actualizarDepositoSegunSeleccion(oficinaId, id);
  }
  function seleccionarModalidadPaquete(m: Modalidad) {
    setModalidadPaquete(m);
  }

  // ---------- Comerciales ----------
  // Si venimos de un prospecto (ver props arriba, o del buscador de abajo),
  // precarga nombre/teléfono/correo en sus campos reales de "Datos
  // comerciales" — Observaciones solo se usa para el interés, que no tiene
  // campo propio.
  const observacionesProspecto = prospectoInteresPreseleccionado ? `Interés: ${prospectoInteresPreseleccionado}` : "";
  const [tipoProspecto, setTipoProspecto] = useState(prospectoNombrePreseleccionado ? "Nuevo" : "");
  const [tipoPersona, setTipoPersona] = useState<"fisica" | "moral" | "">("");
  const [razonSocial, setRazonSocial] = useState("");
  const [rfc, setRfc] = useState(prospectoRfcPreseleccionado || "");
  const [nombreContesta, setNombreContesta] = useState(prospectoNombrePreseleccionado || "");
  const [telefonoContesta, setTelefonoContesta] = useState(prospectoTelefonoPreseleccionado || "");
  const [correoContesta, setCorreoContesta] = useState(prospectoEmailPreseleccionado || "");
  const [observaciones, setObservaciones] = useState(observacionesProspecto);
  const [tipoCotizacionVenta, setTipoCotizacionVenta] = useState<"Reserva" | "Contrato" | "">("");
  const [medioContacto, setMedioContacto] = useState("");
  // Dato específico del medio de contacto elegido (el usuario/perfil si son
  // Redes sociales, quién refirió si es Referido, etc.) — no tiene columna
  // propia en cotizaciones_comerciales, se agrega como texto a
  // "Observaciones" al guardar. Cuando el medio es "Teléfono" NO se usa
  // este campo — se pediría el mismo número dos veces, así que se
  // reutiliza directamente el campo "Teléfono" de abajo (telefonoContesta).
  const [detalleMedioContacto, setDetalleMedioContacto] = useState("");
  const labelDetalleMedioContacto: Record<string, string> = {
    Teléfono: "Número de teléfono",
    "Redes sociales": "Usuario / red social",
    Referido: "Quién lo refirió",
    "Página web": "Página o formulario",
    Otro: "Especifica",
  };
  const detalleContactoEfectivo = medioContacto === "Teléfono" ? telefonoContesta : detalleMedioContacto;

  function observacionesConDetalle() {
    const detalle = detalleContactoEfectivo.trim()
      ? `${labelDetalleMedioContacto[medioContacto] || "Contacto"}: ${detalleContactoEfectivo.trim()}`
      : "";
    return [observaciones.trim(), detalle].filter(Boolean).join(" · ") || null;
  }
  const [numeroPersonas, setNumeroPersonas] = useState("");
  // Solo aplica a la renovación de un contrato que ya existía — el % de
  // incremento no debe pedirse en una cotización nueva.
  const [esRenovacion, setEsRenovacion] = useState(false);
  const [porcentajeIncremento, setPorcentajeIncremento] = useState("");

  // ---------- Renovación: contrato a renovar (solo con cliente existente) ----------
  // Al elegir cuál de los contratos vigentes del cliente se está renovando,
  // se precarga la oficina que ya tenía (se puede cambiar a otra disponible
  // si el cliente quiere una nueva) y las horas de sala de juntas quedan
  // editables a mano — un cambio de oficina/paquete puede subirlas o
  // bajarlas y aquí se decide caso por caso, no automático.
  type ContratoVigenteCliente = {
    id: string;
    oficina_id: string | null;
    horas_sala_juntas: number | null;
    renta_mensual: number | null;
    deposito_garantia: number | null;
    fecha_vencimiento: string;
  };
  const [contratosClienteVigentes, setContratosClienteVigentes] = useState<ContratoVigenteCliente[]>([]);
  const [contratoARenovarId, setContratoARenovarId] = useState("");
  const [horasSalaJuntasManual, setHorasSalaJuntasManual] = useState("");
  // Qué hacer con el contrato elegido arriba, una vez que ya se sabe cuál
  // es: "renovar" lo actualiza en el mismo lugar (misma oficina, datos que
  // se pueden ajustar); "agregar" hace lo mismo Y suma una oficina nueva al
  // mismo contrato (como adicional); "cambiar" crea un contrato NUEVO con
  // la oficina distinta y da de baja el anterior.
  const [modoRenovacion, setModoRenovacion] = useState<"" | "renovar" | "cambiar" | "agregar">("");
  // Oficina que se suma en modo "agregar" — selección independiente de la
  // oficina principal (que sigue siendo la del contrato que se renueva).
  const [oficinaNuevaId, setOficinaNuevaId] = useState("");
  const oficinaNueva = oficinas.find((o) => o.id === oficinaNuevaId) || null;
  // Tipo/oficina originales del contrato elegido — se guardan aparte porque
  // "Cambiar tipo de espacio" reutiliza tipoEspacio/oficinaId (los mismos
  // campos que muestran la oficina bloqueada en "Renovación") para que el
  // staff elija la oficina nueva. Sin este respaldo, al volver a la pestaña
  // "Renovación" se quedaba viendo la oficina nueva en vez de la original.
  const [oficinaOriginalRenovacion, setOficinaOriginalRenovacion] = useState<{ id: string; tipo: string } | null>(
    null
  );

  useEffect(() => {
    if (!clienteId) {
      setContratosClienteVigentes([]);
      setContratoARenovarId("");
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("contratos")
        .select("id, oficina_id, horas_sala_juntas, renta_mensual, deposito_garantia, fecha_vencimiento")
        .eq("user_id", clienteId)
        .eq("estatus", "vigente")
        .order("fecha_vencimiento", { ascending: false });
      setContratosClienteVigentes(data || []);
    })();
  }, [clienteId]);

  // Mismo patrón de hidratación en dos pasos que ya usa el handoff desde
  // /mapa-oficinas (ver hidratadoDesdeUrl más abajo): si hay que fijar
  // tipoEspacio primero, el efecto se corta y espera al siguiente render,
  // porque oficinasDelTipo (derivado por useMemo del tipoEspacio todavía
  // viejo) no habría recalculado a tiempo para encontrar la oficina.
  const contratoARenovarAplicadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contratoARenovarId) return;
    if (contratoARenovarAplicadoRef.current === contratoARenovarId) return;
    const contratoElegido = contratosClienteVigentes.find((c) => c.id === contratoARenovarId);
    if (!contratoElegido) return;
    setHorasSalaJuntasManual(String(contratoElegido.horas_sala_juntas ?? 0));
    if (!contratoElegido.oficina_id) {
      contratoARenovarAplicadoRef.current = contratoARenovarId;
      return;
    }
    const oficinaDelContrato = oficinas.find((o) => o.id === contratoElegido.oficina_id);
    if (!oficinaDelContrato) return; // oficinas todavía no cargó
    if (tipoEspacio !== oficinaDelContrato.tipo) {
      setTipoEspacio(oficinaDelContrato.tipo);
      return;
    }
    seleccionarOficina(oficinaDelContrato.id);
    setOficinaOriginalRenovacion({ id: oficinaDelContrato.id, tipo: oficinaDelContrato.tipo });
    contratoARenovarAplicadoRef.current = contratoARenovarId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoARenovarId, contratosClienteVigentes, oficinas, tipoEspacio]);

  // ---------- Fechas ----------
  // Para oficinas la modalidad siempre es "Mes"; para paquetes depende de
  // la tarifa elegida (Hora/Día/Semana/Mes).
  const modalidadEfectiva: Modalidad | "" = paquete ? modalidadPaquete : oficina ? "Mes" : "";
  const esHora = modalidadEfectiva === "Hora";
  const esDia = modalidadEfectiva === "Día";
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().split("T")[0]);
  const [cantidadPeriodo, setCantidadPeriodo] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [horaInicio, setHoraInicio] = useState(HORAS[0]);

  useEffect(() => {
    if (modalidadEfectiva === "Hora") {
      setFechaFin(fechaInicio);
      return;
    }
    const cantidad = Number(cantidadPeriodo);
    if (modalidadEfectiva && cantidad > 0) setFechaFin(sumarPeriodo(fechaInicio, modalidadEfectiva, cantidad));
  }, [fechaInicio, cantidadPeriodo, modalidadEfectiva]);

  const horaFinCalculada = esHora ? horaInicio + (Number(cantidadPeriodo) || 0) : null;

  // ---------- Handoff desde /mapa-oficinas (verificación de disponibilidad) ----------
  // Reutiliza las funciones de selección que ya existen en vez de duplicar
  // la lógica de negocio. Si hay que fijar tipoEspacio primero, el efecto
  // se corta y espera al siguiente render — si no, oficinasDelTipo/
  // paquetesDelTipo (derivados por useMemo del tipoEspacio todavía viejo)
  // no habrían recalculado a tiempo y la selección fallaría en silencio.
  const hidratadoDesdeUrl = useRef(false);
  useEffect(() => {
    if (hidratadoDesdeUrl.current || loading) return;
    if (!tipoEspacioPreseleccionado && !oficinaPreseleccionadaId && !paquetePreseleccionadoId && !fechaInicioPreseleccionada) return;

    if (tipoEspacioPreseleccionado && tipoEspacio !== tipoEspacioPreseleccionado) {
      setTipoEspacio(tipoEspacioPreseleccionado);
      return;
    }

    hidratadoDesdeUrl.current = true;
    if (oficinaPreseleccionadaId) seleccionarOficina(oficinaPreseleccionadaId);
    else if (paquetePreseleccionadoId) seleccionarPaquete(paquetePreseleccionadoId);
    if (fechaInicioPreseleccionada) setFechaInicio(fechaInicioPreseleccionada);
    if (cantidadPreseleccionada) setCantidadPeriodo(cantidadPreseleccionada);
    if (modalidadPreseleccionada) setModalidadPaquete(modalidadPreseleccionada as Modalidad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tipoEspacio]);

  // ---------- Precio ----------
  const [precioLista, setPrecioLista] = useState("");
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState("0");
  const [comentariosPrecio, setComentariosPrecio] = useState("");
  const [precioPactado, setPrecioPactado] = useState("");
  const [depositoGarantia, setDepositoGarantia] = useState("");
  // Promoción: no se cobra depósito en garantía. No borra el monto capturado
  // (depositoGarantia) para poder recuperarlo al desmarcar; solo lo anula.
  const [sinDepositoPromo, setSinDepositoPromo] = useState(false);
  const [cargoRecurrente, setCargoRecurrente] = useState(true);
  const [comentarios, setComentarios] = useState("");
  // Forma de pago: solo Oficina Privada puede elegir mes a mes; Coworking
  // siempre es por adelantado (ver lib/formaPago.ts).
  const [formaPago, setFormaPago] = useState<FormaPago>("adelantado");
  const permiteMensual = esOficinaPrivada(tipoEspacio);
  const esMensual = permiteMensual && formaPago === "mensual";
  useEffect(() => {
    if (!permiteMensual && formaPago !== "adelantado") setFormaPago("adelantado");
  }, [permiteMensual, formaPago]);

  // Tarifa unitaria vigente (por hora/día/semana/mes según corresponda):
  // la del paquete si hay uno elegido, si no la de la oficina.
  const tarifaUnitaria = useMemo(() => {
    if (paquete) return tarifaPaquete(paquete, modalidadPaquete);
    if (oficina) return oficina.precio ? Number(oficina.precio) || 0 : 0;
    return null;
  }, [paquete, modalidadPaquete, oficina]);

  // Precio de lista = tarifa unitaria × cantidad, recalculado en vivo cada
  // vez que cambia la cantidad, la oficina/paquete o la modalidad — así
  // incrementar o disminuir la cantidad sí actualiza el precio.
  useEffect(() => {
    if (esSalaJuntas) return; // el precio de Sala de Juntas se calcula en el efecto de abajo
    if (tarifaUnitaria == null) {
      setPrecioLista("");
      return;
    }
    const cantidad = Math.max(1, Number(cantidadPeriodo) || 1);
    setPrecioLista(String(round2(tarifaUnitaria * cantidad)));
  }, [tarifaUnitaria, cantidadPeriodo, esSalaJuntas]);

  // Precio de Sala de Juntas: tarifa fija por tramo (1 hora / 4-6 horas /
  // 1 día), NO lineal como paquetes — se toma tal cual de la tabla editable.
  useEffect(() => {
    if (!esSalaJuntas) return;
    setPrecioLista(salaPrecio != null ? String(salaPrecio) : "");
  }, [esSalaJuntas, salaPrecio]);

  // Recalcula precio pactado en vivo con precio de lista / descuento.
  useEffect(() => {
    const lista = Number(precioLista) || 0;
    const desc = Number(descuentoPorcentaje) || 0;
    setPrecioPactado(String(round2(lista - lista * (desc / 100))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precioLista, descuentoPorcentaje]);

  const precioPactadoNum = Number(precioPactado) || 0;
  const precioListaNum = Number(precioLista) || 0;
  const depositoNum = sinDepositoPromo ? 0 : Number(depositoGarantia) || 0;
  const notaSinDepositoPromo = "Sin depósito en garantía por promoción";
  // El depósito se cobra con IVA al aprobar el contrato (ver
  // ContratoModal.tsx → aprobar()) — se muestra aquí igual para que el
  // "Total primer pago" que ve el staff/cliente ya refleje el monto real
  // que se va a cobrar, no solo el depósito base.
  const depositoConIvaNum = round2(depositoNum * 1.16);
  const ivaMonto = round2(precioPactadoNum * 0.16);
  const precioNeto = round2(precioPactadoNum + ivaMonto);

  // ---------- Moneda ----------
  // Todos los montos de arriba (precio de lista/pactado/neto, depósito)
  // siempre están en pesos (MXN) — es lo único que entienden
  // contratos.renta_mensual y pagos.monto. "Moneda" solo agrega, como
  // referencia para el cliente, el equivalente automático en USD según
  // el tipo de cambio capturado; no cambia nada de lo que se guarda.
  const [moneda, setMoneda] = useState<"MXN" | "USD">("MXN");
  const [tipoCambio, setTipoCambio] = useState("");
  const tipoCambioNum = Number(tipoCambio) || 0;
  const mostrarUSD = moneda === "USD" && tipoCambioNum > 0;
  function aUSD(montoMXN: number) {
    return mostrarUSD ? round2(montoMXN / tipoCambioNum) : null;
  }

  // ---------- Adicionales (solo Contrato — la tabla contrato_adicionales
  // requiere un contrato_id). Se arman como borrador aquí y se insertan
  // junto con el contrato al confirmar; el pago de cada uno se genera
  // hasta que el contrato se aprueba (igual que la renta), no antes. ----------
  const [adicionalesDraft, setAdicionalesDraft] = useState<AdicionalDraft[]>([]);
  const [mostrarPickerAdicional, setMostrarPickerAdicional] = useState(false);
  const [busquedaAdicional, setBusquedaAdicional] = useState("");
  const [nuevoTipoAbierto, setNuevoTipoAbierto] = useState(false);
  const [nuevoTipoNombre, setNuevoTipoNombre] = useState("");
  const [nuevoTipoDescripcion, setNuevoTipoDescripcion] = useState("");
  const [nuevoTipoCosto, setNuevoTipoCosto] = useState("");
  const [procesandoAdicional, setProcesandoAdicional] = useState(false);
  const [errorAdicional, setErrorAdicional] = useState("");
  // Ids de contrato_adicionales (ya existentes en BD) marcados para borrar
  // al guardar la renovación — no se borran al momento del click porque el
  // staff puede seguir editando el formulario antes de confirmar.
  const [idsAdicionalesAEliminar, setIdsAdicionalesAEliminar] = useState<string[]>([]);
  // Copia congelada de los adicionales tal como estaban en BD al cargar el
  // contrato — a diferencia de adicionalesDraft (que el staff edita/borra
  // libremente), esto no cambia, es lo que alimenta el lado "Desglose
  // anterior" del comparativo más abajo.
  const [adicionalesExistentesOriginal, setAdicionalesExistentesOriginal] = useState<AdicionalDraft[]>([]);

  // Si el contrato que se está renovando/agregando ya tenía adicionales
  // (contrato_adicionales), se cargan aquí para que se vean y se puedan
  // editar/eliminar/agregar en la misma sección de abajo — antes esta
  // sección solo servía para adicionales nuevos y los de un contrato
  // existente eran invisibles para este formulario.
  const adicionalesExistentesCargadosRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contratoARenovarId) {
      adicionalesExistentesCargadosRef.current = null;
      return;
    }
    if (adicionalesExistentesCargadosRef.current === contratoARenovarId) return;
    adicionalesExistentesCargadosRef.current = contratoARenovarId;
    (async () => {
      const { data } = await supabase
        .from("contrato_adicionales")
        .select("id, adicional_id, concepto, descripcion, costo_unitario, cantidad")
        .eq("contrato_id", contratoARenovarId);
      if (data && data.length > 0) {
        const existentes = data.map((a) => ({
          clave: `existente-${a.id}`,
          id: a.id as string,
          adicional_id: a.adicional_id,
          concepto: a.concepto,
          descripcion: a.descripcion,
          costo_unitario: Number(a.costo_unitario) || 0,
          cantidad: Number(a.cantidad) || 1,
        }));
        setAdicionalesDraft((prev) => [...prev, ...existentes]);
        setAdicionalesExistentesOriginal(existentes);
      }
    })();
  }, [contratoARenovarId]);

  const totalAdicionales = useMemo(
    () => adicionalesDraft.reduce((s, a) => s + a.costo_unitario * a.cantidad, 0),
    [adicionalesDraft]
  );
  // El Estacionamiento y el DID son los adicionales que llevan IVA. costo_unitario
  // se sigue guardando sin IVA por dentro (igual que antes); esta suma es
  // la que refleja lo que realmente se cobra y se usa para mostrar al
  // staff (encabezado de Adicionales, Desglose) — el campo editable de
  // cada adicional ya muestra/captura el monto con IVA para Estacionamiento
  // (ver el input de costo_unitario más abajo), pero por dentro sigue
  // siendo el mismo valor base.
  function sumarAdicionalesConIva(items: { concepto: string; costo_unitario: number; cantidad: number }[]) {
    return round2(
      items.reduce((s, a) => {
        const subtotal = a.costo_unitario * a.cantidad;
        return s + (llevaIva(a.concepto) ? subtotal * 1.16 : subtotal);
      }, 0)
    );
  }
  const totalAdicionalesConIva = useMemo(() => sumarAdicionalesConIva(adicionalesDraft), [adicionalesDraft]);
  // Mes a mes: lo que se guarda como renta del contrato (y se cobra al
  // aprobarlo) es UN mes con IVA; por adelantado, todo el periodo.
  const mesesCotizados = Math.max(1, Number(cantidadPeriodo) || 1);
  const rentaContrato = esMensual ? rentaMensualConIva(precioNeto, mesesCotizados) : precioNeto;
  // Divide los montos del Desglose por mes cuando es mes a mes.
  const divisorMes = esMensual ? mesesCotizados : 1;
  const totalPrimerPago = round2(rentaContrato + depositoConIvaNum + totalAdicionalesConIva);

  // ---------- "Desglose anterior" en las pestañas de renovación ----------
  const contratoOriginalRenovacion = contratosClienteVigentes.find((c) => c.id === contratoARenovarId) || null;
  const rentaOriginalRenovacion = contratoOriginalRenovacion?.renta_mensual ?? null;
  const oficinaOriginalRenovacionObj = oficinas.find((o) => o.id === contratoOriginalRenovacion?.oficina_id) || null;
  const contratoOriginalOficinaLabel = oficinaOriginalRenovacionObj
    ? `${oficinaOriginalRenovacionObj.tipo} ${oficinaOriginalRenovacionObj.numero}`
    : "—";
  // Cualquiera de las 3 pestañas de renovación con contrato ya elegido —
  // controla el layout de dos columnas del Desglose (igual en las 3).
  const esRenovacionActiva = esRenovacion && !!contratoARenovarId && !!modoRenovacion;
  // Solo para el renglón extra de "Agregar tipo de espacio" en el
  // Desglose — mismo cálculo que ejecutarAgregarEspacio, nada más para
  // que se vea reflejado ANTES de guardar (el guardado real vive allá).
  const incrementoRenovacionNum = Number(porcentajeIncremento) || 0;
  const rentaConIncrementoPreview =
    incrementoRenovacionNum > 0 && rentaOriginalRenovacion != null
      ? round2(Number(rentaOriginalRenovacion) * (1 + incrementoRenovacionNum / 100))
      : rentaOriginalRenovacion;
  // La oficina nueva (agregar) puede tener un paquete vinculado igual que
  // la principal — si lo tiene, su tarifa mensual sale de ahí (oficina.precio
  // se queda en 0 a propósito para esas oficinas, el precio real vive en el
  // paquete). Sin paquete, se usa el precio propio de la oficina. No se
  // cobra depósito aparte por esta oficina — el del cliente ya cubre todo
  // el contrato.
  const paqueteVinculadoOficinaNueva = oficinaNueva?.paquete_default_id
    ? paquetes.find((p) => p.id === oficinaNueva.paquete_default_id) || null
    : null;
  const costoMensualOficinaNueva = paqueteVinculadoOficinaNueva
    ? Number(tarifaPaquete(paqueteVinculadoOficinaNueva, "Mes") ?? 0)
    : Number(oficinaNueva?.precio || 0);
  const rentaNuevaConOficinaAgregada =
    modoRenovacion === "agregar" && oficinaNueva && rentaConIncrementoPreview != null
      ? round2(Number(rentaConIncrementoPreview) + costoMensualOficinaNueva)
      : null;
  // "Cambiar tipo de espacio" sí usa el desglose completo de precio de
  // lista/IVA/depósito (crea un contrato nuevo con esa oficina/paquete).
  // "Renovación"/"Agregar" actualizan el contrato en su lugar — ese
  // desglose no aplica ahí, así que se reemplaza por uno simplificado con
  // solo lo que de verdad se guarda (renta + incremento + oficina agregada
  // + adicionales), para no mostrar un "Total primer pago" que nunca se
  // cobra.
  const esRenovarOAgregarActiva =
    esRenovacion && !!contratoARenovarId && (modoRenovacion === "renovar" || modoRenovacion === "agregar");
  const totalMensualNuevoSimplificado = round2(
    (modoRenovacion === "agregar" ? rentaNuevaConOficinaAgregada : rentaConIncrementoPreview) != null
      ? Number(modoRenovacion === "agregar" ? rentaNuevaConOficinaAgregada : rentaConIncrementoPreview) +
          totalAdicionalesConIva
      : totalAdicionalesConIva
  );

  const catalogoFiltrado = useMemo(() => {
    if (!busquedaAdicional.trim()) return catalogoAdicionales;
    const q = busquedaAdicional.toLowerCase();
    return catalogoAdicionales.filter((c) => c.nombre.toLowerCase().includes(q) || (c.descripcion || "").toLowerCase().includes(q));
  }, [busquedaAdicional, catalogoAdicionales]);

  const idsCatalogoYaAgregados = new Set(adicionalesDraft.map((a) => a.adicional_id).filter(Boolean));

  function agregarAdicionalDelCatalogo(item: CatalogoAdicional) {
    setAdicionalesDraft((prev) => [
      ...prev,
      {
        clave: `cat-${item.id}`,
        adicional_id: item.id,
        concepto: item.nombre,
        descripcion: item.descripcion,
        costo_unitario: item.costo_unitario,
        cantidad: 1,
      },
    ]);
  }

  function actualizarAdicionalDraft(clave: string, campo: "costo_unitario" | "cantidad", valor: string) {
    const num = Number(valor);
    if (Number.isNaN(num)) return;
    setAdicionalesDraft((prev) =>
      prev.map((a) =>
        a.clave === clave
          ? { ...a, [campo]: campo === "cantidad" ? Math.max(1, num) : num }
          : a
      )
    );
  }

  function eliminarAdicionalDraft(clave: string) {
    setAdicionalesDraft((prev) => {
      const item = prev.find((a) => a.clave === clave);
      if (item?.id) {
        // Ya existe en BD — se marca para borrar hasta que se guarde,
        // no se toca la base de datos todavía.
        setIdsAdicionalesAEliminar((ids) => [...ids, item.id!]);
      }
      return prev.filter((a) => a.clave !== clave);
    });
  }

  async function crearTipoAdicionalYAgregar() {
    if (!nuevoTipoNombre.trim()) {
      setErrorAdicional("Ponle un nombre al nuevo adicional");
      return;
    }
    setErrorAdicional("");
    setProcesandoAdicional(true);
    const { data, error: insertError } = await supabase
      .from("adicionales_catalogo")
      .insert({
        centro,
        nombre: nuevoTipoNombre.trim(),
        descripcion: nuevoTipoDescripcion.trim() || null,
        costo_unitario: Number(nuevoTipoCosto) || 0,
      })
      .select()
      .single();
    setProcesandoAdicional(false);
    if (insertError || !data) {
      setErrorAdicional("No se pudo crear el nuevo tipo de adicional (¿ya existe uno con ese nombre?).");
      return;
    }
    setCatalogoAdicionales((prev) => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setNuevoTipoNombre("");
    setNuevoTipoDescripcion("");
    setNuevoTipoCosto("");
    setNuevoTipoAbierto(false);
    agregarAdicionalDelCatalogo(data);
  }

  // ---------- Envío ----------
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  // Resultado visible después de crear una cotización de Sala de Juntas —
  // a diferencia del flujo de Oficina/Paquete, aquí NO se navega fuera del
  // panel automáticamente, así que esto es lo que le confirma al admin que
  // sí se guardó (antes se salía del panel sin avisar nada).
  const [salaResultado, setSalaResultado] = useState<{ mensaje: string } | null>(null);
  // Igual, pero para Oficina Privada/Coworking/Working Desk: ese flujo sí
  // navega a /dashboard al terminar (para ver la oficina ya ocupada), pero
  // antes se quedaba sin avisar nada — ahora se muestra la misma pantalla
  // de "¡Listo!" hasta que el staff le da clic a "Ir al dashboard".
  const [espacioResultado, setEspacioResultado] = useState<{ mensaje: string } | null>(null);

  function continuarDespuesDeEspacio() {
    onRegistrado();
    router.push(`/dashboard?exito=plan`);
  }

  function crearOtraCotizacionSala() {
    setSalaResultado(null);
    setSalaTamanoId("");
    setSeleccionSala(null);
    setClienteId("");
    setProspectoSeleccionadoId("");
    setBusqueda("");
    setNombreContesta("");
    setTelefonoContesta("");
    setCorreoContesta("");
    setObservaciones("");
    setDetalleMedioContacto("");
    setMedioContacto("");
    setTipoPersona("");
    setNumeroPersonas("");
    setQuiereCoffee(false);
    setPaqueteCoffeeId("");
    setPersonasCoffee("");
  }

  // ---------- Coffee Break (opcional, por si el cliente también lo
  // quiere) — mismos paquetes y misma cuenta que usa el cliente al
  // reservar en /reservaciones. Es un agregado aparte, no toca
  // precioLista/precioPactado/precioNeto (esos siguen siendo solo la
  // renta del espacio) — se guarda en sus propias columnas y se muestra
  // sumado aparte en el resumen. ----------
  const [quiereCoffee, setQuiereCoffee] = useState(false);
  const [paqueteCoffeeId, setPaqueteCoffeeId] = useState("");
  const [personasCoffee, setPersonasCoffee] = useState<number | "">("");
  const paqueteCoffee = coffeeBreakPaquetes.find((p) => p.id === paqueteCoffeeId) || null;
  const personasCoffeeNum = Number(personasCoffee) || 0;
  const coffeeBreakFaltaMinimo = !!(
    paqueteCoffee && personasCoffeeNum > 0 && personasCoffeeNum < paqueteCoffee.minimo_personas
  );
  const totalCoffeeBreak =
    quiereCoffee && paqueteCoffee
      ? round2(
          paqueteCoffee.precio_persona *
            personasCoffeeNum *
            (paqueteCoffee.promocion_activa ? 1 - paqueteCoffee.descuento_porcentaje / 100 : 1)
        )
      : 0;
  // Solo aplica a Sala de Juntas (el checkbox de Coffee Break no se
  // muestra para Oficina/Paquete, así que ahí totalCoffeeBreak siempre da 0).
  const totalPrimerPagoConCoffee = round2(totalPrimerPago + (esSalaJuntas ? totalCoffeeBreak : 0));

  const espacioListo = !!oficinaId || !!paqueteId || (esSalaJuntas && !!salaTamanoId && !!seleccionSala);
  const nombreEspacio = esSalaJuntas
    ? `Sala de Juntas ${salaSeleccionada?.tamano || ""}`
    : [paquete ? `Paquete: ${paquete.nombre}` : null, oficina ? `Oficina ${oficina.numero}` : null]
        .filter(Boolean)
        .join(" · ");

  // Cotización de Sala de Juntas: SOLO crea el registro en
  // `cotizaciones_comerciales` (oficina_id y paquete_id quedan null). NO
  // crea reservación ni contrato — eso lo hace el admin a mano después,
  // solo si el cliente autoriza (decisión explícita del usuario).
  async function crearCotizacionSalaJuntas() {
    if (!salaSeleccionada) {
      setError("Elige el tamaño de sala");
      return;
    }
    if (!seleccionSala) {
      setError("Elige la fecha y hora en el calendario");
      return;
    }
    if (!fechaInicio) {
      setError("Completa la fecha");
      return;
    }
    if (!precioPactado) {
      setError("Falta el precio pactado");
      return;
    }
    if (moneda === "USD" && tipoCambioNum <= 0) {
      setError("Captura el tipo de cambio para cotizar en USD");
      return;
    }
    if (quiereCoffee && !paqueteCoffee) {
      setError("Elige un paquete de Coffee Break o desmarca la casilla");
      return;
    }
    if (coffeeBreakFaltaMinimo) {
      setError(`Ese paquete de Coffee Break requiere un mínimo de ${paqueteCoffee?.minimo_personas} persona(s)`);
      return;
    }
    if (!tipoPersona) {
      setError("Selecciona si es persona física o moral");
      return;
    }
    if (tipoPersona === "moral" && !razonSocial.trim()) {
      setError("Falta la razón social de la empresa");
      return;
    }
    setError("");
    setGuardando(true);

    const clienteIdEfectivo = cliente?.id || null;
    const duracionLabel = `${duracionSalaSeleccion} hora${duracionSalaSeleccion === 1 ? "" : "s"}`;
    const horarioLabel = `${formatHora(seleccionSala.horaInicio)} - ${formatHora(seleccionSala.horaFin)}`;

    const { data: cotizacion, error: cotError } = await supabase.from("cotizaciones_comerciales").insert({
      centro,
      cliente_id: clienteIdEfectivo,
      prospecto_id: prospectoIdPreseleccionado || null,
      tipo_persona: tipoPersona || null,
      razon_social: tipoPersona === "moral" ? razonSocial.trim() || null : null,
      rfc: null,
      renovacion: false,
      oficina_id: null,
      paquete_id: null,
      tipo_espacio: `${SALA_JUNTAS_TIPO} ${salaSeleccionada.tamano} · ${duracionLabel} · ${horarioLabel}`,
      tipo_prospecto: tipoProspecto || null,
      nombre_contesta_telefono: nombreContesta || null,
      telefono_contesta: telefonoContesta || null,
      correo_contesta: correoContesta || null,
      observaciones: observacionesConDetalle(),
      // Sin selector de "Tipo de cotización / venta" en este flujo por
      // ahora (se agregará en otro apartado más adelante) — se guarda el
      // valor interno fijo ("Reserva") para no romper la columna si tiene
      // NOT NULL; no se usa para crear ninguna reservación real.
      tipo_cotizacion_venta: tipoCotizacionVenta || "Reserva",
      medio_contacto: medioContacto || null,
      numero_personas: numeroPersonas ? Number(numeroPersonas) : null,
      domicilio_fiscal: false, // el checkbox de "Domicilio fiscal" se quitó del formulario a petición del usuario
      porcentaje_incremento: null,
      fecha_inicio: fechaInicio,
      duracion_meses: null,
      modalidad_paquete: null,
      fecha_fin: fechaFin || fechaInicio,
      precio_lista: precioListaNum,
      descuento_porcentaje: Number(descuentoPorcentaje) || 0,
      comentarios_precio: comentariosPrecio || null,
      precio_pactado: precioPactadoNum,
      iva_monto: ivaMonto,
      precio_neto: precioNeto,
      deposito_garantia: 0,
      cargo_recurrente: false,
      moneda,
      tipo_cambio: moneda === "USD" ? tipoCambioNum : null,
      comentarios: comentarios || null,
      coffee_break_paquete_id: quiereCoffee && paqueteCoffee ? paqueteCoffee.id : null,
      coffee_break_personas: quiereCoffee && paqueteCoffee ? personasCoffeeNum : null,
      coffee_break_total: quiereCoffee && paqueteCoffee ? totalCoffeeBreak : null,
    }).select().single();

    setGuardando(false);
    if (cotError || !cotizacion) {
      setError("No se pudo guardar la cotización. Intenta de nuevo.");
      return;
    }

    // Nombre para el PowerPoint/registro en Cotizaciones: el cliente si se
    // eligió uno, si no el nombre que el admin escribió en "Nombre de quién
    // solicita la cotización" — nunca el genérico "Prospecto" mientras haya
    // un nombre capturado.
    const nombreParaMostrar = cliente ? etiquetaCliente(cliente) : nombreContesta.trim() || "Prospecto sin nombre";

    // Genera el PowerPoint ya llenado y lo deja en /cotizaciones — no
    // bloquea el éxito de la cotización si esto falla (ej. centro sin
    // plantilla todavía), solo se avisa aparte.
    let mensajePptx = "";
    try {
      // Si el cliente también pidió Coffee Break, se suma al subtotal antes
      // de sacar el IVA — así el PowerPoint (y la cotización interna) le
      // muestran al cliente el total real que va a pagar por todo junto,
      // no solo por la sala. precio_pactado/iva_monto/precio_neto que se
      // guardaron arriba en cotizaciones_comerciales siguen siendo SOLO de
      // la sala (eso no cambia), esto es nada más para lo que se le
      // muestra al cliente en el documento.
      // El Coffee Break va como SEGUNDA fila aparte en la tabla del
      // PowerPoint (desglosado), no mezclado en la descripción de la sala.
      // El precio unitario de esa fila ya incluye la promoción si aplica
      // (ver totalCoffeeBreak/paqueteCoffee arriba).
      const hayCoffee = quiereCoffee && !!paqueteCoffee;
      const precioUnitarioCoffee = hayCoffee
        ? paqueteCoffee!.promocion_activa
          ? round2(paqueteCoffee!.precio_persona * (1 - paqueteCoffee!.descuento_porcentaje / 100))
          : paqueteCoffee!.precio_persona
        : undefined;
      const subtotalConCoffee = round2(precioPactadoNum + (hayCoffee ? totalCoffeeBreak : 0));
      const ivaMontoConCoffee = round2(subtotalConCoffee * 0.16);
      const totalConCoffee = round2(subtotalConCoffee + ivaMontoConCoffee);

      const resp = await fetch("/api/cotizar-sala-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centro,
          cotizacionComercialId: cotizacion.id,
          tamano: salaSeleccionada.tamano,
          descripcion: `${SALA_JUNTAS_TIPO} ${salaSeleccionada.tamano} · ${duracionLabel} · ${horarioLabel} · ${seleccionSala.fecha}`,
          precioUnitario: precioPactadoNum,
          subtotal: subtotalConCoffee,
          ivaMonto: ivaMontoConCoffee,
          total: totalConCoffee,
          coffeeDescripcion: hayCoffee ? `Coffee Break "${paqueteCoffee!.nombre}"` : undefined,
          coffeeCantidad: hayCoffee ? personasCoffeeNum : undefined,
          coffeePrecioUnitario: hayCoffee ? precioUnitarioCoffee : undefined,
          coffeeTotal: hayCoffee ? totalCoffeeBreak : undefined,
          nombreCotizacion: `${nombreParaMostrar} · Sala de Juntas ${salaSeleccionada.tamano}`,
          // Cada dato en su propia línea (en vez de todo pegado con "·") para
          // que se vea ordenado en /cotizaciones — ahí se renderiza con
          // whiteSpace: "pre-line" para respetar estos saltos de línea.
          notas: [
            `📅 ${seleccionSala.fecha} · ${horarioLabel}`,
            detalleContactoEfectivo.trim()
              ? `${medioContacto === "Teléfono" ? "📞" : "✉️"} ${labelDetalleMedioContacto[medioContacto] || "Contacto"}: ${detalleContactoEfectivo.trim()}`
              : null,
            observaciones.trim() ? `📝 ${observaciones.trim()}` : null,
            hayCoffee ? `☕ Coffee Break "${paqueteCoffee!.nombre}" · ${personasCoffeeNum} personas · $${totalCoffeeBreak.toLocaleString("es-MX")}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          nombreDestinatario: nombreParaMostrar,
        }),
      });
      if (resp.ok) {
        mensajePptx = "El PowerPoint ya está listo en el módulo Cotizaciones.";
      } else {
        const data = await resp.json().catch(() => ({}));
        mensajePptx = `El PowerPoint no se generó (${data?.error || "intenta subirlo manualmente desde Cotizaciones"}).`;
      }
    } catch {
      mensajePptx = "El PowerPoint no se generó (sin conexión). Intenta subirlo manualmente desde Cotizaciones.";
    }

    setEnviado(true);
    setSalaResultado({ mensaje: `✅ Cotización guardada. ${mensajePptx}` });
    // A propósito NO llamamos a onRegistrado() ni navegamos aquí: el padre
    // (registrar-plan/page.tsx) usa onRegistrado para cambiar la `key` del
    // formulario y remontarlo desde cero, lo que borraría salaResultado en
    // el mismo instante que lo acabamos de guardar y el aviso nunca se
    // llegaría a ver. Se llama hasta que el admin decide seguir (botón
    // "Cotizar otra Sala de Juntas") en crearOtraCotizacionSala().
  }

  // Aplica al contrato que se está renovando/agregando los cambios que se
  // hicieron en la sección "Adicionales": borra los marcados con la 🗑,
  // actualiza costo/cantidad de los que ya existían y edita, e inserta los
  // que se agregaron nuevos desde el catálogo. Se usa en "Renovación" y
  // "Agregar tipo de espacio" (ambas actualizan el mismo contrato); "Cambiar
  // tipo de espacio" no la usa porque crea un contrato nuevo — ahí solo se
  // insertan los adicionales nuevos, los del contrato anterior no se
  // trasladan solos.
  async function sincronizarAdicionalesDelContrato(contratoId: string) {
    if (idsAdicionalesAEliminar.length > 0) {
      await supabase.from("contrato_adicionales").delete().in("id", idsAdicionalesAEliminar);
    }
    const existentesEditados = adicionalesDraft.filter((a) => a.id);
    await Promise.all(
      existentesEditados.map((a) =>
        supabase
          .from("contrato_adicionales")
          .update({ costo_unitario: a.costo_unitario, cantidad: a.cantidad, monto: a.costo_unitario * a.cantidad })
          .eq("id", a.id!)
      )
    );
    const nuevos = adicionalesDraft.filter((a) => !a.id);
    if (nuevos.length > 0) {
      await supabase.from("contrato_adicionales").insert(
        nuevos.map((a) => ({
          contrato_id: contratoId,
          adicional_id: a.adicional_id,
          concepto: a.concepto,
          descripcion: a.descripcion,
          costo_unitario: a.costo_unitario,
          cantidad: a.cantidad,
          monto: a.costo_unitario * a.cantidad,
        }))
      );
    }
    setIdsAdicionalesAEliminar([]);
  }

  // Renovación "en línea": actualiza el contrato elegido en su lugar (misma
  // oficina, mismo registro) — no crea cotización ni contrato nuevos. El %
  // de incremento se aplica sobre la renta que YA tenía ese contrato
  // (mismo cálculo que ya usa /contratos → guardarRenovacion), no sobre lo
  // que calcule el formulario, para no depender de que el paquete/oficina
  // hidratados reproduzcan exacto el precio original.
  async function ejecutarRenovacionEnLinea() {
    if (!fechaFin) {
      setError("Completa la fecha de vencimiento");
      return;
    }
    setError("");
    setGuardando(true);
    const contratoOriginal = contratosClienteVigentes.find((c) => c.id === contratoARenovarId);
    const incremento = Number(porcentajeIncremento) || 0;
    const nuevaRenta =
      incremento > 0 && contratoOriginal?.renta_mensual != null
        ? round2(Number(contratoOriginal.renta_mensual) * (1 + incremento / 100))
        : contratoOriginal?.renta_mensual ?? null;

    const { error: updateError } = await supabase
      .from("contratos")
      .update({
        fecha_vencimiento: fechaFin,
        ...(nuevaRenta != null ? { renta_mensual: nuevaRenta } : {}),
        horas_sala_juntas: Number(horasSalaJuntasManual) || 0,
      })
      .eq("id", contratoARenovarId);

    if (updateError) {
      setGuardando(false);
      setError("No se pudo renovar el contrato. Intenta de nuevo.");
      return;
    }
    await sincronizarAdicionalesDelContrato(contratoARenovarId);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    setEspacioResultado({ mensaje: "El contrato se renovó correctamente." });
  }

  // Renovación + agregar oficina: mismo cálculo de renta que arriba, pero
  // además suma el costo mensual de la oficina elegida DIRECTO a
  // renta_mensual (no se queda solo en contrato_adicionales, que el cron
  // diario de facturación — app/api/cron/facturacion-diaria — nunca lee;
  // si no se suma ahí, la oficina nueva jamás se volvería a cobrar después
  // del primer mes). contrato_adicionales sigue llevando un renglón
  // descriptivo para que se vea desglosado qué parte de la renta
  // corresponde a la oficina agregada, pero ya no es lo que genera el cobro
  // recurrente. Además se genera de una vez el cobro proporcional de lo que
  // resta del mes actual (contrato.dia_pago sigue intacto — arranca a
  // cobrar el total combinado hasta el siguiente ciclo).
  async function ejecutarAgregarEspacio() {
    if (!fechaFin) {
      setError("Completa la fecha de vencimiento");
      return;
    }
    if (!oficinaNuevaId || !oficinaNueva) {
      setError("Elige la oficina que se va a agregar");
      return;
    }
    setError("");
    setGuardando(true);
    const contratoOriginal = contratosClienteVigentes.find((c) => c.id === contratoARenovarId);
    const incremento = Number(porcentajeIncremento) || 0;
    const rentaConIncremento =
      incremento > 0 && contratoOriginal?.renta_mensual != null
        ? round2(Number(contratoOriginal.renta_mensual) * (1 + incremento / 100))
        : contratoOriginal?.renta_mensual ?? null;
    // costoMensualOficinaNueva/depositoOficinaNueva ya consideran el
    // paquete vinculado de la oficina (si tiene) — usar oficinaNueva.precio
    // directo se quedaba en $0 para oficinas cuyo precio real vive en su
    // paquete, no en la oficina misma (mismo criterio que ya usa la
    // oficina principal vía tarifaUnitaria/actualizarDepositoSegunSeleccion).
    const costoOficinaNueva = costoMensualOficinaNueva;
    const nuevaRenta = rentaConIncremento != null ? round2(rentaConIncremento + costoOficinaNueva) : costoOficinaNueva;
    // No se cobra depósito aparte por la oficina agregada — el cliente ya
    // pagó el depósito de su primera oficina y eso cubre todo el contrato,
    // no se duplica al sumar más espacio.

    const { error: updateError } = await supabase
      .from("contratos")
      .update({
        fecha_vencimiento: fechaFin,
        renta_mensual: nuevaRenta,
        horas_sala_juntas: Number(horasSalaJuntasManual) || 0,
      })
      .eq("id", contratoARenovarId);
    if (updateError) {
      setGuardando(false);
      setError("No se pudo actualizar el contrato. Intenta de nuevo.");
      return;
    }

    await supabase.from("contrato_adicionales").insert({
      contrato_id: contratoARenovarId,
      adicional_id: null,
      concepto: `Oficina agregada: ${oficinaNueva.tipo} ${oficinaNueva.numero}`,
      descripcion: "Ya incluida en la renta mensual del contrato — este renglón es solo para desglose, no genera cobro aparte.",
      costo_unitario: costoOficinaNueva,
      cantidad: 1,
      monto: costoOficinaNueva,
    });
    await sincronizarAdicionalesDelContrato(contratoARenovarId);

    if (cliente?.id) {
      await supabase.from("oficinas").update({ cliente_id: cliente.id, estado: "ocupada" }).eq("id", oficinaNuevaId);
    }

    // Cobro proporcional de lo que queda del mes en curso — desde hoy hasta
    // fin de mes, sobre el costo mensual de la oficina nueva únicamente (la
    // oficina que ya tenía sigue su ciclo de cobro normal sin tocarse).
    const hoy = new Date();
    const diasEnElMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(0, diasEnElMes - hoy.getDate());
    const montoProporcional = round2((costoOficinaNueva / diasEnElMes) * diasRestantes);
    if (cliente?.id && montoProporcional > 0) {
      try {
        await fetch("/api/pagos/crear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: cliente.id,
            monto: montoProporcional,
            concepto: `Oficina agregada (prorrateo ${diasRestantes} días): ${oficinaNueva.tipo} ${oficinaNueva.numero}`,
            contratoId: contratoARenovarId,
            centro,
          }),
        });
      } catch {
        // no crítico — el cobro completo de todas formas ya queda
        // reflejado en renta_mensual para el siguiente ciclo.
      }
    }

    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    setEspacioResultado({
      mensaje:
        `Se agregó ${oficinaNueva.tipo} ${oficinaNueva.numero} al contrato (+$${costoOficinaNueva.toLocaleString("es-MX")}/mes, renta nueva $${nuevaRenta.toLocaleString("es-MX")}/mes).` +
        (montoProporcional > 0
          ? ` Se generó el cobro proporcional de $${montoProporcional.toLocaleString("es-MX")} por los ${diasRestantes} días que restan del mes.`
          : ""),
    });
  }

  async function crearCotizacion() {
    if (!tipoEspacio || !espacioListo) {
      setError("Selecciona un tipo de espacio y una oficina o paquete");
      return;
    }
    if (esSalaJuntas) {
      return crearCotizacionSalaJuntas();
    }
    // Renovar o agregar oficina no crean una cotización/contrato desde
    // cero — actualizan el contrato elegido arriba en su lugar, así que
    // se atajan aquí antes de pedir datos que ya conoce ese contrato
    // (RFC, persona física/moral, etc.).
    if (esRenovacion && contratoARenovarId) {
      if (!modoRenovacion) {
        setError("Elige qué hacer: Renovación, Cambiar tipo de espacio o Agregar tipo de espacio.");
        return;
      }
      if (modoRenovacion === "renovar") return ejecutarRenovacionEnLinea();
      if (modoRenovacion === "agregar") return ejecutarAgregarEspacio();
      // "cambiar" sigue el flujo normal de abajo (crea cotización + contrato
      // nuevo), solo que entra "vigente" directo y da de baja al anterior.
    }
    if (paquete && !modalidadPaquete) {
      setError("Elige la modalidad (hora, día, semana o mes) del paquete");
      return;
    }
    if (paquete && paquetesYaRegistrados.has(paquete.id)) {
      setError("Este cliente ya tiene ese paquete registrado en un contrato — elige otro.");
      return;
    }
    if (!fechaInicio || !fechaFin) {
      setError("Completa la fecha inicial y final");
      return;
    }
    if (!precioPactado) {
      setError("Falta el precio pactado");
      return;
    }
    if (moneda === "USD" && tipoCambioNum <= 0) {
      setError("Captura el tipo de cambio para cotizar en USD");
      return;
    }
    if (!tipoPersona) {
      setError("Selecciona si es persona física o moral");
      return;
    }
    if (tipoPersona === "moral" && !razonSocial.trim()) {
      setError("Falta la razón social de la empresa");
      return;
    }
    // Coffee Break es exclusivo de Sala de Juntas — no aplica en este flujo
    // de Coworking/Oficina Privada, así que no se valida aquí.
    setError("");
    setGuardando(true);

    const clienteIdEfectivo = cliente?.id || null;
    const esCambioDeEspacio = esRenovacion && modoRenovacion === "cambiar" && !!contratoARenovarId;
    // Oficina Privada guarda lo que se eligió; Coworking siempre es por
    // adelantado; el resto de tipos se queda en null (sin cambio de
    // comportamiento en el cron de facturación).
    const formaPagoGuardar: FormaPago | null = permiteMensual
      ? formaPago
      : tipoEspacio.trim().toLowerCase() === "coworking"
      ? "adelantado"
      : null;

    const { data: cotizacion, error: cotError } = await supabase
      .from("cotizaciones_comerciales")
      .insert({
        centro,
        cliente_id: clienteIdEfectivo,
        prospecto_id: prospectoIdPreseleccionado || null,
        tipo_persona: tipoPersona || null,
        razon_social: tipoPersona === "moral" ? razonSocial.trim() || null : null,
        rfc: rfc.trim() ? rfc.trim().toUpperCase() : null,
        renovacion: esRenovacion,
        oficina_id: oficina?.id || null,
        paquete_id: paquete?.id || null,
        tipo_espacio: tipoEspacio,
        tipo_prospecto: tipoProspecto || null,
        nombre_contesta_telefono: nombreContesta || null,
        telefono_contesta: telefonoContesta || null,
        correo_contesta: correoContesta || null,
        observaciones: observacionesConDetalle(),
        tipo_cotizacion_venta: tipoCotizacionVenta,
        medio_contacto: medioContacto || null,
        numero_personas: numeroPersonas ? Number(numeroPersonas) : null,
        domicilio_fiscal: false, // el checkbox de "Domicilio fiscal" se quitó del formulario a petición del usuario
        porcentaje_incremento: porcentajeIncremento ? Number(porcentajeIncremento) : null,
        fecha_inicio: fechaInicio,
        duracion_meses: cantidadPeriodo ? Number(cantidadPeriodo) : null,
        modalidad_paquete: paquete ? modalidadPaquete : null,
        fecha_fin: fechaFin,
        precio_lista: precioListaNum,
        descuento_porcentaje: Number(descuentoPorcentaje) || 0,
        comentarios_precio:
          [comentariosPrecio.trim(), sinDepositoPromo ? notaSinDepositoPromo : ""].filter(Boolean).join(" · ") || null,
        precio_pactado: precioPactadoNum,
        iva_monto: ivaMonto,
        precio_neto: precioNeto,
        forma_pago: formaPagoGuardar,
        deposito_garantia: depositoNum,
        cargo_recurrente: cargoRecurrente,
        moneda,
        tipo_cambio: moneda === "USD" ? tipoCambioNum : null,
        comentarios: comentarios || null,
        coffee_break_paquete_id: quiereCoffee && paqueteCoffee ? paqueteCoffee.id : null,
        coffee_break_personas: quiereCoffee && paqueteCoffee ? personasCoffeeNum : null,
        coffee_break_total: quiereCoffee && paqueteCoffee ? totalCoffeeBreak : null,
      })
      .select()
      .single();

    if (cotError || !cotizacion) {
      setError("No se pudo guardar la cotización. Intenta de nuevo.");
      setGuardando(false);
      return;
    }

    // Ya no existe la bifurcación Reserva/Contrato: este formulario
    // SOLO genera cotizaciones. Se sigue creando de una vez el registro en
    // "contratos" (en pre_aprobado, sin PDF ni cobro todavía) para que el
    // ciclo de vida completo — subir firmado, aprobar, cobrar — se maneje
    // desde /contratos exactamente igual que cualquier otro contrato.
    let contratoIdCreado: string | null = null;

    // El PDF ya no se sube aquí — se sube después desde /contratos, junto
    // con la aprobación (ahí es donde de verdad vive el ciclo de vida del
    // contrato: pre_aprobado → subir firmado → aprobar).
    const { data: nuevoContrato, error: insertError } = await supabase
      .from("contratos")
      .insert({
        user_id: clienteIdEfectivo,
        centro,
        plan_id: null,
        // Copia directa del paquete_id — el cliente no tiene permiso de
        // RLS para leer cotizaciones_comerciales, así que se guarda aquí
        // también para poder resolver el nombre del paquete en su propio
        // dashboard consultando "paquetes" directamente.
        paquete_id: paquete?.id || null,
        // Mismo motivo que paquete_id arriba: copia directa para que el
        // cliente pueda resolver número/tipo de oficina en su dashboard
        // sin necesitar leer cotizaciones_comerciales.
        oficina_id: oficina?.id || null,
        fecha_inicio: fechaInicio,
        fecha_vencimiento: fechaFin,
        // "Cargo recurrente" solo se guarda como referencia en la cotización
        // (cargo_recurrente arriba) — el monto del contrato SIEMPRE se
        // registra aquí; de lo contrario el contrato queda en $0/mes en
        // /contratos y el pago que se genera al aprobarlo también sale en $0.
        // Mes a mes guarda la renta de UN mes con IVA (rentaContrato);
        // por adelantado sigue siendo el precio de todo el periodo.
        renta_mensual: rentaContrato,
        forma_pago: formaPagoGuardar,
        deposito_garantia: depositoNum,
        horas_sala_juntas: esRenovacion ? Number(horasSalaJuntasManual) || 0 : paquete?.incluye_horas_sala_juntas || 0,
        horas_bolsa: paquete?.horas_bolsa || 0,
        // El día de pago ya no se pregunta aquí — se vuelve a pedir,
        // opcional, hasta /alta-cliente (ver app/alta-cliente/page.tsx).
        // Mes a mes siempre es del 1 al 10, así que ya nace con día 1.
        dia_pago: esMensual ? 1 : null,
        // "Cambiar tipo de espacio" entra vigente de inmediato (el cliente
        // ya estaba vetado, no es alguien nuevo) — el resto de los casos
        // sigue el ciclo normal pre_aprobado → subir firmado → aprobar.
        estatus: esCambioDeEspacio ? "vigente" : "pre_aprobado",
        archivo_url: null,
        cotizacion_id: cotizacion.id,
      })
      .select()
      .single();

    if (insertError || !nuevoContrato) {
      setError("La cotización se guardó, pero no se pudo crear el contrato. Intenta de nuevo.");
      setGuardando(false);
      return;
    }
    contratoIdCreado = nuevoContrato.id;

    // Se insertan los adicionales ya (para que el contrato quede completo),
    // pero SIN generar su pago todavía — eso pasa hasta que se apruebe el
    // contrato (ver ContratoModal.tsx → aprobar()), igual que la renta.
    // Los que ya tienen "id" vienen del contrato anterior (se cargaron solo
    // para poder verlos/editarlos en esta misma pantalla) — no se
    // trasladan solos al nuevo, se quedan en el contrato viejo ya dado de
    // baja; aquí solo entran los que el staff agregó de verdad para este.
    const adicionalesNuevosParaCrear = adicionalesDraft.filter((a) => !a.id);
    if (adicionalesNuevosParaCrear.length > 0) {
      await supabase.from("contrato_adicionales").insert(
        adicionalesNuevosParaCrear.map((a) => ({
          contrato_id: contratoIdCreado,
          adicional_id: a.adicional_id,
          concepto: a.concepto,
          descripcion: a.descripcion,
          costo_unitario: a.costo_unitario,
          cantidad: a.cantidad,
          monto: a.costo_unitario * a.cantidad,
        }))
      );
    }

    await supabase
      .from("cotizaciones_comerciales")
      .update({ contrato_id: contratoIdCreado, reservacion_id: null })
      .eq("id", cotizacion.id);

    if (oficina && clienteIdEfectivo) {
      await supabase.from("oficinas").update({ cliente_id: clienteIdEfectivo, estado: "ocupada" }).eq("id", oficina.id);
    }

    if (esCambioDeEspacio) {
      // Da de baja el contrato que se está reemplazando — el nuevo ya
      // entró "vigente" arriba.
      await supabase.from("contratos").update({ estatus: "rechazado" }).eq("id", contratoARenovarId);

      // Como este contrato entra vigente directo (sin pasar por el
      // aprobar() manual de ContratoModal.tsx), sus cobros tampoco se
      // generarían solos — se crean aquí mismo para no dejarlo sin
      // facturar. Mismo patrón exacto que ContratoModal.tsx → aprobar().
      if (clienteIdEfectivo) {
        if (precioNeto > 0) {
          try {
            await fetch("/api/pagos/crear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clienteId: clienteIdEfectivo,
                monto: precioNeto,
                concepto: "Contrato",
                contratoId: contratoIdCreado,
                centro,
              }),
            });
          } catch {
            // no crítico
          }
        }
        if (depositoNum > 0) {
          const depositoConIva = round2(depositoNum * 1.16);
          try {
            await fetch("/api/pagos/crear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clienteId: clienteIdEfectivo,
                monto: depositoConIva,
                concepto: "Depósito en garantía (incl. IVA)",
                contratoId: contratoIdCreado,
                centro,
              }),
            });
          } catch {
            // no crítico
          }
        }
        for (const a of adicionalesDraft) {
          if (a.costo_unitario * a.cantidad > 0) {
            try {
              await fetch("/api/pagos/crear", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clienteId: clienteIdEfectivo,
                  monto: conIva(a.concepto, a.costo_unitario * a.cantidad),
                  concepto: `Adicional: ${a.concepto}`,
                  contratoId: contratoIdCreado,
                  centro,
                }),
              });
            } catch {
              // no crítico
            }
          }
        }
      }
    }

    // El pago ya no se genera aquí — nace hasta que el contrato se aprueba
    // (ver ContratoModal.tsx → aprobar()); el contrato nace en pre_aprobado
    // y no debe cobrarse antes. El bloque de "Reserva" (creaba una
    // reservación y cobraba de inmediato) se eliminó junto con el selector
    // de arriba — este formulario ya solo genera cotizaciones.

    // Igual que en Sala de Juntas: si el tipo de espacio ya tiene
    // plantilla de PowerPoint (Coworking, Oficina Privada y Working Desk —
    // este último reutiliza la plantilla de Oficina Privada, ver
    // lib/cotizacionEspacioPptx.ts), se genera solo y se manda a
    // /cotizaciones. No bloquea nada si falla o si el tipo todavía no
    // tiene plantilla.
    const tipoNormalizado = tipoEspacio.trim().toLowerCase();
    console.log("[cotizar-espacio-pptx] tipoEspacio:", JSON.stringify(tipoEspacio), "-> normalizado:", JSON.stringify(tipoNormalizado));
    if (tipoNormalizado === "coworking" || tipoNormalizado === "oficina privada" || tipoNormalizado === "working desk") {
      try {
        const nombreParaMostradorEspacio = cliente ? etiquetaCliente(cliente) : nombreContesta.trim() || "Prospecto sin nombre";
        // Los adicionales se suman aquí a subtotal/IVA/total para que el
        // PowerPoint refleje el precio real cotizado — antes se mandaba
        // solo el precio base y el PPT quedaba por debajo de lo que
        // realmente se le cobraría al cliente en cuanto tuviera adicionales.
        // El Estacionamiento se lista ya con IVA incluido (ver
        // lib/adicionales.ts) — su renglón muestra el precio final y por
        // eso NO entra a la base sobre la que se calcula el IVA de abajo;
        // el resto (paquete/oficina y demás adicionales) sigue igual. El
        // total resultante es el mismo de antes, solo cambia cómo se ve.
        // Mes a mes: el PowerPoint que recibe el cliente es de UN mes
        // (cantidad 1 y montos mensuales), no del periodo completo — la
        // cotización/contrato guardados arriba sí conservan el periodo
        // completo, que es lo que espera la aceptación para dividirlo.
        const precioPactadoPptx = round2(precioPactadoNum / divisorMes);
        const subtotalConAdicionales = round2(precioPactadoPptx + totalAdicionalesConIva);
        const baseGravable = adicionalesDraft
          .filter((a) => !llevaIva(a.concepto))
          .reduce((s, a) => s + a.costo_unitario * a.cantidad, precioPactadoPptx);
        const ivaMontoConAdicionales = round2(baseGravable * 0.16);
        const totalConAdicionales = round2(subtotalConAdicionales + ivaMontoConAdicionales);
        // Cada adicional se lista en su propio renglón dentro de la tabla
        // del PowerPoint — ambas plantillas ya traían renglones en blanco
        // reservados para esto (Oficina Privada/Working Desk: hasta 3,
        // Coworking: hasta 4; ver lib/cotizacionEspacioPptx.ts). Si hay
        // más adicionales que renglones disponibles, los que sobran no se
        // listan por separado pero sí quedan sumados en el total de arriba.
        const respEspacio = await fetch("/api/cotizar-espacio-pptx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            centro,
            cotizacionComercialId: cotizacion.id,
            tipoEspacio,
            descripcion: nombreEspacio,
            cantidad: esMensual ? 1 : cantidadPeriodo ? Number(cantidadPeriodo) : 1,
            personas: numeroPersonas ? Number(numeroPersonas) : 1,
            horasSalaJuntas: esRenovacion ? Number(horasSalaJuntasManual) || 0 : paquete?.incluye_horas_sala_juntas ?? 0,
            precioUnitario: esMensual ? precioPactadoPptx : tarifaUnitaria ?? precioPactadoNum,
            totalFila: precioPactadoPptx,
            subtotal: subtotalConAdicionales,
            ivaMonto: ivaMontoConAdicionales,
            total: totalConAdicionales,
            nombreCotizacion: `${nombreParaMostradorEspacio} · ${tipoEspacio}`,
            notas: `${nombreEspacio} · ${fechaInicio}${fechaFin ? ` a ${fechaFin}` : ""}${esMensual ? " · Pago mes a mes (cotización de 1 mes)" : ""}${sinDepositoPromo ? ` · ${notaSinDepositoPromo}` : ""}`,
            nombreDestinatario: nombreParaMostradorEspacio,
            adicionales: adicionalesDraft.map((a) => ({
              concepto: a.concepto,
              cantidad: a.cantidad,
              costoUnitario: conIva(a.concepto, a.costo_unitario),
            })),
          }),
        });
        const dataEspacio = await respEspacio.json().catch(() => ({}));
        if (!respEspacio.ok) {
          console.error("[cotizar-espacio-pptx] Error del servidor:", respEspacio.status, dataEspacio);
        } else {
          console.log("[cotizar-espacio-pptx] OK:", dataEspacio);
        }
      } catch (e) {
        console.error("[cotizar-espacio-pptx] Excepción en el navegador:", e);
      }
    } else {
      console.log("[cotizar-espacio-pptx] No coincide con Coworking/Oficina Privada, se omite.");
    }

    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);

    const nombreParaExito = cliente ? etiquetaCliente(cliente) : nombreContesta.trim() || "Prospecto sin nombre";
    setEspacioResultado({
      mensaje: `Cotización registrada para ${nombreParaExito} · ${nombreEspacio}.`,
    });
    // Antes navegaba sola a los 2.2s — ahora se queda visible hasta que el
    // staff le dé clic al botón, para no perderse la pantalla si tardó en
    // leerla.
  }

  if (loading) return <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>;

  // Después de crear una cotización de Sala de Juntas se muestra SOLO esta
  // pantalla de confirmación (reemplaza todo el formulario, no queda
  // pegada hasta abajo del resumen) — igual que la pantalla de "¡Listo!"
  // que ve el cliente al reservar. Para volver a cotizar hay que dar clic
  // en "Cotizar otra Sala de Juntas", que limpia salaResultado y regresa
  // al formulario normal.
  if (esSalaJuntas && salaResultado) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0" }}>
        <div className="invitado-exito-card">
          <div className="invitado-confetti">
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className="invitado-confetti-pieza"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDuration: `${1 + Math.random() * 0.6}s`,
                  animationDelay: `${Math.random() * 0.3}s`,
                  background: ["#f07e3a", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
                }}
              />
            ))}
          </div>
          <div className="invitado-exito-icono">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <p className="invitado-exito-titulo">¡Se agregó con éxito!</p>
          <p className="invitado-exito-mensaje">{salaResultado.mensaje.replace(/^✅\s*/, "")}</p>
          <button className="invitado-exito-btn" onClick={crearOtraCotizacionSala}>
            + Cotizar otra Sala de Juntas
          </button>
          <a
            href="/cotizaciones"
            style={{ position: "relative", zIndex: 2, display: "block", marginTop: 12, fontSize: 12, color: "#6b7897", fontWeight: 600 }}
          >
            Ver en Cotizaciones
          </a>
        </div>
      </div>
    );
  }

  // Misma pantalla de "¡Listo!" para Oficina Privada, Coworking y Working
  // Desk — antes esta parte del flujo navegaba directo a /dashboard sin
  // avisar nada. Se queda visible un momento y luego continúa sola (el
  // enlace de abajo permite saltarse la espera).
  if (!esSalaJuntas && espacioResultado) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0" }}>
        <div className="invitado-exito-card">
          <div className="invitado-confetti">
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className="invitado-confetti-pieza"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDuration: `${1 + Math.random() * 0.6}s`,
                  animationDelay: `${Math.random() * 0.3}s`,
                  background: ["#f07e3a", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
                }}
              />
            ))}
          </div>
          <div className="invitado-exito-icono">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <p className="invitado-exito-titulo">¡Se agregó con éxito!</p>
          <p className="invitado-exito-mensaje">{espacioResultado.mensaje}</p>
          <button className="invitado-exito-btn" onClick={continuarDespuesDeEspacio}>
            Ir al dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Cliente existente — solo si no llegamos ya con uno fijo por URL */}
      {!clientePrecargado && (
        <div>
          <p className="panel-section-label">Cliente existente (opcional)</p>
          <div style={{ position: "relative" }}>
            <input
              placeholder="Buscar cliente por nombre, teléfono o correo... (déjalo vacío si es un prospecto nuevo)"
              value={busquedaClienteExistente}
              onChange={(e) => {
                setBusquedaClienteExistente(e.target.value);
                if (clienteId) setClienteId("");
                setMostrarListaClientesExistentes(true);
              }}
              onFocus={() => setMostrarListaClientesExistentes(true)}
              onBlur={() => setTimeout(() => setMostrarListaClientesExistentes(false), 150)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
            />
            {clienteId && (
              <button
                type="button"
                className="tel-borrar-btn"
                style={{ position: "absolute", right: 8, top: 8, color: "#888" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={limpiarClienteExistente}
                aria-label="Quitar cliente seleccionado"
              >
                ✕
              </button>
            )}
            {mostrarListaClientesExistentes && (
              <div
                style={{
                  position: "absolute",
                  zIndex: 10,
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              >
                {clientesExistentesFiltrados.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#aaa", margin: 0, padding: "10px 12px" }}>Sin resultados.</p>
                ) : (
                  clientesExistentesFiltrados.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => seleccionarClienteExistente(c)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        fontSize: 13,
                        color: "#1a1a1a",
                        background: c.id === clienteId ? "#F0F4FA" : "none",
                        border: "none",
                        borderBottom: "1px solid #f2f2f2",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                      {c.empresa ? ` · ${c.empresa}` : ""}
                      {c.email ? ` · ${c.email}` : ""}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cliente / Prospecto — se oculta en cuanto hay un cliente existente
          real seleccionado (arriba, en "Cliente existente"): buscar un
          prospecto ya no aplica, ese buscador es solo para leads sin
          cuenta. */}
      {(!clienteId || clientePrecargado) && (
      <div>
        <p className="panel-section-label">{clientePrecargado && cliente ? "Cliente (opcional)" : "Prospecto (opcional)"}</p>
        {clientePrecargado && cliente ? (
          <div className="empty-card" style={{ textAlign: "left" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#1a1a1a" }}>
              {cliente.nombre} {cliente.empresa ? `(${cliente.empresa})` : ""}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>{cliente.email}</p>
            <button
              className="tel-borrar-btn"
              style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 6 }}
              onClick={() => setPreseleccionLiberada(true)}
            >
              Cambiar cliente
            </button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <input
              placeholder="Buscar prospecto por nombre, teléfono o correo... (déjalo vacío si no aplica)"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                if (prospectoSeleccionadoId) setProspectoSeleccionadoId("");
                setMostrarListaClientes(true);
              }}
              onFocus={() => setMostrarListaClientes(true)}
              onBlur={() => setTimeout(() => setMostrarListaClientes(false), 150)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
            />
            {prospectoSeleccionadoId && (
              <button
                type="button"
                className="tel-borrar-btn"
                style={{ position: "absolute", right: 8, top: 8, color: "#888" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={limpiarClienteBusqueda}
                aria-label="Quitar prospecto seleccionado"
              >
                ✕
              </button>
            )}
            {mostrarListaClientes && (
              <div
                style={{
                  position: "absolute",
                  zIndex: 10,
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={limpiarClienteBusqueda}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    fontSize: 13,
                    color: "#888",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid #f2f2f2",
                    cursor: "pointer",
                  }}
                >
                  Sin prospecto
                </button>
                {prospectosFiltrados.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#aaa", margin: 0, padding: "10px 12px" }}>Sin resultados.</p>
                ) : (
                  prospectosFiltrados.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => seleccionarClienteBusqueda(p)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        fontSize: 13,
                        background: p.id === prospectoSeleccionadoId ? "#F0F4FA" : "none",
                        border: "none",
                        borderBottom: "1px solid #f2f2f2",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#1a1a1a" }}>{p.nombre}</span>
                      <span style={{ display: "block", fontSize: 11, color: "#888" }}>
                        {p.telefono || ""} {p.email ? `· ${p.email}` : ""} {p.interes ? `· ${p.interes}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Renovación de contrato existente — solo tiene sentido con un
          cliente real ya seleccionado (no un prospecto). */}
      {!!clienteId && (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={esRenovacion}
              onChange={(e) => {
                setEsRenovacion(e.target.checked);
                if (!e.target.checked) {
                  setPorcentajeIncremento("");
                  setContratoARenovarId("");
                }
              }}
            />
            ¿Es renovación de un contrato existente?
          </label>
          {esRenovacion && (
            <div className="tel-form-grid" style={{ marginTop: 8 }}>
              <div>
                <p className="sub-label">Contrato a renovar</p>
                <select
                  value={contratoARenovarId}
                  onChange={(e) => {
                    // Al elegir (o cambiar) el contrato a renovar se vacía
                    // el resto del formulario — cualquier dato suelto que
                    // haya quedado de antes no debe mezclarse con esta
                    // renovación.
                    contratoARenovarAplicadoRef.current = null;
                    // "Renovación" queda como opción por defecto en cuanto
                    // se elige un contrato — el staff puede cambiar de
                    // pestaña si en realidad quiere cambiar/agregar oficina.
                    setModoRenovacion(e.target.value ? "renovar" : "");
                    setOficinaNuevaId("");
                    setOficinaOriginalRenovacion(null);
                    setAdicionalesDraft([]);
                    setIdsAdicionalesAEliminar([]);
                    setAdicionalesExistentesOriginal([]);
                    adicionalesExistentesCargadosRef.current = null;
                    setComentarios("");
                    setComentariosPrecio("");
                    setNumeroPersonas("");
                    setDescuentoPorcentaje("0");
                    setTipoProspecto("");
                    setMedioContacto("");
                    setDetalleMedioContacto("");
                    setObservaciones("");
                    setContratoARenovarId(e.target.value);
                  }}
                >
                  <option value="">Selecciona un contrato</option>
                  {contratosClienteVigentes.map((c) => {
                    const ofi = oficinas.find((o) => o.id === c.oficina_id);
                    return (
                      <option key={c.id} value={c.id}>
                        {ofi ? `${ofi.tipo} ${ofi.numero}` : "Contrato"} · vence{" "}
                        {new Date(c.fecha_vencimiento).toLocaleDateString("es-MX")}
                      </option>
                    );
                  })}
                </select>
                {contratoARenovarId && (
                  <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>Ya se preseleccionó su oficina actual abajo.</p>
                )}
              </div>
              <div>
                <p className="sub-label">% de incremento</p>
                <input
                  type="number"
                  step="0.01"
                  value={porcentajeIncremento}
                  onChange={(e) => setPorcentajeIncremento(e.target.value)}
                />
              </div>
              <div>
                <p className="sub-label">Horas de sala de juntas</p>
                <input
                  type="number"
                  min={0}
                  value={horasSalaJuntasManual}
                  onChange={(e) => setHorasSalaJuntasManual(e.target.value)}
                />
              </div>
            </div>
          )}

          {esRenovacion && contratoARenovarId && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className={"centro-tab" + (modoRenovacion === "renovar" ? " active" : "")}
                  onClick={() => {
                    // Al volver a "Renovación" se restaura la oficina/tipo
                    // original del contrato — "Cambiar tipo de espacio"
                    // reutiliza estos mismos campos para elegir la oficina
                    // nueva y, sin este reset, se quedaban pegados aquí.
                    if (oficinaOriginalRenovacion) {
                      setTipoEspacio(oficinaOriginalRenovacion.tipo);
                      seleccionarOficina(oficinaOriginalRenovacion.id);
                    }
                    setOficinaNuevaId("");
                    setModoRenovacion("renovar");
                  }}
                >
                  Renovación
                </button>
                <button
                  type="button"
                  className={"centro-tab" + (modoRenovacion === "cambiar" ? " active" : "")}
                  onClick={() => setModoRenovacion("cambiar")}
                >
                  Cambiar tipo de espacio
                </button>
                <button
                  type="button"
                  className={"centro-tab" + (modoRenovacion === "agregar" ? " active" : "")}
                  onClick={() => setModoRenovacion("agregar")}
                >
                  Agregar tipo de espacio
                </button>
              </div>

              {modoRenovacion === "renovar" && (
                <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0" }}>
                  Se queda con la misma oficina y los mismos datos del contrato anterior — solo se ajusta lo que
                  cambies arriba (fecha, % de incremento, horas de sala de juntas). El comparativo anterior/nuevo
                  se ve abajo, en el Desglose.
                </p>
              )}
              {modoRenovacion === "cambiar" && (
                <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0" }}>
                  Elige abajo la oficina nueva — se crea un contrato nuevo con esa oficina y el anterior se marca
                  como terminado. El comparativo anterior/nuevo se ve abajo, en el Desglose.
                </p>
              )}
              {modoRenovacion === "agregar" && (
                <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0" }}>
                  Se queda con todos los mismos datos y además suma la oficina que elijas abajo, con su propio
                  costo desglosado. El comparativo anterior/nuevo se ve abajo, en el Desglose.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tipo de espacio */}
      <div>
        <p className="panel-section-label">Tipo de espacio</p>
        <select
          value={tipoEspacio}
          onChange={(e) =>
            modoRenovacion === "agregar"
              ? seleccionarTipoEspacioParaAgregar(e.target.value)
              : seleccionarTipoEspacio(e.target.value)
          }
          disabled={esRenovacion && contratoARenovarId !== "" && modoRenovacion === "renovar"}
          style={estiloSelect}
        >
          <option value="">Selecciona un tipo</option>
          {tiposEspacioDisponibles.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={SALA_JUNTAS_TIPO}>{SALA_JUNTAS_TIPO}</option>
        </select>
      </div>

      {/* Sala de Juntas — tarifas fijas por tramo (no oficina/paquete). Solo
          genera la cotización; la reservación real la crea el admin
          manualmente después si el cliente autoriza. */}
      {esSalaJuntas && (
        <div>
          <p className="panel-section-label">Tamaño de sala</p>
          {preciosSala.length === 0 ? (
            <div className="empty-card">
              Sin precios de Sala de Juntas configurados en {centro}. Agrégalos desde el módulo &quot;Precios Sala de
              Juntas&quot;.
            </div>
          ) : (
            <>
              <select
                value={salaTamanoId}
                onChange={(e) => setSalaTamanoId(e.target.value)}
                style={estiloSelect}
              >
                <option value="">Selecciona un tamaño</option>
                {preciosSala.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.tamano}
                  </option>
                ))}
              </select>

              {salaSeleccionada && (
                <CapacidadSalaIcono cantidad={extraerCapacidadSala(salaSeleccionada.tamano)} />
              )}

              {salaSeleccionada && (
                <p style={{ fontSize: 11, color: "#aaa", margin: "6px 0 0" }}>
                  1 hora: {salaSeleccionada.precio_hora ? `$${salaSeleccionada.precio_hora.toLocaleString("es-MX")}` : "N/A"} · 4-6
                  horas: {salaSeleccionada.precio_medio_dia ? `$${salaSeleccionada.precio_medio_dia.toLocaleString("es-MX")}` : "N/A"} ·
                  1 día (10h): {salaSeleccionada.precio_dia ? `$${salaSeleccionada.precio_dia.toLocaleString("es-MX")}` : "N/A"}
                </p>
              )}

              {/* Calendario de disponibilidad — misma vista y misma forma de
                  seleccionar horas (click y arrastre libre) que usa el
                  cliente al reservar, en vez de un campo de fecha genérico. */}
              {salaSeleccionada && (
                <div style={{ marginTop: 10 }}>
                  <p className="sub-label">Elige la fecha y hora en el calendario</p>
                  <div className="cal-semana-nav">
                    <button type="button" onClick={() => setInicioSemanaSala(new Date(inicioSemanaSala.getTime() - 7 * 86400000))}>
                      ‹
                    </button>
                    <span className="cal-semana-label">
                      {diasSemanaSala[0].toLocaleDateString("es-MX", { day: "numeric", month: "short" })} –{" "}
                      {diasSemanaSala[6].toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </span>
                    <button type="button" onClick={() => setInicioSemanaSala(new Date(inicioSemanaSala.getTime() + 7 * 86400000))}>
                      ›
                    </button>
                  </div>

                  <div className="cal-grid-wrap">
                    <div className="cal-grid">
                      <div className="cal-head-cell"></div>
                      {diasSemanaSala.map((d) => (
                        <div className="cal-head-cell" key={d.toISOString()}>
                          {DIAS_CORTOS[d.getDay()]}
                          <span className="num">{d.getDate()}</span>
                        </div>
                      ))}

                      {HORAS.map((h) => (
                        <Fragment key={`sala-row-${h}`}>
                          <div className="cal-hour-cell" key={`sala-h-${h}`}>
                            {h}:00
                          </div>
                          {diasSemanaSala.map((d) => {
                            const fechaISO = formatFechaISO(d);
                            const ocupado = estaOcupadoSala(fechaISO, h);
                            const pasado = !ocupado && esPasadoSala(fechaISO, h);
                            const fueraHorario = !ocupado && !pasado && esFueraDeHorario(fechaISO, h);
                            const sel =
                              seleccionSala &&
                              seleccionSala.fecha === fechaISO &&
                              h >= seleccionSala.horaInicio &&
                              h < seleccionSala.horaFin;
                            return (
                              <div
                                key={`sala-${fechaISO}-${h}`}
                                className={
                                  "cal-slot" +
                                  (sel ? " seleccionado" : ocupado ? " ocupado" : pasado ? " pasado" : fueraHorario ? " fuera-horario" : "")
                                }
                                title={
                                  ocupado
                                    ? "Ocupado"
                                    : pasado
                                    ? "Ya pasó"
                                    : fueraHorario
                                    ? "Fuera de horario normal"
                                    : formatHora(h)
                                }
                                onClick={() => clickSlotSala(fechaISO, h)}
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
                    <span className="cal-leyenda-item">
                      <span className="cal-leyenda-dot" style={{ background: "#ffc766" }} /> Fuera de horario
                    </span>
                    <span className="cal-leyenda-item">
                      <span className="cal-leyenda-dot" style={{ background: "#f07e3a" }} /> Tu selección
                    </span>
                    <span className="cal-leyenda-item">
                      <span className="cal-leyenda-dot" style={{ background: "#d8d8d8" }} /> Ya pasó
                    </span>
                  </div>

                  {seleccionSala ? (
                    <p style={{ fontSize: 12, color: "#0F6E56", margin: "6px 0 0", fontWeight: 600 }}>
                      ✓ {seleccionSala.fecha} · {formatHora(seleccionSala.horaInicio)} - {formatHora(seleccionSala.horaFin)} (
                      {duracionSalaSeleccion} hora{duracionSalaSeleccion === 1 ? "" : "s"})
                      {salaPrecio != null ? ` · $${salaPrecio.toLocaleString("es-MX")}` : ""}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>Haz click en el calendario para elegir.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* En Renovación/Agregar la oficina principal no cambia — se muestra
          nada más como referencia, sin la cuadrícula completa de oficinas
          (esa cuadrícula es para elegir, y aquí ya está elegida). */}
      {esRenovacion && contratoARenovarId && (modoRenovacion === "renovar" || modoRenovacion === "agregar") && oficina && (
        <div>
          <p className="panel-section-label">Oficina</p>
          <div className="empty-card" style={{ textAlign: "left" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "#1a1a1a" }}>
              {oficina.tipo} {oficina.numero}
            </p>
          </div>
        </div>
      )}

      {/* Oficina — tarjetas clicables con ocupación en vivo (cruce contra
          contratos vigentes, no solo oficinas.estado). Prioridad de bloqueo:
          ocupada (por contrato vigente) > mantenimiento > disponible.
          En modo "agregar" esta misma cuadrícula elige la oficina EXTRA a
          sumar (oficinaNuevaId), no la principal — por eso se excluye la
          oficina que ya tiene el contrato, no tendría sentido sumarla a
          sí misma. En "renovar" no se muestra (ver arriba, ya se ve como
          referencia sin poder cambiarla). */}
      {tipoEspacio &&
        oficinasDelTipo.length > 0 &&
        !(esRenovacion && contratoARenovarId && modoRenovacion === "renovar") && (
        <div>
          <p className="panel-section-label">{esCoworkingSel ? "Espacio" : "Oficina"}</p>
          {(() => {
            const idSel = modoRenovacion === "agregar" ? oficinaNuevaId : oficinaId;
            const visibles = oficinasDelTipo.filter((o) => !(modoRenovacion === "agregar" && o.id === oficina?.id));
            const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 } as const;

            const tarjeta = (o: Oficina) => {
              const ocupacion = ocupacionPorOficina[o.id];
              const bloqueada = !!ocupacion || o.estado === "mantenimiento";
              const seleccionada = idSel === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="contrato-card-admin"
                  disabled={bloqueada}
                  onClick={() => (modoRenovacion === "agregar" ? setOficinaNuevaId(o.id) : seleccionarOficina(o.id))}
                  style={{
                    textAlign: "left",
                    cursor: bloqueada ? "not-allowed" : "pointer",
                    opacity: bloqueada ? 0.6 : 1,
                    border: seleccionada ? "2px solid #0d1b3e" : undefined,
                  }}
                >
                  <p className="contrato-cliente-nombre" style={{ margin: 0 }}>
                    {esCoworkingSel ? "Espacio" : "Oficina"} {o.numero}
                  </p>
                  {ocupacion ? (
                    <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>
                      Ocupada por {ocupacion.clienteNombre} · vigente hasta {ocupacion.fechaVencimiento}
                    </p>
                  ) : o.estado === "mantenimiento" ? (
                    <p style={{ fontSize: 12, color: "#a3701f", margin: "4px 0 0" }}>En mantenimiento</p>
                  ) : (
                    <p style={{ fontSize: 12, color: "#0F6E56", margin: "4px 0 0" }}>Disponible</p>
                  )}
                  {!bloqueada && (
                    <span style={{ fontSize: 11, color: "#0d1b3e", fontWeight: 600 }}>
                      {seleccionada ? "✓ Elegida" : "Elegir"}
                    </span>
                  )}
                </button>
              );
            };

            if (!esCoworkingSel) return <div style={gridStyle}>{visibles.map((o) => tarjeta(o))}</div>;

            // Coworking: primero las letras; la que agrupa varios espacios
            // (la "A": A, AA, AB… AZ) despliega su tabla al elegirla.
            const idsVisibles = new Set(visibles.map((o) => o.id));
            const grupos = gruposEspacios
              .map(([letra, lista]) => [letra, lista.filter((o) => idsVisibles.has(o.id))] as [string, Oficina[]])
              .filter(([, lista]) => lista.length > 0);
            const letraSel = visibles.find((o) => o.id === idSel)?.numero.trim().charAt(0).toUpperCase() || null;
            const abierto = grupoEspacioAbierto ?? letraSel;

            return (
              <>
                <div style={gridStyle}>
                  {grupos.map(([letra, lista]) => {
                    if (lista.length === 1) return tarjeta(lista[0]);
                    const libres = lista.filter((o) => !ocupacionPorOficina[o.id] && o.estado !== "mantenimiento").length;
                    const activo = abierto === letra;
                    return (
                      <div
                        key={`grupo-${letra}`}
                        className="contrato-card-admin"
                        style={{ textAlign: "left", border: activo ? "2px solid #0d1b3e" : undefined }}
                      >
                        <button
                          type="button"
                          onClick={() => setGrupoEspacioAbierto(activo ? "" : letra)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            width: "100%",
                            textAlign: "left",
                            cursor: "pointer",
                            font: "inherit",
                            color: "inherit",
                          }}
                        >
                          <p className="contrato-cliente-nombre" style={{ margin: 0 }}>
                            Espacio {letra}
                          </p>
                          <p style={{ fontSize: 12, color: libres > 0 ? "#0F6E56" : "#A32D2D", margin: "4px 0 0" }}>
                            {libres} de {lista.length} disponibles
                          </p>
                          <span style={{ fontSize: 11, color: "#0d1b3e", fontWeight: 600 }}>
                            {activo ? "▲ Ocultar" : "▼ Ver espacios"}
                          </span>
                        </button>
                        {activo && (
                          <div className="lista-espacios">
                            {lista.map((o) => {
                              const ocupacion = ocupacionPorOficina[o.id];
                              const bloqueada = !!ocupacion || o.estado === "mantenimiento";
                              return (
                                <button
                                  key={o.id}
                                  type="button"
                                  disabled={bloqueada}
                                  className={"lista-espacios-item" + (idSel === o.id ? " activo" : "")}
                                  onClick={() => (modoRenovacion === "agregar" ? setOficinaNuevaId(o.id) : seleccionarOficina(o.id))}
                                >
                                  {idSel === o.id ? "✓ " : ""}Espacio {o.numero}
                                  {ocupacion
                                    ? ` · Ocupado por ${ocupacion.clienteNombre} (hasta ${ocupacion.fechaVencimiento})`
                                    : o.estado === "mantenimiento"
                                    ? " · En mantenimiento"
                                    : ""}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Paquete */}
      {tipoEspacio && paquetesDelTipo.length > 0 && (
        <div>
          <p className="panel-section-label">Paquete</p>
          {/* Campo cerrado que al tocarlo despliega la lista (mismo diseño que
              la de espacios de Coworking, sin renglón "Selecciona un
              paquete"). Al elegir uno se cierra; tocar el elegido otra vez
              lo quita (antes eso se hacía volviendo al renglón vacío). */}
          <button
            type="button"
            className={"lista-espacios-disparador" + (paqueteListaAbierta ? " abierto" : "")}
            disabled={paqueteBloqueado}
            onClick={() => setPaqueteListaAbierta((v) => !v)}
          >
            <span>{paquete ? `✓ ${paquete.nombre}` : "Ver paquetes"}</span>
            {!paqueteBloqueado && <span style={{ fontSize: 11 }}>{paqueteListaAbierta ? "▲" : "▼"}</span>}
          </button>
          {paqueteListaAbierta && !paqueteBloqueado && (
            <div className="lista-espacios">
              {paquetesDelTipo.map((p) => {
                const yaRegistrado = paquetesYaRegistrados.has(p.id);
                const elegido = paqueteId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={yaRegistrado}
                    className={"lista-espacios-item" + (elegido ? " activo" : "")}
                    onClick={() => {
                      seleccionarPaquete(elegido ? "" : p.id);
                      setPaqueteListaAbierta(false);
                    }}
                  >
                    {elegido ? "✓ " : ""}
                    {p.nombre} {p.descripcion ? `· ${p.descripcion}` : ""} {yaRegistrado ? "· Ya registrado" : ""}
                  </button>
                );
              })}
            </div>
          )}
          {paqueteBloqueado && (
            <p style={{ fontSize: 11, color: "#a3701f", margin: "4px 0 0" }}>
              🔒 Este paquete se asignó automáticamente por la oficina elegida y no se puede cambiar.
            </p>
          )}
          {avisoPaqueteVinculado && (
            <p style={{ fontSize: 11, color: "#a3701f", margin: "4px 0 0" }}>{avisoPaqueteVinculado}</p>
          )}
          {cliente && paquetesDelTipo.some((p) => paquetesYaRegistrados.has(p.id)) && (
            <p style={{ fontSize: 11, color: "#a3701f", margin: "4px 0 0" }}>
              Los paquetes marcados como &quot;Ya registrado&quot; ya están asignados a este cliente en un contrato.
            </p>
          )}

          {paquete && (
            <>
              <p className="sub-label" style={{ marginTop: 8 }}>
                Modalidad
              </p>
              <select
                value={modalidadPaquete}
                onChange={(e) => seleccionarModalidadPaquete(e.target.value as Modalidad)}
                style={{ width: "100%" }}
              >
                <option value="">Selecciona una modalidad</option>
                {MODALIDADES.map((m) => {
                  const tarifa = tarifaPaquete(paquete, m);
                  return (
                    <option key={m} value={m} disabled={tarifa == null}>
                      {m} {tarifa != null ? `· $${tarifa.toLocaleString("es-MX")}` : "· No disponible"}
                    </option>
                  );
                })}
              </select>
              {!MODALIDADES.some((m) => tarifaPaquete(paquete, m) != null) && (
                <p style={{ fontSize: 12, color: "#A32D2D", margin: "6px 0 0" }}>
                  Este paquete no tiene tarifas configuradas. Agrégalas desde el módulo Paquetes.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tipoEspacio && !esSalaJuntas && oficinasDelTipo.length === 0 && paquetesDelTipo.length === 0 && (
        <div className="empty-card">
          Sin oficinas ni paquetes de tipo &quot;{tipoEspacio}&quot; registrados en {centro}.
        </div>
      )}

      {/* Datos comerciales */}
      {espacioListo && (
        <div>
          <p className="panel-section-label">Datos comerciales</p>
          <div className="tel-form-grid">
            <div>
              <p className="sub-label">Tipo de prospecto</p>
              <select value={tipoProspecto} onChange={(e) => setTipoProspecto(e.target.value)}>
                <option value="">Sin definir</option>
                {TIPOS_PROSPECTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="sub-label">Persona física o moral</p>
              <select
                value={tipoPersona}
                onChange={(e) => setTipoPersona(e.target.value as "fisica" | "moral" | "")}
              >
                <option value="" hidden>
                  Selecciona
                </option>
                <option value="fisica">Persona física</option>
                <option value="moral">Persona moral</option>
              </select>
            </div>
            {tipoPersona === "moral" && (
              <div>
                <p className="sub-label">Razón social de la empresa</p>
                <input
                  placeholder="Ej. NBC COMPANY, S.A.P.I. DE C.V."
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                />
              </div>
            )}
            <div>
              <p className="sub-label">Medio de contacto</p>
              <select
                value={medioContacto}
                onChange={(e) => {
                  setMedioContacto(e.target.value);
                  setDetalleMedioContacto("");
                }}
              >
                <option value="">Sin definir</option>
                {MEDIOS_CONTACTO.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {medioContacto && medioContacto !== "Teléfono" && (
              <div>
                <p className="sub-label">{labelDetalleMedioContacto[medioContacto] || "Detalle"}</p>
                <input
                  value={detalleMedioContacto}
                  onChange={(e) => setDetalleMedioContacto(e.target.value)}
                  placeholder={labelDetalleMedioContacto[medioContacto] || ""}
                />
              </div>
            )}
            {/* En Sala de Juntas la capacidad ya se elige arriba con el tamaño de sala. */}
            {!esSalaJuntas && (
              <div>
                <p className="sub-label">Número de personas</p>
                <input type="number" min={0} value={numeroPersonas} onChange={(e) => setNumeroPersonas(e.target.value)} />
              </div>
            )}
            <input
              placeholder={tipoPersona === "moral" ? "Nombre del representante legal" : "Nombre de quién solicita la cotización"}
              value={nombreContesta}
              onChange={(e) => setNombreContesta(e.target.value)}
            />
            <input
              placeholder={medioContacto === "Teléfono" ? "Número de teléfono" : "Teléfono"}
              value={telefonoContesta}
              onChange={(e) => setTelefonoContesta(e.target.value)}
            />
            <input
              type="email"
              placeholder="Correo"
              value={correoContesta}
              onChange={(e) => setCorreoContesta(e.target.value)}
            />
          </div>
          <textarea
            placeholder="Observaciones"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8, minHeight: 60 }}
          />
        </div>
      )}

      {/* Coffee Break — agregado opcional, SOLO para Sala de Juntas (no
          para Oficina/Paquete). Mismos paquetes y misma cuenta que se le
          ofrecen al cliente al reservar. No afecta el precio del espacio
          (precio de lista/pactado/neto) — se guarda y se muestra aparte. */}
      {espacioListo && esSalaJuntas && (
        <div>
          <Checkbox
            checked={quiereCoffee}
            onChange={(marcado) => {
              setQuiereCoffee(marcado);
              if (!marcado) {
                setPaqueteCoffeeId("");
                setPersonasCoffee("");
              }
            }}
            style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}
          >
            ☕ ¿El cliente también quiere Coffee Break?
          </Checkbox>

          {quiereCoffee && (
            <>
              {coffeeBreakPaquetes.length === 0 ? (
                <p style={{ fontSize: 13, color: "#999", marginTop: 8 }}>
                  No hay paquetes de coffee break disponibles en este momento.
                </p>
              ) : (
                <>
                  <p className="sub-label" style={{ marginTop: 8 }}>
                    Elige un paquete
                  </p>
                  <div className="paquete-coffee-lista">
                    {coffeeBreakPaquetes.map((p) => {
                      const seleccionado = paqueteCoffeeId === p.id;
                      const precioConDescuento = p.promocion_activa
                        ? p.precio_persona * (1 - p.descuento_porcentaje / 100)
                        : p.precio_persona;
                      return (
                        <button
                          type="button"
                          key={p.id}
                          className={"paquete-coffee-card" + (seleccionado ? " seleccionado" : "")}
                          onClick={() => setPaqueteCoffeeId(p.id)}
                        >
                          <div className="paquete-coffee-top">
                            <p className="paquete-coffee-nombre">
                              Paquete #{p.numero} · {p.nombre}
                            </p>
                            <span className="paquete-coffee-check" aria-hidden="true">
                              {seleccionado ? "✓" : ""}
                            </span>
                          </div>
                          <p className="paquete-coffee-precio">
                            {p.promocion_activa && (
                              <span className="paquete-coffee-precio-tachado">
                                ${Number(p.precio_persona).toLocaleString("es-MX")}
                              </span>
                            )}
                            <b>${precioConDescuento.toLocaleString("es-MX", { maximumFractionDigits: 0 })}/persona</b>
                            {" · mínimo " + p.minimo_personas + (p.minimo_personas === 1 ? " persona" : " personas")}
                          </p>
                          {p.promocion_activa && (
                            <p className="paquete-coffee-promo">
                              🏷️ {p.promocion_texto ? `${p.promocion_texto}: ` : ""}
                              {p.descuento_porcentaje}% de descuento
                            </p>
                          )}
                          <p className="paquete-coffee-detalle">🍽️ {p.alimentos}</p>
                          <p className="paquete-coffee-detalle">☕ {p.bebidas}</p>
                        </button>
                      );
                    })}
                  </div>
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
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 10,
                          padding: "10px 12px",
                          fontSize: 13,
                          color: "#1a1a1a",
                          background: "#fafafa",
                          fontFamily: "inherit",
                          width: 140,
                        }}
                      />
                      {coffeeBreakFaltaMinimo && (
                        <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>
                          Ese paquete requiere un mínimo de {paqueteCoffee.minimo_personas} persona(s)
                        </p>
                      )}
                      {personasCoffeeNum > 0 && !coffeeBreakFaltaMinimo && (
                        <p style={{ fontSize: 12, color: "#0F6E56", margin: "6px 0 0", fontWeight: 600 }}>
                          Total Coffee Break: ${totalCoffeeBreak.toLocaleString("es-MX")}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Fechas — para Sala de Juntas la fecha/hora ya se elige arriba en
          el calendario, así que esta sección se omite para no duplicar. */}
      {espacioListo && tipoCotizacionVenta && !esSalaJuntas && (
        <div>
          <p className="panel-section-label">
            {esHora
              ? "Horario de la reservación"
              : esDia
              ? "Fechas de estancia (por día)"
              : "Fechas de estancia"}
          </p>
          <div className="tel-form-grid">
            <div>
              <p className="sub-label">{esHora || esSalaJuntas ? "Fecha" : "Fecha inicial"}</p>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => {
                  setFechaInicio(e.target.value);
                  if (esSalaJuntas) setFechaFin(e.target.value);
                }}
              />
            </div>

            {esSalaJuntas ? null : esHora ? (
              <>
                <div>
                  <p className="sub-label">Hora de inicio</p>
                  <select value={horaInicio} onChange={(e) => setHoraInicio(Number(e.target.value))}>
                    {HORAS.map((h) => (
                      <option key={h} value={h}>
                        {formatHora(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="sub-label">Cantidad de horas</p>
                  <input type="number" min={1} value={cantidadPeriodo} onChange={(e) => setCantidadPeriodo(e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="sub-label">
                    {modalidadEfectiva ? `Cantidad de ${LABEL_MODALIDAD_PLURAL[modalidadEfectiva]}` : "Duración (meses)"}
                  </p>
                  <input type="number" min={0} value={cantidadPeriodo} onChange={(e) => setCantidadPeriodo(e.target.value)} />
                </div>
                <div>
                  <p className="sub-label">Fecha final</p>
                  <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                </div>
              </>
            )}

          </div>

          {esHora && horaFinCalculada != null && (
            <p style={{ fontSize: 12, color: "#555", margin: "6px 0 0" }}>Termina a las {formatHora(horaFinCalculada)}</p>
          )}
        </div>
      )}

      {/* Precio — se oculta para Sala de Juntas por ahora (se agregará en
          otro apartado más adelante); el precio ya se calculó automático
          arriba a partir de las horas elegidas en el calendario y se sigue
          usando tal cual para la cotización, solo no se muestra ni se deja
          editar aquí.
          También se oculta en Renovación/Agregar tipo de espacio: ninguno
          de estos campos (precio de lista, descuento, precio pactado,
          depósito, moneda, comentarios, cargo recurrente) se guarda ahí —
          ejecutarRenovacionEnLinea/ejecutarAgregarEspacio solo tocan fecha
          de vencimiento, renta (con el % de incremento) y adicionales.
          Se probó mostrarlo igual con etiqueta de "solo referencia" y
          seguía confundiendo (números de dos orígenes distintos en la
          misma pantalla), así que se queda oculto para estos dos modos. */}
      {espacioListo && tipoCotizacionVenta && !esSalaJuntas && !esRenovarOAgregarActiva && (
        <div>
          <p className="panel-section-label">Precio</p>
          <div className="tel-form-grid">
            {permiteMensual && (
              <div>
                <p className="sub-label">Forma de pago</p>
                <select value={formaPago} onChange={(e) => setFormaPago(e.target.value as FormaPago)}>
                  <option value="adelantado">Por adelantado (todo el periodo)</option>
                  <option value="mensual">Mes a mes</option>
                </select>
                {esMensual && (
                  <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
                    Paga del 1 al 10 de cada mes; si no paga a tiempo, la siguiente factura lleva un recargo del 3%.
                  </p>
                )}
              </div>
            )}
            <div>
              <p className="sub-label">Moneda</p>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as "MXN" | "USD")}>
                <option value="MXN">Peso mexicano (MXN)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
              </select>
            </div>
            {moneda === "USD" && (
              <div>
                <p className="sub-label">Tipo de cambio (MXN por USD)</p>
                <input
                  type="number"
                  step="0.0001"
                  placeholder="Ej. 18.50"
                  value={tipoCambio}
                  onChange={(e) => setTipoCambio(e.target.value)}
                />
              </div>
            )}
            <div>
              <p className="sub-label">
                Precio de lista {tarifaUnitaria != null ? `(tarifa × cantidad${paquete ? " · automático" : ""})` : ""}
              </p>
              <input
                type="number"
                step="0.01"
                value={precioLista}
                disabled={!!paquete}
                onChange={(e) => setPrecioLista(e.target.value)}
                style={paquete ? { background: "#f2f2f2", color: "#555" } : undefined}
              />
            </div>
            <div>
              <p className="sub-label">Descuento (%)</p>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={descuentoPorcentaje}
                onChange={(e) => setDescuentoPorcentaje(e.target.value)}
              />
            </div>
            <div>
              <p className="sub-label">Precio pactado (unitario, sin IVA)</p>
              <input type="number" step="0.01" value={precioPactado} onChange={(e) => setPrecioPactado(e.target.value)} />
            </div>
            <div>
              <p className="sub-label">Depósito en garantía</p>
              <input
                type="number"
                step="0.01"
                // El campo muestra y captura el monto ya con IVA incluido
                // (lo que realmente se le cobra al cliente) para no
                // confundir al staff con dos números distintos. Por dentro
                // se sigue guardando sin IVA en depositoGarantia — igual
                // que antes — dividiendo entre 1.16 lo que se escriba aquí.
                value={depositoGarantia === "" ? "" : depositoConIvaNum}
                disabled={sinDepositoPromo}
                onChange={(e) => {
                  const conIva = Number(e.target.value) || 0;
                  setDepositoGarantia(e.target.value === "" ? "" : String(round2(conIva / 1.16)));
                }}
              />
              <Checkbox
                checked={sinDepositoPromo}
                onChange={setSinDepositoPromo}
                style={{ fontSize: 12, color: "#555", marginTop: 6 }}
              >
                No se cobra depósito en garantía por promoción
              </Checkbox>
            </div>
          </div>
          <textarea
            placeholder="Comentarios de precio"
            value={comentariosPrecio}
            onChange={(e) => setComentariosPrecio(e.target.value)}
            style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8, minHeight: 50 }}
          />
          <Checkbox
            checked={cargoRecurrente}
            onChange={setCargoRecurrente}
            style={{ fontSize: 13, color: "#555", marginTop: 8 }}
          >
            Cargo recurrente
          </Checkbox>
          <textarea
            placeholder="Comentarios de la cotización"
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
            style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%", marginTop: 8, minHeight: 50 }}
          />
        </div>
      )}

      {/* Adicionales — no aplica a Sala de Juntas (tipoCotizacionVenta se
          fija internamente en "Contrato" para todo lo demás, ver el efecto
          más arriba, ya que el selector visible se quitó). */}
      {espacioListo && tipoCotizacionVenta === "Contrato" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="panel-section-label" style={{ margin: 0 }}>
              Adicionales {totalAdicionalesConIva > 0 && `· $${totalAdicionalesConIva.toLocaleString("es-MX")}`}
            </p>
            <button
              className="tel-borrar-btn"
              style={{ color: "#0d1b3e", fontWeight: 600 }}
              onClick={() => setMostrarPickerAdicional((v) => !v)}
            >
              {mostrarPickerAdicional ? "Cerrar" : "+ Agregar adicional"}
            </button>
          </div>

          {mostrarPickerAdicional && (
            <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginTop: 8 }}>
              <input
                placeholder="Buscar adicional (ej. Persona extra, Estacionamiento...)"
                value={busquedaAdicional}
                onChange={(e) => setBusquedaAdicional(e.target.value)}
                style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13 }}
              />

              <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
                {catalogoFiltrado.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#aaa", margin: "4px 0" }}>Sin resultados en el catálogo de {centro}.</p>
                ) : (
                  catalogoFiltrado.map((item) => {
                    const yaAgregado = idsCatalogoYaAgregados.has(item.id);
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 0",
                          borderBottom: "1px solid #f2f2f2",
                          opacity: yaAgregado ? 0.5 : 1,
                        }}
                      >
                        <div>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{item.nombre}</p>
                          {item.descripcion && <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{item.descripcion}</p>}
                          <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
                            $
                            {(llevaIva(item.nombre)
                              ? round2(Number(item.costo_unitario) * 1.16)
                              : Number(item.costo_unitario)
                            ).toLocaleString("es-MX")}{" "}
                            c/u
                          </p>
                        </div>
                        <button
                          className="tel-borrar-btn"
                          style={{ color: "#0d1b3e", fontWeight: 600 }}
                          disabled={yaAgregado}
                          onClick={() => agregarAdicionalDelCatalogo(item)}
                        >
                          {yaAgregado ? "✓ Agregado" : "+ Agregar"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {nuevoTipoAbierto ? (
                <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
                  <p className="sub-label">Nuevo tipo de adicional</p>
                  <input
                    placeholder="Nombre (ej. Estacionamiento)"
                    value={nuevoTipoNombre}
                    onChange={(e) => setNuevoTipoNombre(e.target.value)}
                    style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                  />
                  <input
                    placeholder="Descripción (opcional)"
                    value={nuevoTipoDescripcion}
                    onChange={(e) => setNuevoTipoDescripcion(e.target.value)}
                    style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Costo unitario"
                    value={nuevoTipoCosto}
                    onChange={(e) => setNuevoTipoCosto(e.target.value)}
                    style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", width: "100%", fontSize: 13, marginBottom: 6 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className={"btn-enviar" + (procesandoAdicional ? " sending" : "")}
                      style={{ padding: "8px 16px" }}
                      onClick={crearTipoAdicionalYAgregar}
                      disabled={procesandoAdicional}
                    >
                      <span className="btn-enviar-icon-wrapper">
                        <svg
                          className="btn-enviar-icon"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path fill="none" d="M0 0h24v24H0z"></path>
                          <path
                            fill="currentColor"
                            d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                          ></path>
                        </svg>
                      </span>
                      <span className="btn-enviar-text">Crear y agregar</span>
                    </button>
                    <button className="tel-borrar-btn" style={{ color: "#888" }} onClick={() => setNuevoTipoAbierto(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 8 }}
                  onClick={() => setNuevoTipoAbierto(true)}
                >
                  + Crear nuevo tipo de adicional
                </button>
              )}

              {errorAdicional && <p style={{ color: "#A32D2D", fontSize: 12, marginTop: 6 }}>{errorAdicional}</p>}
            </div>
          )}

          {adicionalesDraft.length === 0 ? (
            <p style={{ fontSize: 12, color: "#aaa", margin: "6px 0 0" }}>Sin adicionales agregados.</p>
          ) : (
            adicionalesDraft.map((a) => (
              <div
                key={a.clave}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: "1px solid #f2f2f2",
                }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                    {a.concepto}
                    {a.id && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          color: "#888",
                          border: "1px solid #eee",
                          borderRadius: 6,
                          padding: "1px 5px",
                        }}
                      >
                        ya en el contrato
                      </span>
                    )}
                  </p>
                  {a.descripcion && <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{a.descripcion}</p>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#888" }}>$</span>
                  <input
                    type="number"
                    step="0.01"
                    // Estacionamiento es el único adicional que lleva IVA
                    // (ver totalAdicionalesConIva) — el campo muestra y
                    // captura el monto ya con IVA para que coincida con lo
                    // que se le cobra al cliente; por dentro se sigue
                    // guardando sin IVA en costo_unitario, igual que antes.
                    value={
                      llevaIva(a.concepto) ? round2(a.costo_unitario * 1.16) : a.costo_unitario
                    }
                    onChange={(e) => {
                      const esEstacionamiento = llevaIva(a.concepto);
                      const valor = esEstacionamiento
                        ? String(round2((Number(e.target.value) || 0) / 1.16))
                        : e.target.value;
                      actualizarAdicionalDraft(a.clave, "costo_unitario", valor);
                    }}
                    style={{ width: 70, border: "1px solid #eee", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                  />
                  <span style={{ fontSize: 11, color: "#888" }}>×</span>
                  <input
                    type="number"
                    min={1}
                    value={a.cantidad}
                    onChange={(e) => actualizarAdicionalDraft(a.clave, "cantidad", e.target.value)}
                    style={{ width: 50, border: "1px solid #eee", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                  />
                </div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0d1b3e", minWidth: 70, textAlign: "right" }}>
                  $
                  {(llevaIva(a.concepto)
                    ? round2(a.costo_unitario * 1.16 * a.cantidad)
                    : a.costo_unitario * a.cantidad
                  ).toLocaleString("es-MX")}
                </p>
                <button className="tel-borrar-btn" onClick={() => eliminarAdicionalDraft(a.clave)}>
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Desglose */}
      {espacioListo && tipoCotizacionVenta && (
        <div className="resumen-reserva-card">
          <p className="resumen-reserva-title">Desglose</p>

          {/* Las 3 pestañas de renovación comparten el layout de dos
              columnas ("Desglose anterior" con la oficina/renta que ya
              tenía). El contenido de "Desglose nuevo" SÍ cambia por modo:
              en Renovación/Agregar solo se muestra lo que de verdad se
              guarda (renta + incremento + oficina agregada + adicionales,
              ver esRenovarOAgregarActiva más abajo) — se probó mostrar
              también el desglose de precio de lista/IVA/depósito ahí como
              referencia y solo confundía (dos números de origen distinto
              en la misma pantalla). En "Cambiar tipo de espacio" ese
              desglose completo sí es el real (crea un contrato nuevo). */}
          <div
            style={
              esRenovacionActiva
                ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }
                : undefined
            }
          >
            {esRenovacionActiva && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.6)",
                      margin: 0,
                      textTransform: "uppercase",
                    }}
                  >
                    Desglose anterior
                  </p>
                  <div className="resumen-reserva-row">
                    <span className="resumen-reserva-label">{contratoOriginalOficinaLabel}</span>
                    <span className="resumen-reserva-val">
                      {rentaOriginalRenovacion != null ? `$${Number(rentaOriginalRenovacion).toLocaleString("es-MX")}` : "—"}
                    </span>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {esRenovacionActiva && (
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.6)",
                      margin: 0,
                      textTransform: "uppercase",
                    }}
                  >
                    Desglose nuevo
                  </p>
                )}
                {esRenovarOAgregarActiva && (
                  // Esto de aquí SÍ es lo que de verdad se guarda/cobra en
                  // Renovación/Agregar (renta_mensual + incremento +
                  // oficina agregada + adicionales) — se muestra primero y
                  // resaltado, antes del desglose de precio de
                  // lista/IVA/depósito de abajo, que es solo de referencia.
                  <>
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">
                        Renta mensual{incrementoRenovacionNum > 0 && ` (+${incrementoRenovacionNum}%)`}
                      </span>
                      <span className="resumen-reserva-val">
                        {rentaConIncrementoPreview != null
                          ? `$${Number(rentaConIncrementoPreview).toLocaleString("es-MX")}`
                          : "—"}
                      </span>
                    </div>
                    {modoRenovacion === "agregar" && oficinaNueva && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label">
                          + Oficina agregada: {oficinaNueva.tipo} {oficinaNueva.numero}
                        </span>
                        <span className="resumen-reserva-val">${costoMensualOficinaNueva.toLocaleString("es-MX")}</span>
                      </div>
                    )}
                    {totalAdicionalesConIva > 0 && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label">Adicionales</span>
                        <span className="resumen-reserva-val">${totalAdicionalesConIva.toLocaleString("es-MX")}</span>
                      </div>
                    )}
                    <div
                      className="resumen-reserva-row"
                      style={{ fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 8, marginTop: 4 }}
                    >
                      <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                        Total mensual nuevo
                      </span>
                      <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                        ${totalMensualNuevoSimplificado.toLocaleString("es-MX")}/mes
                      </span>
                    </div>
                  </>
                )}
                {!esRenovarOAgregarActiva && (
                  <>
                    {/* Mes a mes: todo el desglose es de UN solo mes (el que se
                        cobra al aprobar y luego cada mes); por adelantado es el
                        de todo el periodo, como siempre. */}
                    {esMensual && (
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                        Mes a mes · por un mes ({mesesCotizados} {mesesCotizados === 1 ? "mes" : "meses"} de contrato)
                      </p>
                    )}
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">Precio de lista{esMensual ? " (por mes)" : ""}</span>
                      <span
                        className="resumen-reserva-val"
                        style={{ textDecoration: descuentoPorcentaje && Number(descuentoPorcentaje) > 0 ? "line-through" : "none" }}
                      >
                        ${round2(precioListaNum / divisorMes).toLocaleString("es-MX")}
                      </span>
                    </div>
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">Descuento ({Number(descuentoPorcentaje) || 0}%)</span>
                      <span className="resumen-reserva-val">
                        -${round2((precioListaNum - precioPactadoNum) / divisorMes).toLocaleString("es-MX")}
                      </span>
                    </div>
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">Precio unitario (pactado)</span>
                      <span className="resumen-reserva-val">${round2(precioPactadoNum / divisorMes).toLocaleString("es-MX")}</span>
                    </div>
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">IVA (16%)</span>
                      <span className="resumen-reserva-val">${round2(ivaMonto / divisorMes).toLocaleString("es-MX")}</span>
                    </div>
                    <div className="resumen-reserva-row" style={{ fontWeight: 700 }}>
                      <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                        {esMensual ? "Renta mensual (con IVA)" : "Precio neto (con IVA)"}
                      </span>
                      <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                        ${rentaContrato.toLocaleString("es-MX")}
                      </span>
                    </div>
                    {mostrarUSD && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label" style={{ fontSize: 11 }}>
                          ≈ equivalente en USD
                        </span>
                        <span className="resumen-reserva-val" style={{ fontSize: 11 }}>
                          ${aUSD(rentaContrato)?.toLocaleString("en-US")} USD
                        </span>
                      </div>
                    )}
                    {totalAdicionalesConIva > 0 && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label">Adicionales</span>
                        <span className="resumen-reserva-val">${totalAdicionalesConIva.toLocaleString("es-MX")}</span>
                      </div>
                    )}
                    <div className="resumen-reserva-row">
                      <span className="resumen-reserva-label">Depósito en garantía</span>
                      <span className="resumen-reserva-val">${depositoConIvaNum.toLocaleString("es-MX")}</span>
                    </div>
                    {esSalaJuntas && quiereCoffee && paqueteCoffee && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label">☕ Coffee Break ({personasCoffeeNum} personas)</span>
                        <span className="resumen-reserva-val">${totalCoffeeBreak.toLocaleString("es-MX")}</span>
                      </div>
                    )}
                    <div
                      className="resumen-reserva-row"
                      style={{ fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 8, marginTop: 4 }}
                    >
                      <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                        Total primer pago
                      </span>
                      <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                        ${totalPrimerPagoConCoffee.toLocaleString("es-MX")}
                      </span>
                    </div>
                    {mostrarUSD && (
                      <div className="resumen-reserva-row">
                        <span className="resumen-reserva-label" style={{ fontSize: 11 }}>
                          ≈ equivalente en USD (tipo de cambio ${tipoCambioNum.toLocaleString("es-MX")})
                        </span>
                        <span className="resumen-reserva-val" style={{ fontSize: 11 }}>
                          ${aUSD(totalPrimerPagoConCoffee)?.toLocaleString("en-US")} USD
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
        </div>
      )}

      {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

      {espacioListo && (
        <button
          className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
          onClick={crearCotizacion}
          disabled={guardando}
        >
          <span className="btn-enviar-icon-wrapper">
            <svg
              className="btn-enviar-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path fill="none" d="M0 0h24v24H0z"></path>
              <path
                fill="currentColor"
                d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
              ></path>
            </svg>
          </span>
          <span className="btn-enviar-check-wrapper">
            <svg
              className="btn-enviar-check"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>¡Listo!</span>
          </span>
          <span className="btn-enviar-text">Crear cotización</span>
        </button>
      )}
    </div>
  );
}