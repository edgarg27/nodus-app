"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel, exportarExcelPorCentro } from "@/lib/exportExcel";
import FileDropzone from "../soporte/FileDropzone";
import QRCode from "qrcode";

type Cliente = { id: string; nombre: string; email: string; numero_oficina: string | null; empresa: string | null; centro?: string };
type VoucherCentro = { id: string; codigo: string; folio: string; user_id: string; created_at: string; expira_en: string | null };
type Oficina = { numero: string; tipo: string; estado: string };
type Extension = { id: string; extension: string; did: string | null; tipo: string; departamento: string | null; asignado_a: string | null; activo: boolean };
type Internet = { proveedor_principal: string | null; velocidad_principal: string | null; proveedor_respaldo: string | null; velocidad_respaldo: string | null; notas: string | null };
type Proveedor = { id: string; nombre: string; categoria: string | null; contacto: string | null; telefono: string | null; email: string | null; notas: string | null; centro?: string; tipo?: string | null };
type Gasto = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  notas: string | null;
  tipo?: string;
  centro?: string;
  proveedor_id?: string | null;
  factura_url?: string | null;
  comprobante_pago_url?: string | null;
};
type Prospecto = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  interes: string | null;
  estado: string;
  notas: string | null;
  created_at: string;
  centro?: string | null;
  medio?: string | null;
  // Mismos datos que se piden al dar de alta un cliente (ver
  // app/alta-cliente/page.tsx) — capturarlos aquí desde el inicio evita
  // volver a preguntarlos cuando el prospecto se convierte en cliente.
  empresa?: string | null;
  rfc?: string | null;
  dia_pago?: number | null;
  // Motivo que se captura al marcar un prospecto como "Perdido" (ver
  // confirmarProspectoPerdido más abajo).
  comentario_perdido?: string | null;
};
type Reservacion = { id: string; espacio: string; fecha: string; hora: string; estado: string; user_id: string; cliente_nombre?: string; fuera_horario?: boolean; horas_extra?: number; costo_extra?: number; cotizacion_id?: string | null; paquete_label?: string | null };
type Notificacion = { id: string; tipo: string; categoria: string | null; mensaje: string; leida: boolean; created_at: string; reservacion_id: string | null };
type TipoSolicitudInvitado = "sala_juntas" | "coworking" | "oficina_privada" | "day_pass_coworking" | "day_pass_oficina_privada";
type SolicitudInvitado = {
  id: string;
  created_at: string;
  tipo: TipoSolicitudInvitado;
  centro: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  empresa: string | null;
  fecha_deseada: string | null;
  hora_inicio_deseada: string | null;
  hora_fin_deseada: string | null;
  notas: string | null;
  estado: string;
  reservacion_id: string | null;
  day_pass_id: string | null;
};
type DayPass = {
  id: string;
  folio: number;
  tipo: "coworking" | "oficina_privada";
  centro: string;
  nombre: string;
  fecha: string;
  emitido_por_nombre: string | null;
  created_at: string;
};

const LABEL_TIPO_SOLICITUD: Record<TipoSolicitudInvitado, string> = {
  sala_juntas: "🤝 Sala de juntas",
  coworking: "💻 Coworking",
  oficina_privada: "🏢 Oficina privada",
  day_pass_coworking: "🎫 Day Pass · Coworking",
  day_pass_oficina_privada: "🎫 Day Pass · Oficina privada",
};

// ---------- Calendario de reservaciones (vista admin) ----------
const CAL_DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const CAL_HORAS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8am a 8pm
const CAL_ESPACIOS_DEFAULT = [
  { id: "Sala de Juntas A", icono: "🤝" },
  { id: "Sala de Juntas B", icono: "🤝" },
  { id: "Coworking", icono: "💻" },
  { id: "Sala de Capacitación", icono: "📚" },
];
const CAL_ESPACIOS_POR_CENTRO: Record<string, { id: string; icono: string }[]> = {
  Bosques: [{ id: "Sala de 10 personas", icono: "🤝" }],
};

function calLunesDeLaSemana(fecha: Date) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function calFormatFechaISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function calFormatHora(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

// "Prospectos" ya NO se incluye aquí a propósito — se quitó de esta barra
// de pestañas porque ahora vive como su propio módulo independiente en
// /prospectos (tarjeta "🎯 Prospectos" en AdminPanel.tsx, que enlaza directo
// ahí). El contenido y la lógica del tab "prospectos" siguen intactos más
// abajo — solo ya no aparece mezclado en esta barra.
//
// "Gastos" tampoco se incluye aquí a propósito, por el mismo motivo: ya
// existe la página independiente /gastos (app/gastos/page.tsx), y el módulo
// "Ingresos por Centro" (app/ingresos-centro/page.tsx) ya trae su propia
// pestaña de gastos. El contenido y la lógica del tab "gastos" siguen
// intactos más abajo por si se necesitan de nuevo, solo ya no aparece
// mezclado en esta barra de Reservaciones/Panel de Centro.
const TABS_TODAS = [
  { id: "resumen", label: "📊 Resumen" },
  { id: "reservaciones", label: "📅 Reservaciones" },
  { id: "invitados", label: "🙋 Invitados" },
  { id: "vouchers", label: "🎟️ Vouchers" },
  { id: "telefonia", label: "☎️ Telefonía" },
  { id: "internet", label: "🌐 Internet" },
  { id: "proveedores", label: "🧾 Proveedores" },
];

const ESTADOS_PROSPECTO: Record<string, { label: string; bg: string; color: string }> = {
  nuevo: { label: "Nuevo", bg: "#E6F1FB", color: "#185FA5" },
  contactado: { label: "Contactado", bg: "#FAEEDA", color: "#854F0B" },
  en_seguimiento: { label: "En seguimiento", bg: "#FFF3E8", color: "#F07E3A" },
  convertido: { label: "Convertido", bg: "#E1F5EE", color: "#0F6E56" },
  perdido: { label: "Perdido", bg: "#FCEBEB", color: "#A32D2D" },
};

// Medio por el que llegó el prospecto — mismas opciones que ya usa
// CotizarForm.tsx para "Medio de contacto" al cotizar.
const MEDIOS_PROSPECTO = ["Teléfono", "Redes sociales", "Referido", "Página web", "Otro"];

export default function CentroPanel({
  nombre,
  rol,
  centroPerfil,
  centrosDisponibles,
}: {
  nombre: string;
  rol: string;
  centroPerfil: string | null;
  centrosDisponibles: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const puedeEditarInternet = rol === "sistemas" || (rol === "superadmin" || rol === "gerente");
  const puedeEditarTelefonia = rol === "admin" || (rol === "superadmin" || rol === "gerente");
  const esGlobal = rol === "sistemas" || (rol === "superadmin" || rol === "gerente") || rol === "operaciones";
  const TABS =
    rol === "sistemas"
      ? TABS_TODAS.filter((t) => t.id !== "reservaciones" && t.id !== "prospectos" && t.id !== "telefonia" && t.id !== "invitados")
      : rol === "operaciones"
      ? TABS_TODAS.filter((t) => t.id === "resumen" || t.id === "proveedores" || t.id === "gastos")
      : TABS_TODAS;
  const [menuAbierto, setMenuAbierto] = useState(false);

  const [centro, setCentro] = useState(
    centroPerfil || (esGlobal ? centrosDisponibles[0] || "" : "")
  );
  const TABS_RESTRINGIDAS_OPERACIONES = ["reservaciones", "prospectos", "telefonia", "vouchers", "internet"];
  const tabInicial = searchParams.get("tab") || "resumen";
  const [tab, setTab] = useState(
    rol === "sistemas" && (tabInicial === "reservaciones" || tabInicial === "prospectos" || tabInicial === "telefonia" || tabInicial === "invitados")
      ? "resumen"
      : rol === "operaciones" && TABS_RESTRINGIDAS_OPERACIONES.includes(tabInicial)
      ? "resumen"
      : tabInicial
  );
  const [loading, setLoading] = useState(true);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [oficinas, setOficinas] = useState<Oficina[]>([]);
  const [extensiones, setExtensiones] = useState<Extension[]>([]);
  const [internet, setInternet] = useState<Internet | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [gastosSistemas, setGastosSistemas] = useState<Gasto[]>([]);
  const [formGastoCentro, setFormGastoCentro] = useState("");
  const [prospectos, setProspectos] = useState<Prospecto[]>([]);
  const [reservaciones, setReservaciones] = useState<Reservacion[]>([]);
  // Motivo que el CLIENTE escribió al cancelar su propia reservación (ver
  // app/mis-reservaciones/page.tsx → confirmarCancelacion) — se guarda como
  // una notificación tipo "reservacion_cancelada_cliente" y se mapea aquí
  // por reservacion_id, mismo criterio que ya usa mis-reservaciones para
  // mostrar el motivo de rechazo del admin.
  const [motivosCancelacion, setMotivosCancelacion] = useState<Record<string, string>>({});
  // Motivo que el ADMIN escribió al rechazar (mismo motivo que ya se le
  // manda al cliente) — se mapea aquí también para que el propio admin lo
  // vea junto a la reservación, sin tener que recordarlo.
  const [motivosRechazoAdmin, setMotivosRechazoAdmin] = useState<Record<string, string>>({});
  const [mostrarCalReservaciones, setMostrarCalReservaciones] = useState(false);
  const [calEspacio, setCalEspacio] = useState("");
  const [calInicioSemana, setCalInicioSemana] = useState(calLunesDeLaSemana(new Date()));
  const [calReservas, setCalReservas] = useState<
    { id: string; espacio: string; fecha: string; hora_inicio: string; hora_fin: string; estado: string; user_id: string; cliente_nombre: string | null }[]
  >([]);
  const [calSeleccion, setCalSeleccion] = useState<{ fecha: string; horaInicio: number; horaFin: number } | null>(null);
  const [calGuardando, setCalGuardando] = useState(false);
  const [calError, setCalError] = useState("");
  const [calCargando, setCalCargando] = useState(false);
  const [solicitudesInvitados, setSolicitudesInvitados] = useState<SolicitudInvitado[]>([]);
  const [dayPasses, setDayPasses] = useState<DayPass[]>([]);
  const [solicitudEnAgendamiento, setSolicitudEnAgendamiento] = useState<SolicitudInvitado | null>(null);
  const [mostrarGeneradorDayPass, setMostrarGeneradorDayPass] = useState(false);
  const [dayPassForm, setDayPassForm] = useState<{
    tipo: "coworking" | "oficina_privada";
    nombre: string;
    telefono: string;
    email: string;
    fecha: string;
    solicitudId: string | null;
  }>({
    tipo: "coworking",
    nombre: "",
    telefono: "",
    email: "",
    fecha: "",
    solicitudId: null,
  });
  const [generandoDayPass, setGenerandoDayPass] = useState(false);
  const [errorDayPass, setErrorDayPass] = useState("");
  const [dayPassGenerado, setDayPassGenerado] = useState<DayPass | null>(null);
  // Si ya usó un Day Pass antes (es cortesía de un solo uso por persona),
  // guardamos aquí el folio/fecha de ese pase anterior para avisar y
  // bloquear que se genere otro.
  const [dayPassPrevioUsado, setDayPassPrevioUsado] = useState<{ fecha: string; folio: number } | null>(null);
  const [dayPassQR, setDayPassQR] = useState("");
  const [dayPassCorreoEstado, setDayPassCorreoEstado] = useState<"enviado" | "error" | null>(null);
  const [rechazandoInvitado, setRechazandoInvitado] = useState<SolicitudInvitado | null>(null);
  const [motivoRechazoInvitado, setMotivoRechazoInvitado] = useState("");
  const [linkDayPassCopiado, setLinkDayPassCopiado] = useState(false);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [menuNotifAbierto, setMenuNotifAbierto] = useState(false);
  const [vouchers, setVouchers] = useState<VoucherCentro[]>([]);
  const [generandoVoucherPara, setGenerandoVoucherPara] = useState<string | null>(null);
  const [duracionVoucher, setDuracionVoucher] = useState(43200);
  const [errorVoucher, setErrorVoucher] = useState("");
  const [errorProveedor, setErrorProveedor] = useState("");
  const [vouchersPorCentro, setVouchersPorCentro] = useState<
    Record<string, { clientes: Cliente[]; vouchers: VoucherCentro[] }>
  >({});
  const [cargandoVouchersGlobal, setCargandoVouchersGlobal] = useState(false);
  const [datosGlobales, setDatosGlobales] = useState<
    Record<
      string,
      { proveedores: Proveedor[]; internet: Internet | null; tickets: { id: string; estado: string }[]; gastos: Gasto[] }
    >
  >({});
  const [cargandoDatosGlobales, setCargandoDatosGlobales] = useState(false);

  useEffect(() => {
    if (centro) fetchTodo(centro);
  }, [centro]);

  useEffect(() => {
    if (rol === "sistemas") fetchGastosSistemas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (esGlobal) {
      fetchVouchersTodosLosCentros();
      fetchDatosGlobales();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esGlobal]);

  async function fetchVouchersTodosLosCentros() {
    setCargandoVouchersGlobal(true);
    const resultados = await Promise.all(
      centrosDisponibles.map(async (c) => {
        const [{ data: clis }, { data: vchs }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, nombre, email, numero_oficina, empresa, centro")
            .eq("rol", "cliente")
            .eq("centro", c),
          supabase
            .from("vouchers")
            .select("id, codigo, folio, user_id, created_at, expira_en")
            .eq("centro", c)
            .order("created_at", { ascending: false }),
        ]);
        return [c, { clientes: clis || [], vouchers: vchs || [] }] as const;
      })
    );
    setVouchersPorCentro(Object.fromEntries(resultados));
    setCargandoVouchersGlobal(false);
  }

  // Trae proveedores, internet, tickets y gastos operativos de TODOS los
  // centros de un jalón — usado por Resumen, Internet, Proveedores y Gastos
  // cuando el rol ve todos los centros.
  async function fetchDatosGlobales() {
    setCargandoDatosGlobales(true);
    const resultados = await Promise.all(
      centrosDisponibles.map(async (c) => {
        const [{ data: provs }, { data: net }, { data: tks }, { data: gts }] = await Promise.all([
          supabase.from("proveedores").select("*").eq("centro", c).order("nombre"),
          supabase.from("centros_internet").select("*").eq("centro", c).maybeSingle(),
          supabase.from("tickets").select("id, estado").eq("centro", c),
          supabase.from("gastos").select("*").eq("centro", c).neq("tipo", "sistemas").order("fecha", { ascending: false }),
        ]);
        return [
          c,
          { proveedores: provs || [], internet: net || null, tickets: tks || [], gastos: gts || [] },
        ] as const;
      })
    );
    setDatosGlobales(Object.fromEntries(resultados));
    setCargandoDatosGlobales(false);
  }

  async function recargarDatosCentroGlobal(c: string) {
    const [{ data: provs }, { data: net }, { data: tks }, { data: gts }] = await Promise.all([
      supabase.from("proveedores").select("*").eq("centro", c).order("nombre"),
      supabase.from("centros_internet").select("*").eq("centro", c).maybeSingle(),
      supabase.from("tickets").select("id, estado").eq("centro", c),
      supabase.from("gastos").select("*").eq("centro", c).neq("tipo", "sistemas").order("fecha", { ascending: false }),
    ]);
    setDatosGlobales((prev) => ({
      ...prev,
      [c]: { proveedores: provs || [], internet: net || null, tickets: tks || [], gastos: gts || [] },
    }));
  }

  async function fetchGastosSistemas() {
    const { data } = await supabase
      .from("gastos")
      .select("*")
      .eq("tipo", "sistemas")
      .order("fecha", { ascending: false });
    setGastosSistemas(data || []);
  }

  async function fetchTodo(c: string) {
    setLoading(true);
    const [
      { data: clis },
      { data: ofis },
      { data: exts },
      { data: net },
      { data: provs },
      { data: gts },
      { data: pros },
      { data: reservas },
      { data: notifs },
      { data: vchs },
      { data: sols },
      { data: dps },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nombre, email, numero_oficina, empresa, centro")
        .eq("rol", "cliente")
        .eq("centro", c),
      supabase.from("oficinas").select("numero, tipo, estado").eq("centro", c),
      supabase.from("extensiones").select("*").eq("centro", c).order("extension"),
      supabase.from("centros_internet").select("*").eq("centro", c).maybeSingle(),
      supabase.from("proveedores").select("*").eq("centro", c).order("nombre"),
      supabase.from("gastos").select("*").eq("centro", c).eq("tipo", "admin").order("fecha", { ascending: false }),
      // Sin filtrar por centro a propósito — un prospecto puede interesarse
      // en cualquier Nodus, y cualquier admin (sin importar qué centro
      // tenga seleccionado arriba) debe poder ver y dar seguimiento a
      // todos los prospectos, no solo los del centro activo.
      supabase.from("prospectos").select("*").order("created_at", { ascending: false }),
      supabase
        .from("reservaciones")
        .select("id, espacio, fecha, hora, estado, user_id, fuera_horario, horas_extra, costo_extra, cotizacion_id")
        .eq("centro", c)
        .order("fecha", { ascending: false }),
      supabase
        .from("notificaciones")
        .select("*")
        .in("centro", esGlobal ? centrosDisponibles : [c])
        .in(
          "tipo",
          rol === "sistemas"
            ? ["ticket_en_proceso", "ticket_resuelto", "baja_extension", "nuevo_ticket", "nuevo_voucher", "nuevo_did"]
            : rol === "operaciones"
            ? ["ticket_en_proceso", "ticket_resuelto", "nuevo_ticket", "proximo_mantenimiento"]
            : ["nueva_reservacion", "ticket_en_proceso", "ticket_resuelto", "baja_extension", "nuevo_tour", "pago_confirmado", "servicio_pausado_admin", "nuevo_ticket", "nueva_solicitud_invitado"]
        )
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("vouchers")
        .select("id, codigo, folio, user_id, created_at, expira_en")
        .eq("centro", c)
        .order("created_at", { ascending: false }),
      supabase
        .from("solicitudes_invitados")
        .select("*")
        .eq("centro", c)
        .order("created_at", { ascending: false }),
      supabase
        .from("day_passes")
        .select("*")
        .eq("centro", c)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setClientes(clis || []);
    setOficinas(ofis || []);
    setExtensiones(exts || []);
    setInternet(net || null);
    setProveedores(provs || []);
    setGastos(gts || []);
    setProspectos(pros || []);

    // Le pegamos el nombre del cliente a cada reservación (join manual, ya
    // tenemos "clis" con los mismos clientes de este centro)
    const nombrePorId: Record<string, string> = {};
    (clis || []).forEach((cl) => {
      nombrePorId[cl.id] = cl.nombre;
    });

    // Reservaciones creadas desde Cotizar traen cotizacion_id — se resuelve
    // el label 📦 {paquete} · {modalidad} vía join manual a
    // cotizaciones_comerciales → paquetes.
    const cotizacionIds = Array.from(
      new Set((reservas || []).map((r) => r.cotizacion_id).filter((id): id is string => !!id))
    );
    const labelPorCotizacion: Record<string, string> = {};
    if (cotizacionIds.length > 0) {
      const { data: cots } = await supabase
        .from("cotizaciones_comerciales")
        .select("id, paquete_id, modalidad_paquete")
        .in("id", cotizacionIds);
      const paqueteIds = Array.from(new Set((cots || []).map((ct) => ct.paquete_id).filter((id): id is string => !!id)));
      const { data: paqs } =
        paqueteIds.length > 0
          ? await supabase.from("paquetes").select("id, nombre").in("id", paqueteIds)
          : { data: [] as { id: string; nombre: string }[] };
      const nombrePaquetePorId: Record<string, string> = {};
      (paqs || []).forEach((p) => {
        nombrePaquetePorId[p.id] = p.nombre;
      });
      (cots || []).forEach((ct) => {
        if (!ct.paquete_id) return;
        const partes = [`📦 ${nombrePaquetePorId[ct.paquete_id] || "Paquete"}`, ct.modalidad_paquete || null].filter(Boolean);
        labelPorCotizacion[ct.id] = partes.join(" · ");
      });
    }

    setReservaciones(
      (reservas || []).map((r) => ({
        ...r,
        cliente_nombre: nombrePorId[r.user_id] || "Cliente",
        paquete_label: r.cotizacion_id ? labelPorCotizacion[r.cotizacion_id] || null : null,
      }))
    );

    const canceladasIds = (reservas || []).filter((r) => r.estado === "cancelada").map((r) => r.id);
    const rechazadasIds = (reservas || []).filter((r) => r.estado === "rechazada").map((r) => r.id);
    const idsParaMotivos = [...canceladasIds, ...rechazadasIds];
    if (idsParaMotivos.length > 0) {
      const { data: notifsMotivos } = await supabase
        .from("notificaciones")
        .select("reservacion_id, mensaje, tipo")
        .in("tipo", ["reservacion_cancelada_cliente", "reservacion_rechazada"])
        .in("reservacion_id", idsParaMotivos);
      const mapaCancel: Record<string, string> = {};
      const mapaRechazo: Record<string, string> = {};
      (notifsMotivos || []).forEach((n) => {
        if (!n.reservacion_id) return;
        if (n.tipo === "reservacion_cancelada_cliente") mapaCancel[n.reservacion_id] = n.mensaje;
        else if (n.tipo === "reservacion_rechazada") mapaRechazo[n.reservacion_id] = n.mensaje;
      });
      setMotivosCancelacion(mapaCancel);
      setMotivosRechazoAdmin(mapaRechazo);
    } else {
      setMotivosCancelacion({});
      setMotivosRechazoAdmin({});
    }

    const TIPOS_TICKET = ["nuevo_ticket", "ticket_en_proceso", "ticket_resuelto"];
    let notifsFiltradas = notifs || [];
    if (rol === "sistemas") {
      notifsFiltradas = notifsFiltradas.filter((n) => !TIPOS_TICKET.includes(n.tipo) || n.categoria === "sistemas");
    } else if (rol === "operaciones") {
      notifsFiltradas = notifsFiltradas.filter((n) => !TIPOS_TICKET.includes(n.tipo) || n.categoria === "mantenimiento");
    }
    setNotificaciones(notifsFiltradas);
    setVouchers(vchs || []);
    setSolicitudesInvitados(sols || []);
    setDayPasses(dps || []);
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const ocupacion = useMemo(() => {
    const total = oficinas.length;
    const ocupadas = oficinas.filter((o) => o.estado === "ocupada").length;
    const disponibles = oficinas.filter((o) => o.estado === "disponible").length;
    const porcentaje = total ? Math.round((ocupadas / total) * 100) : 0;
    return { total, ocupadas, disponibles, porcentaje };
  }, [oficinas]);

  const totalGastos = gastos.reduce((s, g) => s + Number(g.monto), 0);

  // ---- Formularios ----
  const [formProveedor, setFormProveedor] = useState({ nombre: "", categoria: "", contacto: "", telefono: "", email: "", notas: "" });
  const [formProveedorCentro, setFormProveedorCentro] = useState(centrosDisponibles[0] || "");
  const [centroGastosActivo, setCentroGastosActivo] = useState(centrosDisponibles[0] || "");
  const [anioGastosCentro, setAnioGastosCentro] = useState(new Date().getFullYear());
  const [anioGastosSistemas, setAnioGastosSistemas] = useState(new Date().getFullYear());
  const [formGasto, setFormGasto] = useState({ concepto: "", categoria: "", monto: "", fecha: new Date().toISOString().split("T")[0], notas: "" });
  const [gastoProveedorId, setGastoProveedorId] = useState("");
  const [gastoFactura, setGastoFactura] = useState<File[]>([]);
  const [gastoComprobante, setGastoComprobante] = useState<File[]>([]);
  const [formProspecto, setFormProspecto] = useState({
    nombre: "",
    telefono: "",
    email: "",
    interes: "",
    notas: "",
    medio: "",
    // Mismos campos que se piden al dar de alta un cliente (ver
    // app/alta-cliente/page.tsx) — capturarlos desde el prospecto evita
    // volver a preguntarlos si se convierte en cliente más adelante. El día
    // de pago se quitó de aquí: se sigue preguntando hasta alta-cliente,
    // cuando ya hay un contrato de por medio.
    empresa: "",
    rfc: "",
    // Centro de interés del prospecto — independiente del centro que el
    // admin tenga seleccionado arriba en el panel (un prospecto puede
    // interesarse en otro Nodus distinto al que el admin está viendo).
    // Se precarga con el centro activo solo como punto de partida.
    centroInteres: centro,
  });
  const [formInternet, setFormInternet] = useState<Internet>({ proveedor_principal: "", velocidad_principal: "", proveedor_respaldo: "", velocidad_respaldo: "", notas: "" });
  const [editandoInternet, setEditandoInternet] = useState(false);
  const [editandoInternetCentro, setEditandoInternetCentro] = useState<string | null>(null);

  useEffect(() => {
    setFormInternet(
      internet || {
        proveedor_principal: "",
        velocidad_principal: "",
        proveedor_respaldo: "",
        velocidad_respaldo: "",
        notas: "",
      }
    );
  }, [internet]);

  // Cada departamento solo ve y da de alta lo suyo — el tipo queda grabado
  // según el rol de quien lo registra.
  function tipoPorRol() {
    if (rol === "sistemas") return "sistemas";
    if (rol === "operaciones") return "operaciones";
    return "admin";
  }

  // Filtra una lista de proveedores para que cada rol solo vea los suyos.
  // Los proveedores viejos sin "tipo" guardado se tratan como "admin"
  // (comportamiento antiguo, antes de que existiera esta separación).
  // Superadmin ve todos, sin filtrar.
  function filtrarProveedoresPorRol(lista: Proveedor[]) {
    if ((rol === "superadmin" || rol === "gerente")) return lista;
    return lista.filter((p) => (p.tipo || "admin") === tipoPorRol());
  }

  async function agregarProveedor(e: React.FormEvent) {
    e.preventDefault();
    setErrorProveedor("");
    if (!formProveedor.nombre.trim()) return;
    const centroDestino = esGlobal ? formProveedorCentro || centrosDisponibles[0] : centro;
    if (!centroDestino) return;
    const { error } = await supabase
      .from("proveedores")
      .insert({ centro: centroDestino, tipo: tipoPorRol(), ...formProveedor });
    if (error) {
      setErrorProveedor(`No se pudo guardar: ${error.message}`);
      return;
    }
    setFormProveedor({ nombre: "", categoria: "", contacto: "", telefono: "", email: "", notas: "" });
    if (esGlobal) {
      recargarDatosCentroGlobal(centroDestino);
    } else {
      fetchTodo(centro);
    }
  }

  async function borrarProveedor(id: string, centroDelProveedor?: string) {
    if (!confirm("¿Borrar este proveedor?")) return;
    await supabase.from("proveedores").delete().eq("id", id);
    if (esGlobal && centroDelProveedor) {
      recargarDatosCentroGlobal(centroDelProveedor);
    } else {
      fetchTodo(centro);
    }
  }

  async function subirArchivoGasto(archivo: File, prefijo: string) {
    const fileName = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
      archivo.name.split(".").pop() || "jpg"
    }`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
    if (uploadError) return null;
    const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function agregarGasto(e: React.FormEvent) {
    e.preventDefault();
    if (!formGasto.concepto.trim() || !formGasto.monto) return;

    const tipoGasto = tipoPorRol();
    // Sistemas y operaciones eligen a qué centro pertenece el gasto (ven
    // todos los centros); admin/otros roles locales usan su propio centro.
    const centroDelGasto =
      rol === "sistemas" ? formGastoCentro : rol === "operaciones" ? centroGastosActivo : centro;
    if ((rol === "sistemas" || rol === "operaciones") && !centroDelGasto) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const facturaUrl = gastoFactura[0] ? await subirArchivoGasto(gastoFactura[0], "factura") : null;
    const comprobanteUrl = gastoComprobante[0] ? await subirArchivoGasto(gastoComprobante[0], "pago") : null;

    let { error: insertError } = await supabase.from("gastos").insert({
      centro: centroDelGasto,
      concepto: formGasto.concepto,
      categoria: formGasto.categoria || null,
      monto: Number(formGasto.monto),
      fecha: formGasto.fecha,
      notas: formGasto.notas || null,
      tipo: tipoGasto,
      registrado_por: user?.id,
      registrado_por_nombre: nombre,
      proveedor_id: gastoProveedorId || null,
      factura_url: facturaUrl,
      comprobante_pago_url: comprobanteUrl,
    });

    // Si todavía no corriste la migración que agrega proveedor_id /
    // factura_url / comprobante_pago_url / registrado_por_nombre a
    // "gastos", reintenta sin esos campos para que el gasto por lo menos
    // quede registrado.
    if (
      insertError &&
      /(proveedor_id|factura_url|comprobante_pago_url|registrado_por_nombre)/i.test(insertError.message || "")
    ) {
      ({ error: insertError } = await supabase.from("gastos").insert({
        centro: centroDelGasto,
        concepto: formGasto.concepto,
        categoria: formGasto.categoria || null,
        monto: Number(formGasto.monto),
        fecha: formGasto.fecha,
        notas: formGasto.notas || null,
        tipo: tipoGasto,
        registrado_por: user?.id,
      }));
    }

    if (insertError) {
      alert(`No se pudo guardar el gasto: ${insertError.message}`);
      return;
    }

    await supabase.from("notificaciones").insert({
      centro: centroDelGasto,
      tipo: "nuevo_gasto",
      mensaje: `💸 Nuevo gasto (${tipoGasto === "sistemas" ? "Sistemas" : tipoGasto === "operaciones" ? "Operaciones" : "Admin"}) en ${centroDelGasto}: ${formGasto.concepto} — $${Number(formGasto.monto).toLocaleString("es-MX")}`,
    });
    setFormGasto({ concepto: "", categoria: "", monto: "", fecha: new Date().toISOString().split("T")[0], notas: "" });
    setFormGastoCentro("");
    setGastoProveedorId("");
    setGastoFactura([]);
    setGastoComprobante([]);
    if (rol === "sistemas") fetchGastosSistemas();
    else if (rol === "operaciones" && centroDelGasto) recargarDatosCentroGlobal(centroDelGasto);
    else if (centro) fetchTodo(centro);
  }

  async function borrarGasto(id: string, centroDelGasto?: string) {
    if (!confirm("¿Borrar este gasto?")) return;
    await supabase.from("gastos").delete().eq("id", id);
    if (rol === "sistemas") fetchGastosSistemas();
    else if (esGlobal && centroDelGasto) recargarDatosCentroGlobal(centroDelGasto);
    else if (centro) fetchTodo(centro);
  }

  // ---------- Calendario de reservaciones (admin) ----------
  const calEspaciosDisponibles = (centro && CAL_ESPACIOS_POR_CENTRO[centro]) || CAL_ESPACIOS_DEFAULT;

  useEffect(() => {
    if (!calEspacio && calEspaciosDisponibles.length > 0) {
      setCalEspacio(calEspaciosDisponibles[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro]);

  useEffect(() => {
    if (mostrarCalReservaciones && calEspacio && centro) fetchCalReservas();
    setCalSeleccion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calEspacio, calInicioSemana, mostrarCalReservaciones, centro]);

  async function fetchCalReservas() {
    setCalCargando(true);
    const desde = calFormatFechaISO(calInicioSemana);
    const hasta = calFormatFechaISO(new Date(calInicioSemana.getTime() + 6 * 86400000));
    const { data } = await supabase
      .from("reservaciones")
      .select("id, espacio, fecha, hora_inicio, hora_fin, estado, user_id")
      .eq("centro", centro)
      .eq("espacio", calEspacio)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .in("estado", ["pendiente", "confirmada"]);

    const reservas = data || [];
    const userIds = Array.from(new Set(reservas.map((r) => r.user_id).filter(Boolean)));
    let nombrePorId: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", userIds);
      nombrePorId = Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre]));
    }

    setCalReservas(reservas.map((r) => ({ ...r, cliente_nombre: nombrePorId[r.user_id] || "Cliente" })));
    setCalCargando(false);
  }

  const calDiasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(calInicioSemana);
    d.setDate(d.getDate() + i);
    return d;
  });

  function calEstaOcupado(fechaISO: string, hora: number) {
    return calReservas.some((r) => {
      if (r.fecha !== fechaISO || !r.hora_inicio || !r.hora_fin) return false;
      const ini = parseInt(r.hora_inicio.split(":")[0]);
      const fin = parseInt(r.hora_fin.split(":")[0]);
      return hora >= ini && hora < fin;
    });
  }

  function calEsPasado(fechaISO: string, hora: number) {
    const ahora = new Date();
    const [y, m, d] = fechaISO.split("-").map(Number);
    const fechaHora = new Date(y, m - 1, d, hora);
    return fechaHora < ahora;
  }

  function calRangoLibre(fechaISO: string, ini: number, fin: number) {
    for (let h = ini; h < fin; h++) {
      if (calEstaOcupado(fechaISO, h) || calEsPasado(fechaISO, h)) return false;
    }
    return true;
  }

  function calClickSlot(fechaISO: string, hora: number) {
    if (calEstaOcupado(fechaISO, hora) || calEsPasado(fechaISO, hora)) return;
    if (!calSeleccion || calSeleccion.fecha !== fechaISO) {
      setCalSeleccion({ fecha: fechaISO, horaInicio: hora, horaFin: hora + 1 });
    } else if (hora === calSeleccion.horaInicio) {
      setCalSeleccion(null);
    } else if (hora > calSeleccion.horaInicio) {
      if (calRangoLibre(fechaISO, calSeleccion.horaInicio, hora + 1)) {
        setCalSeleccion({ ...calSeleccion, horaFin: hora + 1 });
      }
    } else {
      if (calRangoLibre(fechaISO, hora, calSeleccion.horaFin)) {
        setCalSeleccion({ fecha: fechaISO, horaInicio: hora, horaFin: calSeleccion.horaFin });
      }
    }
  }

  // El admin reserva directo, sin límite de horas de contrato y ya
  // confirmada (no necesita aprobarse a sí mismo).
  async function confirmarReservaAdmin() {
    if (!calSeleccion || !centro) return;
    setCalError("");
    setCalGuardando(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const horarioTexto = `${calFormatHora(calSeleccion.horaInicio)} - ${calFormatHora(calSeleccion.horaFin)}`;
    const { data: nuevaReserva, error: insertError } = await supabase
      .from("reservaciones")
      .insert({
        user_id: user?.id,
        espacio: calEspacio,
        fecha: calSeleccion.fecha,
        hora: horarioTexto,
        hora_inicio: `${String(calSeleccion.horaInicio).padStart(2, "0")}:00`,
        hora_fin: `${String(calSeleccion.horaFin).padStart(2, "0")}:00`,
        centro,
        estado: "confirmada",
        fuera_horario: false,
        horas_incluidas: 0,
        horas_extra: 0,
        costo_extra: 0,
      })
      .select()
      .single();
    if (insertError || !nuevaReserva) {
      // Código 23P01 = violación de la restricción de exclusión que evita
      // traslapes de horario (ver migracion_no_traslape_reservaciones.sql).
      setCalError(
        insertError?.code === "23P01"
          ? "Ese horario ya quedó ocupado por otra reservación. Elige otro horario."
          : `No se pudo guardar: ${insertError?.message}`
      );
      setCalGuardando(false);
      return;
    }
    // Si esta reservación vino de una solicitud de invitado (pestaña
    // "Invitados"), la marcamos como atendida y la enlazamos a la
    // reservación real que se acaba de crear.
    if (solicitudEnAgendamiento) {
      await supabase
        .from("solicitudes_invitados")
        .update({ estado: "agendada", atendido_por: user?.id, reservacion_id: nuevaReserva.id })
        .eq("id", solicitudEnAgendamiento.id);
      setSolicitudEnAgendamiento(null);
    }
    setCalSeleccion(null);
    setCalGuardando(false);
    fetchCalReservas();
    fetchTodo(centro);
  }

  // Sugiere qué espacio del catálogo del centro conviene preseleccionar en
  // el calendario admin al agendar una solicitud de invitado (sala de
  // juntas vs. coworking/bolsa).
  function espacioSugeridoParaTipo(tipo: "sala_juntas" | "coworking", espacios: { id: string; icono: string }[]) {
    if (tipo === "coworking") {
      return espacios.find((e) => e.id.startsWith("Coworking"))?.id || espacios[0]?.id || "";
    }
    return (
      espacios.find((e) => !e.id.startsWith("Coworking") && !e.id.startsWith("Sala de Capacitación"))?.id ||
      espacios[0]?.id ||
      ""
    );
  }

  // Botón "📅 Agendar" de una solicitud de invitado (sala de juntas o
  // coworking) — abre el calendario admin ya existente, preseleccionando
  // espacio y semana; el admin solo elige el horario final y confirma.
  function agendarSolicitud(s: SolicitudInvitado) {
    setTab("reservaciones");
    setMostrarCalReservaciones(true);
    setCalEspacio(espacioSugeridoParaTipo(s.tipo === "coworking" ? "coworking" : "sala_juntas", calEspaciosDisponibles));
    if (s.fecha_deseada) {
      const [y, m, d] = s.fecha_deseada.split("-").map(Number);
      if (y && m && d) setCalInicioSemana(calLunesDeLaSemana(new Date(y, m - 1, d)));
    }
    setCalSeleccion(null);
    setSolicitudEnAgendamiento(s);
  }

  // Botón "📇 Convertir a prospecto" para solicitudes de oficina privada —
  // esto no es una reserva por hora, es un interesado en rentar, así que
  // se atiende igual que cualquier otro prospecto (Prospecto → Cotizar →
  // Nuevo cliente).
  async function convertirSolicitudAProspecto(s: SolicitudInvitado) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("prospectos").insert({
      centro,
      nombre: s.nombre,
      telefono: s.telefono,
      email: s.email,
      empresa: s.empresa || null,
      interes: "Oficina privada",
      notas: s.notas || null,
      registrado_por: user?.id,
    });
    await supabase.from("solicitudes_invitados").update({ estado: "agendada", atendido_por: user?.id }).eq("id", s.id);
    setTab("prospectos");
    fetchTodo(centro);
  }

  // El QR del ticket se regenera cada vez que se emite un Day Pass nuevo.
  useEffect(() => {
    if (!dayPassGenerado) {
      setDayPassQR("");
      return;
    }
    // El QR manda a la pantalla de check-in (requiere sesión) donde se
    // acepta la llegada del invitado — no a la página pública del boleto.
    const link = `${window.location.origin}/day-pass/${dayPassGenerado.id}/checkin`;
    QRCode.toDataURL(link, { margin: 0, width: 200 })
      .then(setDayPassQR)
      .catch(() => setDayPassQR(""));
  }, [dayPassGenerado]);

  // El Day Pass es una cortesía de un solo uso por persona. Solo cuenta
  // como "ya usado" cuando el admin lo aceptó en el check-in (escaneó el
  // QR y confirmó su llegada) — no basta con haberlo generado, porque
  // todavía no se ha verificado que en verdad se presentó.
  async function buscarDayPassPrevioUsado(nombreP: string, telefonoP: string, emailP: string) {
    const nombreNorm = nombreP.trim();
    const telefonoNorm = telefonoP.trim();
    const emailNorm = emailP.trim();
    const filtros: string[] = [];
    if (telefonoNorm) filtros.push(`telefono.eq.${telefonoNorm}`);
    if (emailNorm) filtros.push(`email.ilike.${emailNorm}`);
    if (nombreNorm) filtros.push(`nombre.ilike.${nombreNorm}`);
    if (filtros.length === 0) return null;
    const { data, error } = await supabase
      .from("day_passes")
      .select("fecha, folio")
      .eq("usado", true)
      .or(filtros.join(","))
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      // Si falla (ej. porque todavía no se corrió la migración y las
      // columnas nuevas no existen), no bloqueamos silenciosamente sin
      // avisar — lo dejamos en la consola para poder diagnosticarlo.
      console.error("No se pudo verificar Day Pass previo:", error.message);
      return null;
    }
    return data || null;
  }

  useEffect(() => {
    if (!mostrarGeneradorDayPass || dayPassGenerado) return;
    const nombreP = dayPassForm.nombre.trim();
    const telefonoP = dayPassForm.telefono.trim();
    const emailP = dayPassForm.email.trim();
    if (!nombreP && !telefonoP && !emailP) {
      setDayPassPrevioUsado(null);
      return;
    }
    const timeoutId = setTimeout(() => {
      buscarDayPassPrevioUsado(nombreP, telefonoP, emailP).then(setDayPassPrevioUsado);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [mostrarGeneradorDayPass, dayPassGenerado, dayPassForm.nombre, dayPassForm.telefono, dayPassForm.email]);

  function abrirGeneradorDayPass(solicitud?: SolicitudInvitado | null) {
    setErrorDayPass("");
    setDayPassGenerado(null);
    setDayPassCorreoEstado(null);
    setDayPassPrevioUsado(null);
    setDayPassForm({
      tipo: solicitud?.tipo === "day_pass_oficina_privada" ? "oficina_privada" : "coworking",
      nombre: solicitud?.nombre || "",
      telefono: solicitud?.telefono || "",
      email: solicitud?.email || "",
      fecha: solicitud?.fecha_deseada || calFormatFechaISO(new Date()),
      solicitudId: solicitud?.id || null,
    });
    setMostrarGeneradorDayPass(true);
  }

  async function generarDayPass() {
    if (!dayPassForm.nombre.trim() || !centro || !dayPassForm.fecha) {
      setErrorDayPass("Falta el nombre de quien va a usar el pase, o la fecha");
      return;
    }
    setErrorDayPass("");
    setGenerandoDayPass(true);
    // Verificación "fresca" justo antes de generar — no nos confiamos del
    // todo del aviso que se calcula mientras escribe (ese tiene un
    // pequeño retraso a propósito para no consultar la base en cada
    // tecla, y un clic muy rápido en "Generar" se le podía escapar).
    const previo = await buscarDayPassPrevioUsado(dayPassForm.nombre, dayPassForm.telefono, dayPassForm.email);
    if (previo) {
      setDayPassPrevioUsado(previo);
      setGenerandoDayPass(false);
      setErrorDayPass(
        `Este invitado ya usó un Day Pass el ${previo.fecha} (folio NODUS-${String(previo.folio).padStart(3, "0")}). Es una cortesía de un solo uso, no se puede generar otro.`
      );
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: nuevoPase, error: insertError } = await supabase
      .from("day_passes")
      .insert({
        tipo: dayPassForm.tipo,
        centro,
        nombre: dayPassForm.nombre.trim(),
        telefono: dayPassForm.telefono.trim() || null,
        email: dayPassForm.email.trim() || null,
        fecha: dayPassForm.fecha,
        emitido_por: user?.id,
        emitido_por_nombre: nombre,
        solicitud_id: dayPassForm.solicitudId,
      })
      .select()
      .single();
    setGenerandoDayPass(false);
    if (insertError || !nuevoPase) {
      // Mostramos el motivo real (ej. si faltan columnas por no haber
      // corrido la migración, Supabase lo dice aquí) en vez de un mensaje
      // genérico que no ayuda a saber qué pasó.
      setErrorDayPass(
        insertError?.message
          ? `No se pudo generar el Day Pass: ${insertError.message}`
          : "No se pudo generar el Day Pass. Intenta de nuevo."
      );
      return;
    }
    if (dayPassForm.solicitudId) {
      await supabase
        .from("solicitudes_invitados")
        .update({ estado: "agendada", day_pass_id: nuevoPase.id, atendido_por: user?.id })
        .eq("id", dayPassForm.solicitudId);
    }
    setDayPassGenerado(nuevoPase);
    fetchTodo(centro);

    // Best-effort: si dejaron un correo, le mandamos el Day Pass por ahí
    // (usa la misma función "send-email" que ya usa el resto de la app).
    // El link de /day-pass siempre queda disponible como respaldo por si
    // esta función no soporta todavía este tipo de correo.
    const correoInvitado = dayPassForm.email.trim();
    if (correoInvitado) {
      const link = `${window.location.origin}/day-pass/${nuevoPase.id}`;
      try {
        const { error: emailError } = await supabase.functions.invoke("send-email", {
          body: {
            tipo: "day_pass_generado",
            clienteEmail: correoInvitado,
            clienteNombre: dayPassForm.nombre.trim(),
            tipoDayPass: dayPassForm.tipo,
            centro,
            fecha: dayPassForm.fecha,
            folio: nuevoPase.folio,
            link,
          },
        });
        setDayPassCorreoEstado(emailError ? "error" : "enviado");
      } catch {
        setDayPassCorreoEstado("error");
      }
    }
  }

  async function copiarLinkDayPass() {
    if (!dayPassGenerado) return;
    const link = `${window.location.origin}/day-pass/${dayPassGenerado.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setLinkDayPassCopiado(true);
      setTimeout(() => setLinkDayPassCopiado(false), 2500);
    } catch {
      alert(link);
    }
  }

  async function confirmarRechazoInvitado() {
    if (!rechazandoInvitado) return;
    await supabase
      .from("solicitudes_invitados")
      .update({ estado: "rechazada", motivo_rechazo: motivoRechazoInvitado.trim() || null })
      .eq("id", rechazandoInvitado.id);
    setSolicitudesInvitados((prev) =>
      prev.map((s) => (s.id === rechazandoInvitado.id ? { ...s, estado: "rechazada" } : s))
    );
    setRechazandoInvitado(null);
    setMotivoRechazoInvitado("");
  }

  async function agregarProspecto(e: React.FormEvent) {
    e.preventDefault();
    if (!formProspecto.nombre.trim() || !formProspecto.centroInteres) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("prospectos").insert({
      centro: formProspecto.centroInteres,
      nombre: formProspecto.nombre,
      telefono: formProspecto.telefono,
      email: formProspecto.email,
      interes: formProspecto.interes,
      notas: formProspecto.notas,
      medio: formProspecto.medio || null,
      empresa: formProspecto.empresa || null,
      rfc: formProspecto.rfc || null,
      registrado_por: user?.id,
    });
    setFormProspecto({
      nombre: "",
      telefono: "",
      email: "",
      interes: "",
      notas: "",
      medio: "",
      empresa: "",
      rfc: "",
      centroInteres: centro,
    });
    fetchTodo(centro);
  }

  async function cambiarEstadoProspecto(id: string, estado: string) {
    if (estado === "perdido") {
      const p = prospectos.find((x) => x.id === id) || null;
      setComentarioPerdido("");
      setProspectoPerdiendo(p);
      return;
    }
    await supabase.from("prospectos").update({ estado, comentario_perdido: null }).eq("id", id);
    setProspectos((prev) => prev.map((p) => (p.id === id ? { ...p, estado, comentario_perdido: null } : p)));
  }

  const [prospectoPerdiendo, setProspectoPerdiendo] = useState<Prospecto | null>(null);
  const [comentarioPerdido, setComentarioPerdido] = useState("");

  async function confirmarProspectoPerdido() {
    if (!prospectoPerdiendo) return;
    if (!comentarioPerdido.trim()) {
      alert("Escribe un comentario para marcarlo como Perdido.");
      return;
    }
    const id = prospectoPerdiendo.id;
    await supabase.from("prospectos").update({ estado: "perdido", comentario_perdido: comentarioPerdido.trim() }).eq("id", id);
    setProspectos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado: "perdido", comentario_perdido: comentarioPerdido.trim() } : p))
    );
    setProspectoPerdiendo(null);
    setComentarioPerdido("");
  }

  async function borrarProspecto(id: string) {
    if (!confirm("¿Borrar este prospecto?")) return;
    await supabase.from("prospectos").delete().eq("id", id);
    fetchTodo(centro);
  }

  const [formExtension, setFormExtension] = useState({ extension: "", did: "", tipo: "interna", departamento: "", asignado_a: "" });

  async function agregarExtension(e: React.FormEvent) {
    e.preventDefault();
    if (!formExtension.extension.trim()) return;
    await supabase.from("extensiones").insert({
      centro,
      extension: formExtension.extension.trim(),
      did: formExtension.did.trim() || null,
      tipo: formExtension.tipo,
      departamento: formExtension.departamento.trim() || null,
      asignado_a: formExtension.asignado_a.trim() || null,
      activo: true,
    });
    setFormExtension({ extension: "", did: "", tipo: "interna", departamento: "", asignado_a: "" });
    fetchTodo(centro);
  }

  const [rechazando, setRechazando] = useState<Reservacion | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  async function responderReserva(reserva: Reservacion, aceptar: boolean) {
    if (!aceptar) {
      setMotivoRechazo("");
      setRechazando(reserva); // solo abre el modal, no muta nada aún
      return;
    }

    await supabase.from("reservaciones").update({ estado: "confirmada" }).eq("id", reserva.id);
    setReservaciones((prev) => prev.map((r) => (r.id === reserva.id ? { ...r, estado: "confirmada" } : r)));

    await supabase.from("notificaciones").insert({
      centro,
      user_id: reserva.user_id,
      tipo: "reservacion_confirmada",
      mensaje: `✓ Tu reservación de ${reserva.espacio} el ${reserva.fecha} (${reserva.hora}) fue confirmada.`,
      reservacion_id: reserva.id,
    });

    const { data: cliente } = await supabase
      .from("profiles")
      .select("email, nombre")
      .eq("id", reserva.user_id)
      .single();

    if (cliente?.email) {
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            tipo: "reservacion_confirmada",
            clienteEmail: cliente.email,
            clienteNombre: cliente.nombre,
            espacio: reserva.espacio,
            fecha: reserva.fecha,
            horario: reserva.hora,
          },
        });
      } catch {
        // no crítico
      }
    }
  }

  // Orden de operaciones importante: el UPDATE del estado se ejecuta antes
  // de intentar la notificación. Si el INSERT en notificaciones falla, el
  // rechazo ya quedó persistido — solo se avisa al admin, no se revierte.
  async function confirmarRechazo() {
    if (!rechazando) return;
    const reserva = rechazando;
    const motivo = motivoRechazo.trim();

    await supabase.from("reservaciones").update({ estado: "rechazada" }).eq("id", reserva.id);
    setReservaciones((prev) => prev.map((r) => (r.id === reserva.id ? { ...r, estado: "rechazada" } : r)));

    const mensaje = motivo
      ? `Tu reservación de ${reserva.espacio} el ${reserva.fecha} (${reserva.hora}) fue rechazada. Motivo: ${motivo}`
      : `Tu reservación de ${reserva.espacio} el ${reserva.fecha} (${reserva.hora}) fue rechazada.`;

    const { error: notifError } = await supabase.from("notificaciones").insert({
      centro,
      user_id: reserva.user_id,
      tipo: "reservacion_rechazada",
      mensaje,
      reservacion_id: reserva.id,
    });
    if (notifError) {
      alert("Se rechazó la reservación, pero no se pudo avisar al cliente: " + notifError.message);
    }

    const { data: cliente } = await supabase
      .from("profiles")
      .select("email, nombre")
      .eq("id", reserva.user_id)
      .single();

    if (cliente?.email) {
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            tipo: "reservacion_rechazada",
            clienteEmail: cliente.email,
            clienteNombre: cliente.nombre,
            espacio: reserva.espacio,
            fecha: reserva.fecha,
            horario: reserva.hora,
            motivo,
          },
        });
      } catch {
        // no crítico
      }
    }

    setRechazando(null);
    setMotivoRechazo("");
  }

  async function marcarNotifLeida(id: string) {
    await supabase.from("notificaciones").update({ leida: true }).eq("id", id);
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
  }

  async function descartarNotificacion(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setNotificaciones((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notificaciones").delete().eq("id", id);
  }

  const notifsSinLeer = notificaciones.filter((n) => !n.leida).length;
  const reservasPendientes = reservaciones.filter((r) => r.estado === "pendiente");

  // Refleja un voucher nuevo tanto en la lista del centro seleccionado como
  // en la vista global agrupada por centro, para que ambas queden en sync
  // sin tener que recargar todo.
  function agregarVoucherAEstado(centroDelVoucher: string, voucher: VoucherCentro) {
    if (centroDelVoucher === centro) {
      setVouchers((prev) => [voucher, ...prev]);
    }
    setVouchersPorCentro((prev) => {
      const actual = prev[centroDelVoucher];
      if (!actual) return prev;
      return {
        ...prev,
        [centroDelVoucher]: { ...actual, vouchers: [voucher, ...actual.vouchers] },
      };
    });
  }

  async function generarVoucherParaCliente(cliente: Cliente) {
    setGenerandoVoucherPara(cliente.id);
    setErrorVoucher("");
    // Usamos el centro real del cliente (importante en la vista global, donde
    // se listan clientes de varios centros a la vez) y no el del selector.
    const centroCliente = cliente.centro || centro;

    if (centroCliente === "Bosques") {
      try {
        const res = await fetch("/api/generar-voucher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteId: cliente.id, minutos: duracionVoucher }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorVoucher(data.error || "No se pudo generar el voucher");
        } else {
          agregarVoucherAEstado(centroCliente, data.voucher);
          await supabase.from("notificaciones").insert({
            centro: centroCliente,
            tipo: "nuevo_voucher",
            mensaje: `🎟️ Nuevo voucher generado para ${cliente.nombre} (${centroCliente})`,
          });
        }
      } catch {
        setErrorVoucher("No se pudo conectar con UniFi. Intenta de nuevo.");
      }
      setGenerandoVoucherPara(null);
      return;
    }

    const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";
    for (let i = 0; i < 8; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
    codigo = `${codigo.slice(0, 4)}-${codigo.slice(4)}`;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const folio = `VCH-${Date.now().toString().slice(-6)}`;
    const expiraEn = new Date(Date.now() + duracionVoucher * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("vouchers")
      .insert({
        user_id: cliente.id,
        codigo,
        folio,
        centro: centroCliente,
        generado_por: user?.id,
        duracion_minutos: duracionVoucher,
        expira_en: expiraEn,
      })
      .select()
      .single();

    if (!error && data) {
      agregarVoucherAEstado(centroCliente, data);
      await supabase.from("notificaciones").insert({
        centro: centroCliente,
        tipo: "nuevo_voucher",
        mensaje: `🎟️ Nuevo voucher generado para ${cliente.nombre} (${centroCliente})`,
      });
    }
    setGenerandoVoucherPara(null);
  }

  async function borrarVoucherCentro(voucherId: string) {
    if (!confirm("¿Borrar este voucher? Si es real, también se elimina del controlador UniFi.")) return;
    setErrorVoucher("");
    try {
      const res = await fetch("/api/eliminar-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorVoucher(data.error || "No se pudo borrar el voucher");
      } else {
        setVouchers((prev) => prev.filter((v) => v.id !== voucherId));
        setVouchersPorCentro((prev) => {
          const actualizado: typeof prev = {};
          Object.keys(prev).forEach((c) => {
            actualizado[c] = { ...prev[c], vouchers: prev[c].vouchers.filter((v) => v.id !== voucherId) };
          });
          return actualizado;
        });
      }
    } catch {
      setErrorVoucher("No se pudo conectar. Intenta de nuevo.");
    }
  }

  // Agrupa una lista de clientes por número de oficina y, para cada uno,
  // despliega TODOS sus vouchers (no solo el más reciente).
  function renderOficinasConVouchers(clientesLista: Cliente[], vouchersLista: VoucherCentro[]) {
    const porOficina: Record<string, Cliente[]> = {};
    clientesLista.forEach((c) => {
      const key = c.numero_oficina || "Sin oficina asignada";
      if (!porOficina[key]) porOficina[key] = [];
      porOficina[key].push(c);
    });
    const oficinasOrdenadas = Object.keys(porOficina).sort();

    if (oficinasOrdenadas.length === 0) {
      return <div className="empty-card">Sin clientes registrados en este centro</div>;
    }

    return oficinasOrdenadas.map((oficina) => (
      <div key={oficina}>
        <p className="panel-section-label" style={{ marginTop: 12 }}>
          🏢 Oficina {oficina}
        </p>
        {porOficina[oficina].map((c) => {
          const vouchersDeCliente = vouchersLista.filter((v) => v.user_id === c.id);
          return (
            <div className="item-card" key={c.id} style={{ marginBottom: 8, flexWrap: "wrap" }}>
              <div className="item-card-info" style={{ flex: 1, minWidth: 200 }}>
                {c.empresa && (
                  <p
                    className="item-card-titulo"
                    style={{ color: "#0d1b3e", fontSize: 12, marginBottom: 2 }}
                  >
                    🏛️ {c.empresa}
                  </p>
                )}
                <p className="item-card-titulo">{c.nombre}</p>
                <p className="item-card-sub">{c.email}</p>

                {vouchersDeCliente.length === 0 ? (
                  <p className="item-card-extra" style={{ color: "#888", marginTop: 4 }}>
                    Sin vouchers generados
                  </p>
                ) : (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                    {vouchersDeCliente.map((v) => {
                      const vencido = v.expira_en && new Date(v.expira_en) < new Date();
                      return (
                        <div
                          key={v.id}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                        >
                          <p
                            className="item-card-extra"
                            style={{ color: vencido ? "#A32D2D" : "#0F6E56", margin: 0 }}
                          >
                            {vencido ? "⚠️ Venció: " : "✓ Vigente: "}
                            <span style={{ fontFamily: "monospace" }}>{v.codigo}</span>
                            {v.expira_en && ` · ${new Date(v.expira_en).toLocaleDateString("es-MX")}`}
                          </p>
                          <button
                            className="tel-borrar-btn"
                            style={{ fontSize: 11, flexShrink: 0 }}
                            onClick={() => borrarVoucherCentro(v.id)}
                          >
                            🗑 Borrar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <button
                  className="tel-borrar-btn"
                  style={{ color: "#0d1b3e", fontWeight: 700 }}
                  onClick={() => generarVoucherParaCliente(c)}
                  disabled={generandoVoucherPara === c.id}
                >
                  {generandoVoucherPara === c.id ? "..." : "🎫 Generar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    ));
  }

  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Suma de gastos por mes de un año específico, en el orden Ene→Dic.
  function gastosPorMes(lista: Gasto[], anio: number) {
    const totales = new Array(12).fill(0);
    lista.forEach((g) => {
      const d = new Date(g.fecha);
      if (d.getFullYear() === anio) totales[d.getMonth()] += Number(g.monto);
    });
    return MESES.map((m, i) => ({ centro: m, valor: Math.round(totales[i] * 100) / 100 }));
  }

  // Suma de gastos por año (para el comparativo anual).
  function gastosPorAnio(lista: Gasto[]) {
    const porAnio: Record<number, number> = {};
    lista.forEach((g) => {
      const anio = new Date(g.fecha).getFullYear();
      porAnio[anio] = (porAnio[anio] || 0) + Number(g.monto);
    });
    return Object.keys(porAnio)
      .sort()
      .map((a) => ({ centro: a, valor: Math.round(porAnio[Number(a)] * 100) / 100 }));
  }

  // Años que tienen al menos un gasto registrado, más el año actual.
  function aniosConDatos(lista: Gasto[]) {
    const anios = new Set(lista.map((g) => new Date(g.fecha).getFullYear()));
    anios.add(new Date().getFullYear());
    return Array.from(anios).sort((a, b) => b - a);
  }

  // Gráfica de barras simple (sin librerías externas) para comparar un valor
  // entre todos los centros — usada en el Resumen global.
  function renderBarrasPorCentro(
    titulo: string,
    datos: { centro: string; valor: number }[],
    color: string
  ) {
    const max = Math.max(...datos.map((d) => d.valor), 1);
    const total = datos.reduce((s, d) => s + d.valor, 0);
    return (
      <div className="rep-ocupacion-card" style={{ marginBottom: 12 }}>
        <div className="rep-ocupacion-header">
          <span className="rep-ocupacion-centro">{titulo}</span>
          <span className="rep-ocupacion-porcentaje">{total}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {datos.map((d) => (
            <div key={d.centro}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span>{d.centro}</span>
                <b>{d.valor}</b>
              </div>
              <div style={{ background: "#f0f0f0", borderRadius: 6, height: 10, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(d.valor / max) * 100}%`,
                    background: color,
                    height: "100%",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  async function guardarInternet() {
    await supabase.from("centros_internet").upsert(
      { centro, ...formInternet, updated_at: new Date().toISOString() },
      { onConflict: "centro" }
    );
    setEditandoInternet(false);
    fetchTodo(centro);
  }

  async function guardarInternetGlobal(c: string) {
    await supabase.from("centros_internet").upsert(
      { centro: c, ...formInternet, updated_at: new Date().toISOString() },
      { onConflict: "centro" }
    );
    setEditandoInternetCentro(null);
    recargarDatosCentroGlobal(c);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <a className="rep-back" href="/dashboard">
            ← Regresar
          </a>
          <p className="panel-header-title">Panel de Centro</p>
          <p className="panel-header-sub">{esGlobal ? "Todos tus centros" : centro || "Sin centro asignado"}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ position: "relative" }}>
            <button
              className={"notif-bell" + (notifsSinLeer > 0 ? " notif-bell-ring" : "")}
              onClick={() => setMenuNotifAbierto((v) => !v)}
              title="Notificaciones"
            >
              <svg className="notif-bell-svg" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
                <path d="M224 0c-17.7 0-32 14.3-32 32V49.9C119.5 61.4 64 124.2 64 200v33.4c0 45.4-15.5 89.5-43.8 124.9L5.3 377c-5.8 7.2-6.9 17.1-2.9 25.4S14.8 416 24 416H424c9.2 0 17.6-5.3 21.6-13.6s2.9-18.2-2.9-25.4l-14.9-18.6c-28.3-35.4-43.8-79.5-43.8-124.9V200c0-75.8-55.5-138.6-128-150.1V32c0-17.7-14.3-32-32-32zm0 96h8c57.4 0 104 46.6 104 104v33.4c0 47.9 13.9 94.6 39.7 134.6H72.3c25.8-40 39.7-86.7 39.7-134.6V200c0-57.4 46.6-104 104-104h8zm64 352H160c0 17 6.7 33.3 18.7 45.3S207 512 224 512s33.3-6.7 45.3-18.7S288 465 288 448z" />
              </svg>
              {notifsSinLeer > 0 && <span className="notif-badge">{notifsSinLeer}</span>}
            </button>
            {menuNotifAbierto && (
              <>
                <div className="menu-overlay-click" onClick={() => setMenuNotifAbierto(false)} />
                <div className="notif-dropdown">
                  {notificaciones.length === 0 ? (
                    <p className="notif-empty">Sin notificaciones</p>
                  ) : (
                    notificaciones.map((n) => (
                      <div
                        key={n.id}
                        className={"notif-item" + (!n.leida ? " no-leida" : "")}
                        onClick={() => {
                          if (!n.leida) marcarNotifLeida(n.id);
                          if (n.tipo === "nueva_reservacion") {
                            setTab("reservaciones");
                            setMenuNotifAbierto(false);
                          } else if (
                            n.tipo === "nuevo_ticket" ||
                            n.tipo === "ticket_en_proceso" ||
                            n.tipo === "ticket_resuelto"
                          ) {
                            router.push("/tickets");
                          } else if (n.tipo === "nuevo_voucher") {
                            setTab("vouchers");
                            setMenuNotifAbierto(false);
                          } else if (n.tipo === "nuevo_did" || n.tipo === "baja_extension") {
                            router.push("/telefonia");
                          } else if (n.tipo === "proximo_mantenimiento") {
                            router.push("/mantenimiento");
                          }
                        }}
                        style={{ position: "relative", paddingRight: 26 }}
                      >
                        <button
                          onClick={(e) => descartarNotificacion(n.id, e)}
                          title="Quitar"
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            border: "none",
                            background: "transparent",
                            color: "#aaa",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                            padding: 4,
                          }}
                        >
                          ✕
                        </button>
                        <p className="notif-item-msg">{n.mensaje}</p>
                        <p className="notif-item-fecha">
                          {new Date(n.created_at).toLocaleString("es-MX")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              className="panel-avatar"
              onClick={() => setMenuAbierto((v) => !v)}
              title="Opciones de cuenta"
            >
              {nombre.charAt(0).toUpperCase()}
            </button>
            {menuAbierto && (
              <>
                <div className="menu-overlay-click" onClick={() => setMenuAbierto(false)} />
                <div className="avatar-dropdown">
                  <p className="avatar-dropdown-nombre">{nombre}</p>
                  <p className="avatar-dropdown-rol">
                    {rol}
                    {centro ? ` · ${centro}` : ""}
                  </p>
                  <button className="avatar-dropdown-item" onClick={handleLogout}>
                    🚪 Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!centro && !esGlobal ? (
        <div className="rep-content">
          <div className="empty-card">
            <p style={{ fontSize: 40, margin: 0 }}>🏢</p>
            <p style={{ fontWeight: 700, color: "#1a1a1a", margin: "8px 0 4px" }}>
              Tu cuenta no tiene un centro asignado
            </p>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
              Pide a sistemas o superadmin que le pongan un centro a tu perfil para poder ver esta
              información.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="centro-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={"centro-tab" + (tab === t.id ? " active" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="panel-content">
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
            ) : (
              <>
                {/* ---------------- RESUMEN ---------------- */}
            {tab === "resumen" && (
              <>
                {esGlobal ? (
                  cargandoDatosGlobales || cargandoVouchersGlobal ? (
                    <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando resumen de todos los centros...</p>
          </div>
                  ) : (
                    <>
                      {renderBarrasPorCentro(
                        "🖥️ Reportes por centro",
                        centrosDisponibles.map((c) => ({
                          centro: c,
                          valor: datosGlobales[c]?.tickets.length || 0,
                        })),
                        "#185FA5"
                      )}
                      {renderBarrasPorCentro(
                        "🎟️ Vouchers generados por centro",
                        centrosDisponibles.map((c) => ({
                          centro: c,
                          valor: vouchersPorCentro[c]?.vouchers.length || 0,
                        })),
                        "#0F6E56"
                      )}
                    </>
                  )
                ) : (
                  <>
                    <p className="panel-section-label">Ocupación de {centro}</p>
                    <div className="rep-ocupacion-card">
                      <div className="rep-ocupacion-header">
                        <span className="rep-ocupacion-centro">🏢 {centro}</span>
                        <span className="rep-ocupacion-porcentaje">{ocupacion.porcentaje}%</span>
                      </div>
                      <div className="rep-progress-bar">
                        <div
                          className="rep-progress-fill"
                          style={{
                            width: `${ocupacion.porcentaje}%`,
                            background:
                              ocupacion.porcentaje >= 80
                                ? "#A32D2D"
                                : ocupacion.porcentaje >= 50
                                ? "#F07E3A"
                                : "#0F6E56",
                          }}
                        />
                      </div>
                      <div className="rep-ocupacion-detalle">
                        <span>🔴 {ocupacion.ocupadas} ocupadas</span>
                        <span>✅ {ocupacion.disponibles} disponibles</span>
                        <span>📊 {ocupacion.total} total</span>
                      </div>
                    </div>

                    {(() => {
                      const otras = Math.max(ocupacion.total - ocupacion.ocupadas - ocupacion.disponibles, 0);
                      const segmentos = [
                        { label: "Ocupadas", valor: ocupacion.ocupadas, color: "#A32D2D" },
                        { label: "Disponibles", valor: ocupacion.disponibles, color: "#0F6E56" },
                        { label: "Otras", valor: otras, color: "#ccc" },
                      ].filter((s) => s.valor > 0);

                      if (ocupacion.total === 0) return null;

                      const r = 42;
                      const circ = 2 * Math.PI * r;
                      let acumulado = 0;

                      return (
                        <div className="donut-wrap">
                          <svg width={110} height={110} viewBox="0 0 110 110">
                            <g transform="rotate(-90 55 55)">
                              <circle cx={55} cy={55} r={r} fill="none" stroke="#f0f0f0" strokeWidth={16} />
                              {segmentos.map((s) => {
                                const dash = (s.valor / ocupacion.total) * circ;
                                const el = (
                                  <circle
                                    key={s.label}
                                    cx={55}
                                    cy={55}
                                    r={r}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth={16}
                                    strokeDasharray={`${dash} ${circ - dash}`}
                                    strokeDashoffset={-acumulado}
                                  />
                                );
                                acumulado += dash;
                                return el;
                              })}
                            </g>
                            <text x="55" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill="#1a1a1a">
                              {ocupacion.porcentaje}%
                            </text>
                            <text x="55" y="66" textAnchor="middle" fontSize="10" fill="#888">
                              ocupado
                            </text>
                          </svg>
                          <div className="donut-leyenda">
                            {segmentos.map((s) => (
                              <div className="donut-leyenda-item" key={s.label}>
                                <span className="donut-leyenda-dot" style={{ background: s.color }} />
                                {s.label}: <span className="donut-leyenda-num">{s.valor}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <p className="panel-section-label" style={{ margin: 0 }}>
                        Clientes en {centro} ({clientes.length})
                      </p>
                      <button
                        className="btn-exportar"
                        onClick={() =>
                          exportarExcel(
                            `clientes-${centro}`,
                            clientes.map((c) => ({
                              Nombre: c.nombre,
                              Email: c.email,
                              Empresa: c.empresa || "",
                              Oficina: c.numero_oficina || "",
                            }))
                          )
                        }
                      >
                        📥 Excel
                      </button>
                    </div>
                    {clientes.length === 0 ? (
                      <div className="empty-card">Sin clientes registrados en este centro</div>
                    ) : (
                      clientes.map((c) => (
                        <div className="item-card" key={c.id}>
                          <div className="item-card-info">
                            <p className="item-card-titulo">{c.nombre}</p>
                            <p className="item-card-sub">{c.email}</p>
                            {c.numero_oficina && (
                              <p className="item-card-extra">Oficina {c.numero_oficina}</p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}

            {/* ---------------- RESERVACIONES ---------------- */}
            {tab === "reservaciones" && (
              <>
                <button
                  className="btn-enviar"
                  style={{ marginBottom: 12 }}
                  onClick={() => setMostrarCalReservaciones((v) => !v)}
                >
                  {mostrarCalReservaciones ? "Ocultar calendario" : "📅 Ver calendario y reservar"}
                </button>

                {mostrarCalReservaciones && (
                  <div style={{ marginBottom: 20 }}>
                    {calEspaciosDisponibles.length > 1 && (
                      <div className="cal-espacio-tabs">
                        {calEspaciosDisponibles.map((e) => (
                          <button
                            key={e.id}
                            className={"cal-espacio-tab" + (calEspacio === e.id ? " active" : "")}
                            onClick={() => setCalEspacio(e.id)}
                          >
                            {e.icono} {e.id}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="cal-semana-nav">
                      <button onClick={() => setCalInicioSemana(new Date(calInicioSemana.getTime() - 7 * 86400000))}>
                        ‹
                      </button>
                      <span className="cal-semana-label">
                        {calDiasSemana[0].toLocaleDateString("es-MX", { day: "numeric", month: "short" })} –{" "}
                        {calDiasSemana[6].toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                      </span>
                      <button onClick={() => setCalInicioSemana(new Date(calInicioSemana.getTime() + 7 * 86400000))}>
                        ›
                      </button>
                    </div>

                    {calCargando ? (
                      <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando calendario...</p>
          </div>
                    ) : (
                      <div className="cal-grid-wrap">
                        <div className="cal-grid">
                          <div className="cal-head-cell"></div>
                          {calDiasSemana.map((d) => (
                            <div className="cal-head-cell" key={d.toISOString()}>
                              {CAL_DIAS_CORTOS[d.getDay()]}
                              <span className="num">{d.getDate()}</span>
                            </div>
                          ))}

                          {CAL_HORAS.map((h) => (
                            <Fragment key={`cal-row-${h}`}>
                              <div className="cal-hour-cell" key={`cal-h-${h}`}>
                                {h}:00
                              </div>
                              {calDiasSemana.map((d) => {
                                const fechaISO = calFormatFechaISO(d);
                                const ocupado = calEstaOcupado(fechaISO, h);
                                const pasado = calEsPasado(fechaISO, h);
                                const sel =
                                  calSeleccion &&
                                  calSeleccion.fecha === fechaISO &&
                                  h >= calSeleccion.horaInicio &&
                                  h < calSeleccion.horaFin;
                                const reservaAqui = calReservas.find((r) => {
                                  if (r.fecha !== fechaISO || !r.hora_inicio || !r.hora_fin) return false;
                                  const ini = parseInt(r.hora_inicio.split(":")[0]);
                                  return h === ini;
                                });
                                return (
                                  <div
                                    key={`cal-${fechaISO}-${h}`}
                                    className={
                                      "cal-slot" +
                                      (sel ? " seleccionado" : ocupado ? " ocupado" : pasado ? " pasado" : "")
                                    }
                                    title={
                                      reservaAqui
                                        ? reservaAqui.cliente_nombre || "Ocupado"
                                        : ocupado
                                        ? "Ocupado"
                                        : pasado
                                        ? "Ya pasó"
                                        : calFormatHora(h)
                                    }
                                    onClick={() => calClickSlot(fechaISO, h)}
                                  >
                                    {reservaAqui && (
                                      <span
                                        style={{
                                          fontSize: 9,
                                          display: "block",
                                          overflow: "hidden",
                                          whiteSpace: "nowrap",
                                          textOverflow: "ellipsis",
                                          padding: "0 2px",
                                        }}
                                      >
                                        {reservaAqui.cliente_nombre}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="cal-leyenda">
                      <span className="cal-leyenda-item">
                        <span className="cal-leyenda-dot" style={{ background: "#8fe0b3" }} /> Libre
                      </span>
                      <span className="cal-leyenda-item">
                        <span className="cal-leyenda-dot" style={{ background: "#f29494" }} /> Ocupado
                      </span>
                      <span className="cal-leyenda-item">
                        <span className="cal-leyenda-dot" style={{ background: "#f07e3a" }} /> Tu selección
                      </span>
                      <span className="cal-leyenda-item">
                        <span className="cal-leyenda-dot" style={{ background: "#d8d8d8" }} /> Ya pasó
                      </span>
                    </div>

                    {calSeleccion && (
                      <div className="resumen-reserva-card">
                        <p className="resumen-reserva-title">Resumen de reservación</p>
                        <div className="resumen-reserva-row">
                          <span className="resumen-reserva-label">Espacio</span>
                          <span className="resumen-reserva-val">{calEspacio}</span>
                        </div>
                        <div className="resumen-reserva-row">
                          <span className="resumen-reserva-label">Fecha</span>
                          <span className="resumen-reserva-val">{calSeleccion.fecha}</span>
                        </div>
                        <div className="resumen-reserva-row">
                          <span className="resumen-reserva-label">Horario</span>
                          <span className="resumen-reserva-val">
                            {calFormatHora(calSeleccion.horaInicio)} - {calFormatHora(calSeleccion.horaFin)}
                          </span>
                        </div>
                        <div className="nota-info">✓ Se guarda directo como confirmada — no necesita aprobación.</div>
                      </div>
                    )}

                    {calError && <p style={{ color: "#A32D2D", fontSize: 13 }}>{calError}</p>}

                    <button
                      className="reservar-btn"
                      onClick={confirmarReservaAdmin}
                      disabled={!calSeleccion || calGuardando}
                    >
                      {calGuardando ? "Guardando..." : "Reservar este horario"}
                    </button>
                  </div>
                )}

                {reservasPendientes.length > 0 && (
                  <>
                    <p className="sec-label-red">⏳ Pendientes de confirmar ({reservasPendientes.length})</p>
                    {reservasPendientes.map((r) => (
                      <div className="reserva-admin-card" key={r.id}>
                        <div className="reserva-admin-top">
                          <div>
                            <p className="reserva-admin-cliente">{r.cliente_nombre}</p>
                            <p className="reserva-admin-detalle">
                              {r.espacio} · {r.fecha} · {r.hora}
                            </p>
                            {r.paquete_label && <p className="reserva-admin-detalle">{r.paquete_label}</p>}
                            {r.fuera_horario && (
                              <span
                                className="factura-badge"
                                style={{ background: "#FFF3E0", marginTop: 4, display: "inline-block" }}
                              >
                                <span className="factura-badge-text" style={{ color: "#a3701f" }}>
                                  ⚠️ Fuera de horario — cotizar con recepción antes de aceptar
                                </span>
                              </span>
                            )}
                            {!!r.costo_extra && r.costo_extra > 0 && (
                              <span
                                className="factura-badge"
                                style={{ background: "#FCEBEB", marginTop: 4, marginLeft: 6, display: "inline-block" }}
                              >
                                <span className="factura-badge-text" style={{ color: "#a32d2d" }}>
                                  💲 {r.horas_extra}h extra · ${Number(r.costo_extra).toLocaleString("es-MX")}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="reserva-admin-acciones">
                          <button className="btn-aceptar" onClick={() => responderReserva(r, true)}>
                            ✓ Aceptar
                          </button>
                          <button className="btn-rechazar" onClick={() => responderReserva(r, false)}>
                            ✗ Rechazar
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    Todas las reservaciones de {centro} ({reservaciones.length})
                  </p>
                  <button
                    className="btn-exportar"
                    onClick={() =>
                      exportarExcel(
                        `reservaciones-${centro}`,
                        reservaciones.map((r) => ({
                          Cliente: r.cliente_nombre || "",
                          Espacio: r.espacio,
                          Fecha: r.fecha,
                          Horario: r.hora,
                          Estado: r.estado,
                        }))
                      )
                    }
                  >
                    📥 Excel
                  </button>
                </div>
                {reservaciones.length === 0 ? (
                  <div className="empty-card">Sin reservaciones registradas</div>
                ) : (
                  reservaciones
                    .filter((r) => r.estado !== "pendiente")
                    .map((r) => (
                      <div className="item-card" key={r.id}>
                        <div className="item-card-info">
                          <p className="item-card-titulo">{r.cliente_nombre}</p>
                          <p className="item-card-sub">
                            {r.espacio} · {r.fecha} · {r.hora}
                          </p>
                          {r.paquete_label && <p className="item-card-sub">{r.paquete_label}</p>}
                          {r.estado === "cancelada" && motivosCancelacion[r.id] && (
                            <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>
                              ❌ Motivo del cliente: {motivosCancelacion[r.id]}
                            </p>
                          )}
                          {r.estado === "rechazada" && motivosRechazoAdmin[r.id] && (
                            <p style={{ fontSize: 12, color: "#A32D2D", margin: "4px 0 0" }}>
                              ❌ Motivo del rechazo: {motivosRechazoAdmin[r.id]}
                            </p>
                          )}
                        </div>
                        <span
                          className="factura-badge"
                          style={{
                            background:
                              r.estado === "confirmada"
                                ? "#E1F5EE"
                                : r.estado === "rechazada"
                                ? "#FCEBEB"
                                : "#F5F5F5",
                          }}
                        >
                          <span className="factura-badge-text">
                            {r.estado === "confirmada"
                              ? "✓ Confirmada"
                              : r.estado === "rechazada"
                              ? "✗ Rechazada"
                              : "Cancelada"}
                          </span>
                        </span>
                      </div>
                    ))
                )}
              </>
            )}

            {/* ---------------- INVITADOS (solicitudes públicas + Day Pass) ---------------- */}
            {tab === "invitados" && (
              <>
                <p style={{ fontSize: 13, color: "#666", margin: "0 0 4px" }}>
                  Lo que piden personas sin cuenta desde la página "¿No eres cliente aún?" del login.
                </p>
                <button className="btn-enviar" style={{ marginBottom: 12 }} onClick={() => abrirGeneradorDayPass(null)}>
                  🎫 + Nuevo Day Pass
                </button>

                {(() => {
                  const pendientes = solicitudesInvitados.filter((s) => s.estado === "pendiente");
                  const atendidas = solicitudesInvitados.filter((s) => s.estado !== "pendiente");
                  return (
                    <>
                      {pendientes.length > 0 && (
                        <>
                          <p className="sec-label-red">⏳ Pendientes de atender ({pendientes.length})</p>
                          {pendientes.map((s) => (
                            <div className="reserva-admin-card" key={s.id}>
                              <div className="reserva-admin-top">
                                <div>
                                  <p className="reserva-admin-cliente">{s.nombre}</p>
                                  <p className="reserva-admin-detalle">{LABEL_TIPO_SOLICITUD[s.tipo]}</p>
                                  <p className="reserva-admin-detalle">
                                    {s.telefono || "Sin teléfono"} · {s.email || "Sin correo"}
                                  </p>
                                  {s.empresa && <p className="reserva-admin-detalle">Empresa: {s.empresa}</p>}
                                  {s.fecha_deseada && (
                                    <p className="reserva-admin-detalle">
                                      Fecha deseada: {s.fecha_deseada}
                                      {s.hora_inicio_deseada && s.hora_fin_deseada
                                        ? ` · ${s.hora_inicio_deseada} - ${s.hora_fin_deseada}`
                                        : ""}
                                    </p>
                                  )}
                                  {s.notas && <p className="reserva-admin-detalle">📝 {s.notas}</p>}
                                </div>
                              </div>
                              <div className="reserva-admin-acciones">
                                {(s.tipo === "sala_juntas" || s.tipo === "coworking") && (
                                  <button className="btn-aceptar" onClick={() => agendarSolicitud(s)}>
                                    📅 Agendar
                                  </button>
                                )}
                                {s.tipo === "oficina_privada" && (
                                  <button className="btn-aceptar" onClick={() => convertirSolicitudAProspecto(s)}>
                                    📇 Convertir a prospecto
                                  </button>
                                )}
                                {(s.tipo === "day_pass_coworking" || s.tipo === "day_pass_oficina_privada") && (
                                  <button className="btn-aceptar" onClick={() => abrirGeneradorDayPass(s)}>
                                    🎫 Generar Day Pass
                                  </button>
                                )}
                                <button
                                  className="btn-rechazar"
                                  onClick={() => {
                                    setMotivoRechazoInvitado("");
                                    setRechazandoInvitado(s);
                                  }}
                                >
                                  ✗ Rechazar
                                </button>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      <p className="panel-section-label" style={{ marginTop: 8 }}>
                        Historial ({atendidas.length})
                      </p>
                      {atendidas.length === 0 ? (
                        <div className="empty-card">Sin solicitudes atendidas todavía</div>
                      ) : (
                        atendidas.map((s) => (
                          <div className="item-card" key={s.id}>
                            <div className="item-card-info">
                              <p className="item-card-titulo">{s.nombre}</p>
                              <p className="item-card-sub">{LABEL_TIPO_SOLICITUD[s.tipo]}</p>
                            </div>
                            <span
                              className="factura-badge"
                              style={{ background: s.estado === "rechazada" ? "#FCEBEB" : "#E1F5EE" }}
                            >
                              <span className="factura-badge-text">
                                {s.estado === "rechazada" ? "✗ Rechazada" : "✓ Atendida"}
                              </span>
                            </span>
                          </div>
                        ))
                      )}

                      {dayPasses.length > 0 && (
                        <>
                          <p className="panel-section-label" style={{ marginTop: 16 }}>
                            Day Passes emitidos recientemente
                          </p>
                          {dayPasses.map((dp) => (
                            <div className="item-card" key={dp.id}>
                              <div className="item-card-info">
                                <p className="item-card-titulo">
                                  #{String(dp.folio).padStart(3, "0")} · {dp.nombre}
                                </p>
                                <p className="item-card-sub">
                                  {dp.tipo === "coworking" ? "Coworking" : "Oficina privada"} · {dp.fecha} · emitió{" "}
                                  {dp.emitido_por_nombre || "—"}
                                </p>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            {/* ---------------- VOUCHERS ---------------- */}
            {tab === "vouchers" && (
              <>
                <p className="panel-section-label">Duración al generar</p>
                <select
                  className="ticket-admin-select"
                  style={{ width: "100%", padding: "10px 12px", background: "#fff" }}
                  value={duracionVoucher}
                  onChange={(e) => setDuracionVoucher(Number(e.target.value))}
                >
                  <option value={60}>1 hora</option>
                  <option value={480}>8 horas</option>
                  <option value={1440}>1 día</option>
                  <option value={10080}>7 días</option>
                  <option value={43200}>30 días</option>
                  <option value={129600}>90 días</option>
                </select>
                {errorVoucher && (
                  <p style={{ color: "#A32D2D", fontSize: 12 }}>{errorVoucher}</p>
                )}

                {esGlobal ? (
                  cargandoVouchersGlobal ? (
                    <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando vouchers de todos los centros...</p>
          </div>
                  ) : centrosDisponibles.length === 0 ? (
                    <div className="empty-card">Sin centros disponibles</div>
                  ) : (
                    centrosDisponibles.map((c) => {
                      const datos = vouchersPorCentro[c];
                      return (
                        <div key={c} style={{ marginBottom: 16 }}>
                          <p className="panel-section-label" style={{ marginTop: 12 }}>
                            🏢 {c} ({datos?.clientes.length || 0})
                          </p>
                          {c !== "Bosques" && (
                            <p style={{ color: "#aaa", fontSize: 11, fontStyle: "italic", marginBottom: 6 }}>
                              Este centro aún no está conectado al controlador UniFi real — los códigos
                              generados aquí son solo de prueba.
                            </p>
                          )}
                          {renderOficinasConVouchers(datos?.clientes || [], datos?.vouchers || [])}
                        </div>
                      );
                    })
                  )
                ) : (
                  <>
                    {centro !== "Bosques" && (
                      <p style={{ color: "#aaa", fontSize: 11, fontStyle: "italic" }}>
                        Este centro aún no está conectado al controlador UniFi real — los códigos
                        generados aquí son solo de prueba.
                      </p>
                    )}
                    {renderOficinasConVouchers(clientes, vouchers)}
                  </>
                )}
              </>
            )}

            {/* ---------------- TELEFONÍA ---------------- */}
            {tab === "telefonia" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    Extensiones de {centro}
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn-exportar"
                      onClick={() =>
                        exportarExcel(
                          `extensiones-${centro}`,
                          extensiones.map((e) => ({
                            Extension: e.extension,
                            DID: e.did || "",
                            Tipo: e.tipo,
                            Departamento: e.departamento || "",
                            "Asignado a": e.asignado_a || "",
                            Activo: e.activo ? "Sí" : "No",
                          }))
                        )
                      }
                    >
                      📥 Excel
                    </button>
                    {puedeEditarTelefonia && (
                      <a className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} href="/telefonia">
                        + Agregar extensión
                      </a>
                    )}
                  </div>
                </div>
                {extensiones.length === 0 ? (
                  <div className="empty-card">
                    Sin extensiones registradas
                    {!puedeEditarTelefonia && " todavía."}
                  </div>
                ) : (
                  <table className="tel-tabla" style={{ background: "#fff", borderRadius: 12 }}>
                    <thead>
                      <tr>
                        <th>Ext.</th>
                        <th>DID</th>
                        <th>Tipo</th>
                        <th>Departamento</th>
                        <th>Asignado a</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extensiones.map((ext) => (
                        <tr key={ext.id} className={ext.activo ? "" : "tel-inactivo"}>
                          <td>
                            <span className="tel-ext-badge">{ext.extension}</span>
                          </td>
                          <td>{ext.did || "—"}</td>
                          <td>{ext.tipo === "did" ? "DID" : "Interna"}</td>
                          <td>{ext.departamento || "—"}</td>
                          <td>{ext.asignado_a || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {/* ---------------- INTERNET ---------------- */}
            {tab === "internet" && (
              <>
                {esGlobal ? (
                  cargandoDatosGlobales ? (
                    <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando internet de todos los centros...</p>
          </div>
                  ) : (
                    centrosDisponibles.map((c) => {
                      const net = datosGlobales[c]?.internet || null;
                      const editando = editandoInternetCentro === c;
                      return (
                        <div key={c} className="rep-ocupacion-card" style={{ marginBottom: 12 }}>
                          {editando ? (
                            <>
                              <div className="tel-form-grid">
                                <input
                                  placeholder="Proveedor principal (ej. Alestra)"
                                  value={formInternet.proveedor_principal || ""}
                                  onChange={(e) =>
                                    setFormInternet({ ...formInternet, proveedor_principal: e.target.value })
                                  }
                                />
                                <input
                                  placeholder="Velocidad principal (ej. 500 Mb)"
                                  value={formInternet.velocidad_principal || ""}
                                  onChange={(e) =>
                                    setFormInternet({ ...formInternet, velocidad_principal: e.target.value })
                                  }
                                />
                                <input
                                  placeholder="Proveedor de respaldo (ej. Telmex)"
                                  value={formInternet.proveedor_respaldo || ""}
                                  onChange={(e) =>
                                    setFormInternet({ ...formInternet, proveedor_respaldo: e.target.value })
                                  }
                                />
                                <input
                                  placeholder="Velocidad de respaldo (ej. 100 Mb)"
                                  value={formInternet.velocidad_respaldo || ""}
                                  onChange={(e) =>
                                    setFormInternet({ ...formInternet, velocidad_respaldo: e.target.value })
                                  }
                                />
                              </div>
                              <input
                                type="text"
                                placeholder="Notas"
                                value={formInternet.notas || ""}
                                onChange={(e) => setFormInternet({ ...formInternet, notas: e.target.value })}
                                style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginTop: 8, width: "100%" }}
                              />
                              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                <button className="btn-enviar" onClick={() => guardarInternetGlobal(c)}>
                                  Guardar
                                </button>
                                <button
                                  className="tel-borrar-btn"
                                  style={{ color: "#888" }}
                                  onClick={() => setEditandoInternetCentro(null)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="rep-ocupacion-header">
                                <span className="rep-ocupacion-centro">🌐 {c}</span>
                                {puedeEditarInternet && (
                                  <button
                                    className="tel-borrar-btn"
                                    style={{ color: "#0d1b3e", fontWeight: 600 }}
                                    onClick={() => {
                                      setFormInternet(
                                        net || {
                                          proveedor_principal: "",
                                          velocidad_principal: "",
                                          proveedor_respaldo: "",
                                          velocidad_respaldo: "",
                                          notas: "",
                                        }
                                      );
                                      setEditandoInternetCentro(c);
                                    }}
                                  >
                                    {net ? "Editar" : "+ Agregar"}
                                  </button>
                                )}
                              </div>
                              {net ? (
                                <div className="rep-ocupacion-detalle" style={{ flexWrap: "wrap", gap: 10 }}>
                                  <span>
                                    🟢 Principal: <b>{net.proveedor_principal || "—"}</b>{" "}
                                    {net.velocidad_principal ? `(${net.velocidad_principal})` : ""}
                                  </span>
                                  <span>
                                    🟠 Respaldo: <b>{net.proveedor_respaldo || "—"}</b>{" "}
                                    {net.velocidad_respaldo ? `(${net.velocidad_respaldo})` : ""}
                                  </span>
                                  {net.notas && <span>📝 {net.notas}</span>}
                                </div>
                              ) : (
                                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Sin información capturada</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  )
                ) : (
                  <>
                    <p className="panel-section-label">Internet de {centro}</p>
                    <div className="rep-ocupacion-card">
                      {editandoInternet ? (
                        <>
                          <div className="tel-form-grid">
                            <input
                              placeholder="Proveedor principal (ej. Alestra)"
                              value={formInternet.proveedor_principal || ""}
                              onChange={(e) =>
                                setFormInternet({ ...formInternet, proveedor_principal: e.target.value })
                              }
                            />
                            <input
                              placeholder="Velocidad principal (ej. 500 Mb)"
                              value={formInternet.velocidad_principal || ""}
                              onChange={(e) =>
                                setFormInternet({ ...formInternet, velocidad_principal: e.target.value })
                              }
                            />
                            <input
                              placeholder="Proveedor de respaldo (ej. Telmex)"
                              value={formInternet.proveedor_respaldo || ""}
                              onChange={(e) =>
                                setFormInternet({ ...formInternet, proveedor_respaldo: e.target.value })
                              }
                            />
                            <input
                              placeholder="Velocidad de respaldo (ej. 100 Mb)"
                              value={formInternet.velocidad_respaldo || ""}
                              onChange={(e) =>
                                setFormInternet({ ...formInternet, velocidad_respaldo: e.target.value })
                              }
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="Notas"
                            value={formInternet.notas || ""}
                            onChange={(e) => setFormInternet({ ...formInternet, notas: e.target.value })}
                            style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginTop: 8, width: "100%" }}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button className="btn-enviar" onClick={guardarInternet}>
                              Guardar
                            </button>
                            <button className="tel-borrar-btn" style={{ color: "#888" }} onClick={() => setEditandoInternet(false)}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rep-ocupacion-header">
                            <span className="rep-ocupacion-centro">🌐 {centro}</span>
                            {puedeEditarInternet && (
                              <button
                                className="tel-borrar-btn"
                                style={{ color: "#0d1b3e", fontWeight: 600 }}
                                onClick={() => setEditandoInternet(true)}
                              >
                                {internet ? "Editar" : "+ Agregar"}
                              </button>
                            )}
                          </div>
                          {internet ? (
                            <div className="rep-ocupacion-detalle" style={{ flexWrap: "wrap", gap: 10 }}>
                              <span>
                                🟢 Principal: <b>{internet.proveedor_principal || "—"}</b>{" "}
                                {internet.velocidad_principal ? `(${internet.velocidad_principal})` : ""}
                              </span>
                              <span>
                                🟠 Respaldo: <b>{internet.proveedor_respaldo || "—"}</b>{" "}
                                {internet.velocidad_respaldo ? `(${internet.velocidad_respaldo})` : ""}
                              </span>
                              {internet.notas && <span>📝 {internet.notas}</span>}
                            </div>
                          ) : (
                            <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Sin información capturada</p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ---------------- PROVEEDORES ---------------- */}
            {tab === "proveedores" && (
              <>
                <p className="panel-section-label">Registrar proveedor</p>
                <form className="form-card" onSubmit={agregarProveedor}>
                  {esGlobal && (
                    <select
                      value={formProveedorCentro}
                      onChange={(e) => setFormProveedorCentro(e.target.value)}
                    >
                      {centrosDisponibles.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="tel-form-grid">
                    <input
                      placeholder="Nombre del proveedor"
                      value={formProveedor.nombre}
                      onChange={(e) => setFormProveedor({ ...formProveedor, nombre: e.target.value })}
                    />
                    <input
                      placeholder="Categoría (ej. Internet, Limpieza)"
                      value={formProveedor.categoria}
                      onChange={(e) => setFormProveedor({ ...formProveedor, categoria: e.target.value })}
                    />
                    <input
                      placeholder="Persona de contacto"
                      value={formProveedor.contacto}
                      onChange={(e) => setFormProveedor({ ...formProveedor, contacto: e.target.value })}
                    />
                    <input
                      placeholder="Teléfono"
                      value={formProveedor.telefono}
                      onChange={(e) => setFormProveedor({ ...formProveedor, telefono: e.target.value })}
                    />
                    <input
                      placeholder="Correo"
                      value={formProveedor.email}
                      onChange={(e) => setFormProveedor({ ...formProveedor, email: e.target.value })}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Notas"
                    value={formProveedor.notas}
                    onChange={(e) => setFormProveedor({ ...formProveedor, notas: e.target.value })}
                  />
                  {errorProveedor && (
                    <p style={{ color: "#A32D2D", fontSize: 12 }}>{errorProveedor}</p>
                  )}
                  <button className="btn-enviar" type="submit">
                    + Agregar proveedor
                  </button>
                </form>

                {esGlobal ? (
                  cargandoDatosGlobales ? (
                    <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando proveedores de todos los centros...</p>
          </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                        <button
                          className="btn-exportar"
                          onClick={() => {
                            const porCentroExport: Record<string, Record<string, any>[]> = {};
                            centrosDisponibles.forEach((c) => {
                              porCentroExport[c] = filtrarProveedoresPorRol(datosGlobales[c]?.proveedores || []).map((p) => ({
                                Departamento: p.tipo === "sistemas" ? "Sistemas" : p.tipo === "operaciones" ? "Operaciones" : "Admin",
                                Nombre: p.nombre,
                                Categoria: p.categoria || "",
                                Contacto: p.contacto || "",
                                Telefono: p.telefono || "",
                                Email: p.email || "",
                                Notas: p.notas || "",
                              }));
                            });
                            exportarExcelPorCentro("proveedores", porCentroExport);
                          }}
                        >
                          📥 Excel (todos los centros)
                        </button>
                      </div>
                      {centrosDisponibles.map((c) => {
                        const provs = filtrarProveedoresPorRol(datosGlobales[c]?.proveedores || []);
                        return (
                          <div key={c} style={{ marginBottom: 16 }}>
                            <p className="panel-section-label" style={{ marginTop: 12 }}>
                              🏢 {c} ({provs.length})
                            </p>
                            {provs.length === 0 ? (
                            <div className="empty-card">Sin proveedores registrados</div>
                          ) : (
                            provs.map((p) => (
                              <div className="item-card" key={p.id}>
                                <div className="item-card-info">
                                  <p className="item-card-titulo">{p.nombre}</p>
                                  <p className="item-card-sub">
                                    {(rol === "superadmin" || rol === "gerente") && (
                                      <>{p.tipo === "sistemas" ? "🖥️ Sistemas" : p.tipo === "operaciones" ? "🔧 Operaciones" : "🧑‍💼 Admin"} · </>
                                    )}
                                    {p.categoria || "—"} {p.contacto ? `· ${p.contacto}` : ""}
                                  </p>
                                  <p className="item-card-extra">
                                    {p.telefono || ""} {p.email ? `· ${p.email}` : ""}
                                  </p>
                                </div>
                                <button className="tel-borrar-btn" onClick={() => borrarProveedor(p.id, c)}>
                                  🗑
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                    </>
                  )
                ) : (
                  <>
                    <div className="rowBetween" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <p className="panel-section-label" style={{ margin: 0 }}>
                        Proveedores de {centro} ({filtrarProveedoresPorRol(proveedores).length})
                      </p>
                      <button
                        className="btn-exportar"
                        onClick={() =>
                          exportarExcel(
                            `proveedores-${centro}`,
                            filtrarProveedoresPorRol(proveedores).map((p) => ({
                              Nombre: p.nombre,
                              Categoria: p.categoria || "",
                              Contacto: p.contacto || "",
                              Telefono: p.telefono || "",
                              Email: p.email || "",
                              Notas: p.notas || "",
                            }))
                          )
                        }
                      >
                        📥 Excel
                      </button>
                    </div>
                    {filtrarProveedoresPorRol(proveedores).length === 0 ? (
                      <div className="empty-card">Sin proveedores registrados</div>
                    ) : (
                      filtrarProveedoresPorRol(proveedores).map((p) => (
                        <div className="item-card" key={p.id}>
                          <div className="item-card-info">
                            <p className="item-card-titulo">{p.nombre}</p>
                            <p className="item-card-sub">
                              {p.categoria || "—"} {p.contacto ? `· ${p.contacto}` : ""}
                            </p>
                            <p className="item-card-extra">
                              {p.telefono || ""} {p.email ? `· ${p.email}` : ""}
                            </p>
                          </div>
                          <button className="tel-borrar-btn" onClick={() => borrarProveedor(p.id)}>
                            🗑
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}

            {/* ---------------- GASTOS ---------------- */}
            {tab === "gastos" && (
              <>
                {esGlobal ? (
                  <>
                    {rol !== "sistemas" && (
                      <>
                        <p className="panel-section-label">
                          {rol === "operaciones" ? "Gastos de operaciones por centro" : "Gastos operativos por centro"}
                        </p>
                        <div className="tickets-filtros">
                          {centrosDisponibles.map((c) => (
                            <button
                              key={c}
                          className={"filtro-chip" + (centroGastosActivo === c ? " active" : "")}
                          onClick={() => setCentroGastosActivo(c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>

                    {rol === "operaciones" && (
                      <form className="form-card" onSubmit={agregarGasto} style={{ marginTop: 8 }}>
                        <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                          Se registra en <b>{centroGastosActivo}</b> (el centro que tengas seleccionado arriba)
                        </p>
                        <div className="tel-form-grid">
                          <input
                            placeholder="Concepto"
                            value={formGasto.concepto}
                            onChange={(e) => setFormGasto({ ...formGasto, concepto: e.target.value })}
                          />
                          <input
                            placeholder="Categoría (ej. Mantenimiento, Limpieza)"
                            value={formGasto.categoria}
                            onChange={(e) => setFormGasto({ ...formGasto, categoria: e.target.value })}
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Monto"
                            value={formGasto.monto}
                            onChange={(e) => setFormGasto({ ...formGasto, monto: e.target.value })}
                          />
                          <input
                            type="date"
                            value={formGasto.fecha}
                            onChange={(e) => setFormGasto({ ...formGasto, fecha: e.target.value })}
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Notas"
                          value={formGasto.notas}
                          onChange={(e) => setFormGasto({ ...formGasto, notas: e.target.value })}
                        />
                        <select value={gastoProveedorId} onChange={(e) => setGastoProveedorId(e.target.value)}>
                          <option value="">Sin proveedor (opcional)</option>
                          {filtrarProveedoresPorRol(datosGlobales[centroGastosActivo]?.proveedores || []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nombre}
                            </option>
                          ))}
                        </select>
                        <p className="sub-label">Factura</p>
                        <FileDropzone files={gastoFactura} onChange={setGastoFactura} maxFiles={1} accept="image/*,.pdf" />
                        <p className="sub-label">Comprobante de pago</p>
                        <FileDropzone files={gastoComprobante} onChange={setGastoComprobante} maxFiles={1} accept="image/*,.pdf" />
                        <button className="btn-enviar" type="submit">
                          + Agregar gasto
                        </button>
                      </form>
                    )}

                    {cargandoDatosGlobales ? (
                      <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando gastos...</p>
          </div>
                    ) : (
                      (() => {
                        const listaCentro = (datosGlobales[centroGastosActivo]?.gastos || []).filter(
                          (g) => rol !== "operaciones" || g.tipo === "operaciones"
                        );
                        const totalAnio = listaCentro
                          .filter((g) => new Date(g.fecha).getFullYear() === anioGastosCentro)
                          .reduce((s, g) => s + Number(g.monto), 0);
                        return (
                          <>
                            <div className="gastos-total-card">
                              <p className="gastos-total-monto">
                                ${totalAnio.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                              </p>
                              <p className="gastos-total-lbl">
                                Total en {centroGastosActivo} · {anioGastosCentro}
                              </p>
                            </div>

                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                              <select
                                className="ticket-admin-select"
                                value={anioGastosCentro}
                                onChange={(e) => setAnioGastosCentro(Number(e.target.value))}
                              >
                                {aniosConDatos(listaCentro).map((a) => (
                                  <option key={a} value={a}>
                                    {a}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {renderBarrasPorCentro(
                              `💸 Gastos por mes · ${centroGastosActivo} (${anioGastosCentro})`,
                              gastosPorMes(listaCentro, anioGastosCentro),
                              "#F07E3A"
                            )}
                            {renderBarrasPorCentro(
                              `📅 Comparativo anual · ${centroGastosActivo}`,
                              gastosPorAnio(listaCentro),
                              "#185FA5"
                            )}

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                              <p className="panel-section-label" style={{ margin: 0 }}>
                                Historial en {centroGastosActivo} ({listaCentro.length})
                              </p>
                              <button
                                className="btn-exportar"
                                onClick={() =>
                                  exportarExcel(
                                    `gastos-${centroGastosActivo}`,
                                    listaCentro.map((g) => ({
                                      Departamento: g.tipo === "admin" ? "Admin" : g.tipo === "operaciones" ? "Operaciones" : g.tipo || "",
                                      Concepto: g.concepto,
                                      Categoria: g.categoria || "",
                                      Monto: g.monto,
                                      Fecha: g.fecha,
                                    }))
                                  )
                                }
                              >
                                📥 Excel
                              </button>
                            </div>
                            {listaCentro.length === 0 ? (
                              <div className="empty-card">Sin gastos registrados en este centro</div>
                            ) : (
                              listaCentro.map((g) => (
                                <div className="item-card" key={g.id}>
                                  <div className="item-card-info">
                                    <p className="item-card-titulo">{g.concepto}</p>
                                    <p className="item-card-sub">
                                      {(rol === "superadmin" || rol === "gerente") && (
                                        <>{g.tipo === "admin" ? "🧑‍💼 Admin" : "🔧 Operaciones"} · </>
                                      )}
                                      {g.categoria || "—"} · {new Date(g.fecha).toLocaleDateString("es-MX")}
                                    </p>
                                    {g.notas && <p className="item-card-extra">{g.notas}</p>}
                                    {(g.factura_url || g.comprobante_pago_url) && (
                                      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                        {g.factura_url && (
                                          <a href={g.factura_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                            📎 Factura
                                          </a>
                                        )}
                                        {g.comprobante_pago_url && (
                                          <a href={g.comprobante_pago_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                            🧾 Comprobante de pago
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <p className="item-card-monto">
                                      ${Number(g.monto).toLocaleString("es-MX")}
                                    </p>
                                    {rol === "operaciones" && (
                                      <button
                                        className="tel-borrar-btn"
                                        onClick={() => borrarGasto(g.id, centroGastosActivo)}
                                      >
                                        🗑
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </>
                        );
                      })()
                    )}
                  </>
                )}

                {(rol === "sistemas" || (rol === "superadmin" || rol === "gerente")) && (
                  <>
                    <p className="panel-section-label" style={{ marginTop: 24 }}>
                      🖥️ Gastos de sistemas (todos los centros)
                    </p>
                    <div className="gastos-total-card">
                      <p className="gastos-total-monto">
                        $
                        {gastosSistemas
                          .reduce((s, g) => s + Number(g.monto), 0)
                          .toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="gastos-total-lbl">Total de gastos de sistemas (todos los centros)</p>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <select
                        className="ticket-admin-select"
                        value={anioGastosSistemas}
                        onChange={(e) => setAnioGastosSistemas(Number(e.target.value))}
                      >
                        {aniosConDatos(gastosSistemas).map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    {renderBarrasPorCentro(
                      `🖥️ Gastos de sistemas por mes (${anioGastosSistemas})`,
                      gastosPorMes(gastosSistemas, anioGastosSistemas),
                      "#0F6E56"
                    )}

                    <p className="panel-section-label" style={{ marginTop: 8 }}>
                      Registrar gasto de sistemas
                    </p>
                    <form className="form-card" onSubmit={agregarGasto}>
                      <p className="sub-label">Centro al que pertenece este gasto</p>
                      <select value={formGastoCentro} onChange={(e) => setFormGastoCentro(e.target.value)}>
                        <option value="">Selecciona un centro</option>
                        {centrosDisponibles.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <div className="tel-form-grid">
                        <input
                          placeholder="Concepto"
                          value={formGasto.concepto}
                          onChange={(e) => setFormGasto({ ...formGasto, concepto: e.target.value })}
                        />
                        <input
                          placeholder="Categoría (ej. Equipo, Licencias)"
                          value={formGasto.categoria}
                          onChange={(e) => setFormGasto({ ...formGasto, categoria: e.target.value })}
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Monto"
                          value={formGasto.monto}
                          onChange={(e) => setFormGasto({ ...formGasto, monto: e.target.value })}
                        />
                        <input
                          type="date"
                          value={formGasto.fecha}
                          onChange={(e) => setFormGasto({ ...formGasto, fecha: e.target.value })}
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Notas"
                        value={formGasto.notas}
                        onChange={(e) => setFormGasto({ ...formGasto, notas: e.target.value })}
                      />
                      <select value={gastoProveedorId} onChange={(e) => setGastoProveedorId(e.target.value)}>
                        <option value="">Sin proveedor (opcional)</option>
                        {filtrarProveedoresPorRol(datosGlobales[formGastoCentro]?.proveedores || []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                      <p className="sub-label">Factura</p>
                      <FileDropzone files={gastoFactura} onChange={setGastoFactura} maxFiles={1} accept="image/*,.pdf" />
                      <p className="sub-label">Comprobante de pago</p>
                      <FileDropzone files={gastoComprobante} onChange={setGastoComprobante} maxFiles={1} accept="image/*,.pdf" />
                      <button className="btn-enviar" type="submit">
                        + Agregar gasto
                      </button>
                    </form>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <p className="panel-section-label" style={{ margin: 0 }}>
                        Historial ({gastosSistemas.length})
                      </p>
                      <button
                        className="btn-exportar"
                        onClick={() => {
                          const porCentroExport: Record<string, Record<string, any>[]> = {};
                          gastosSistemas.forEach((g) => {
                            const key = g.centro || "Sin centro";
                            if (!porCentroExport[key]) porCentroExport[key] = [];
                            porCentroExport[key].push({
                              Concepto: g.concepto,
                              Categoria: g.categoria || "",
                              Monto: g.monto,
                              Fecha: g.fecha,
                            });
                          });
                          exportarExcelPorCentro("gastos-sistemas", porCentroExport);
                        }}
                      >
                        📥 Excel
                      </button>
                    </div>
                    {gastosSistemas.length === 0 ? (
                      <div className="empty-card">Sin gastos de sistemas registrados</div>
                    ) : (
                      gastosSistemas.map((g) => (
                        <div className="item-card" key={g.id}>
                          <div className="item-card-info">
                            <p className="item-card-titulo">{g.concepto}</p>
                            <p className="item-card-sub">
                              🏢 {g.centro} · {g.categoria || "—"} ·{" "}
                              {new Date(g.fecha).toLocaleDateString("es-MX")}
                            </p>
                            {g.notas && <p className="item-card-extra">{g.notas}</p>}
                            {(g.factura_url || g.comprobante_pago_url) && (
                              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                {g.factura_url && (
                                  <a href={g.factura_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                    📎 Factura
                                  </a>
                                )}
                                {g.comprobante_pago_url && (
                                  <a href={g.comprobante_pago_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                    🧾 Comprobante de pago
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <p className="item-card-monto">
                              ${Number(g.monto).toLocaleString("es-MX")}
                            </p>
                            <button className="tel-borrar-btn" onClick={() => borrarGasto(g.id)}>
                              🗑
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
                  </>
                ) : (
                  <>
                    <div className="gastos-total-card">
                      <p className="gastos-total-monto">
                        ${totalGastos.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="gastos-total-lbl">Total registrado en {centro}</p>
                    </div>

                    <p className="panel-section-label" style={{ marginTop: 8 }}>
                      Registrar gasto
                    </p>
                    <form className="form-card" onSubmit={agregarGasto}>
                      <div className="tel-form-grid">
                        <input
                          placeholder="Concepto"
                          value={formGasto.concepto}
                          onChange={(e) => setFormGasto({ ...formGasto, concepto: e.target.value })}
                        />
                        <input
                          placeholder="Categoría (ej. Renta, Servicios)"
                          value={formGasto.categoria}
                          onChange={(e) => setFormGasto({ ...formGasto, categoria: e.target.value })}
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Monto"
                          value={formGasto.monto}
                          onChange={(e) => setFormGasto({ ...formGasto, monto: e.target.value })}
                        />
                        <input
                          type="date"
                          value={formGasto.fecha}
                          onChange={(e) => setFormGasto({ ...formGasto, fecha: e.target.value })}
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Notas"
                        value={formGasto.notas}
                        onChange={(e) => setFormGasto({ ...formGasto, notas: e.target.value })}
                      />
                      <select value={gastoProveedorId} onChange={(e) => setGastoProveedorId(e.target.value)}>
                        <option value="">Sin proveedor (opcional)</option>
                        {filtrarProveedoresPorRol(proveedores).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                      <p className="sub-label">Factura</p>
                      <FileDropzone files={gastoFactura} onChange={setGastoFactura} maxFiles={1} accept="image/*,.pdf" />
                      <p className="sub-label">Comprobante de pago</p>
                      <FileDropzone files={gastoComprobante} onChange={setGastoComprobante} maxFiles={1} accept="image/*,.pdf" />
                      <button className="btn-enviar" type="submit">
                        + Agregar gasto
                      </button>
                    </form>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <p className="panel-section-label" style={{ margin: 0 }}>
                        Historial ({gastos.length})
                      </p>
                      <button
                        className="btn-exportar"
                        onClick={() =>
                          exportarExcel(
                            `gastos-${centro}`,
                            gastos.map((g) => ({
                              Concepto: g.concepto,
                              Categoria: g.categoria || "",
                              Monto: g.monto,
                              Fecha: g.fecha,
                            }))
                          )
                        }
                      >
                        📥 Excel
                      </button>
                    </div>
                    {gastos.length === 0 ? (
                      <div className="empty-card">Sin gastos registrados</div>
                    ) : (
                      gastos.map((g) => (
                        <div className="item-card" key={g.id}>
                          <div className="item-card-info">
                            <p className="item-card-titulo">{g.concepto}</p>
                            <p className="item-card-sub">
                              {g.categoria || "—"} · {new Date(g.fecha).toLocaleDateString("es-MX")}
                            </p>
                            {g.notas && <p className="item-card-extra">{g.notas}</p>}
                            {(g.factura_url || g.comprobante_pago_url) && (
                              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                {g.factura_url && (
                                  <a href={g.factura_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                    📎 Factura
                                  </a>
                                )}
                                {g.comprobante_pago_url && (
                                  <a href={g.comprobante_pago_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#185FA5" }}>
                                    🧾 Comprobante de pago
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <p className="item-card-monto">
                              ${Number(g.monto).toLocaleString("es-MX")}
                            </p>
                            <button className="tel-borrar-btn" onClick={() => borrarGasto(g.id)}>
                              🗑
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}

            {/* ---------------- PROSPECTOS ---------------- */}
            {tab === "prospectos" && (
              <>
                <p className="panel-section-label">Registrar prospecto</p>
                <form className="form-card" onSubmit={agregarProspecto}>
                  <div className="tel-form-grid">
                    <input
                      placeholder="Nombre"
                      value={formProspecto.nombre}
                      onChange={(e) => setFormProspecto({ ...formProspecto, nombre: e.target.value })}
                    />
                    <input
                      placeholder="Teléfono"
                      value={formProspecto.telefono}
                      onChange={(e) => setFormProspecto({ ...formProspecto, telefono: e.target.value })}
                    />
                    <input
                      placeholder="Correo"
                      value={formProspecto.email}
                      onChange={(e) => setFormProspecto({ ...formProspecto, email: e.target.value })}
                    />
                    <input
                      placeholder="Interés (ej. oficina 2 personas)"
                      value={formProspecto.interes}
                      onChange={(e) => setFormProspecto({ ...formProspecto, interes: e.target.value })}
                    />
                    <input
                      placeholder="Empresa"
                      value={formProspecto.empresa}
                      onChange={(e) => setFormProspecto({ ...formProspecto, empresa: e.target.value })}
                    />
                    <input
                      placeholder="RFC"
                      value={formProspecto.rfc}
                      onChange={(e) => setFormProspecto({ ...formProspecto, rfc: e.target.value })}
                    />
                    <select
                      value={formProspecto.medio}
                      onChange={(e) => setFormProspecto({ ...formProspecto, medio: e.target.value })}
                    >
                      <option value="" hidden>
                        Medio de contacto
                      </option>
                      {MEDIOS_PROSPECTO.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      value={formProspecto.centroInteres}
                      onChange={(e) => setFormProspecto({ ...formProspecto, centroInteres: e.target.value })}
                    >
                      <option value="">Centro de interés</option>
                      {centrosDisponibles.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    placeholder="Notas"
                    value={formProspecto.notas}
                    onChange={(e) => setFormProspecto({ ...formProspecto, notas: e.target.value })}
                  />
                  <button className="btn-enviar" type="submit">
                    + Agregar prospecto
                  </button>
                </form>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    Todos los prospectos ({prospectos.length})
                  </p>
                  <button
                    className="btn-exportar"
                    onClick={() =>
                      exportarExcel(
                        "prospectos",
                        prospectos.map((p) => ({
                          Nombre: p.nombre,
                          Telefono: p.telefono || "",
                          Email: p.email || "",
                          Empresa: p.empresa || "",
                          RFC: p.rfc || "",
                          DiaPago: p.dia_pago ?? "",
                          Interes: p.interes || "",
                          Medio: p.medio || "",
                          Centro: p.centro || "",
                          Estado: p.estado,
                          "Motivo perdido": p.comentario_perdido || "",
                          Notas: p.notas || "",
                        }))
                      )
                    }
                  >
                    📥 Excel
                  </button>
                </div>
                {prospectos.length === 0 ? (
                  <div className="empty-card">Sin prospectos registrados</div>
                ) : (
                  (() => {
                    const meses = [
                      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
                    ];
                    const porMes: Record<string, Prospecto[]> = {};
                    prospectos.forEach((p) => {
                      const d = new Date(p.created_at);
                      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                      if (!porMes[key]) porMes[key] = [];
                      porMes[key].push(p);
                    });
                    const mesesOrdenados = Object.keys(porMes).sort().reverse();

                    return mesesOrdenados.map((mesKey) => {
                      const [anio, mesNum] = mesKey.split("-");
                      const lista = [...porMes[mesKey]].sort((a, b) => {
                        const interesCmp = (a.interes || "").localeCompare(b.interes || "");
                        if (interesCmp !== 0) return interesCmp;
                        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                      });
                      return (
                        <div key={mesKey}>
                          <p className="panel-section-label" style={{ marginTop: 12 }}>
                            📅 {meses[Number(mesNum) - 1]} {anio} ({lista.length})
                          </p>
                          {lista.map((p) => {
                            const est = ESTADOS_PROSPECTO[p.estado] || ESTADOS_PROSPECTO.nuevo;
                            return (
                              <div className="item-card" key={p.id} style={{ marginBottom: 8 }}>
                                <div className="item-card-info">
                                  <p className="item-card-titulo">{p.nombre}</p>
                                  <p className="item-card-sub">
                                    {p.telefono || ""} {p.email ? `· ${p.email}` : ""}
                                  </p>
                                  <p className="item-card-extra">
                                    🏢 {p.centro || "—"} {p.medio ? `· 📞 ${p.medio}` : ""}
                                  </p>
                                  {p.empresa && <p className="item-card-extra">🏬 {p.empresa}</p>}
                                  {p.interes && <p className="item-card-extra">Interés: {p.interes}</p>}
                                  {p.estado === "perdido" && p.comentario_perdido && (
                                    <p className="item-card-extra" style={{ color: "#A32D2D" }}>
                                      ❌ {p.comentario_perdido}
                                    </p>
                                  )}
                                  <p className="item-card-extra" style={{ color: "#aaa" }}>
                                    {new Date(p.created_at).toLocaleDateString("es-MX")}
                                  </p>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                                  <select
                                    className="estado-select-prospecto"
                                    style={{ background: est.bg, color: est.color }}
                                    value={p.estado}
                                    onChange={(e) => cambiarEstadoProspecto(p.id, e.target.value)}
                                  >
                                    {Object.entries(ESTADOS_PROSPECTO)
                                      .filter(([k]) => k !== "convertido")
                                      .map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v.label}
                                        </option>
                                      ))}
                                  </select>
                                  <a
                                    className="tel-borrar-btn"
                                    style={{ color: "#0d1b3e", fontWeight: 600 }}
                                    href={`/registrar-plan?centro=${encodeURIComponent(centro)}&prospectoNombre=${encodeURIComponent(
                                      p.nombre
                                    )}&prospectoTelefono=${encodeURIComponent(p.telefono || "")}&prospectoEmail=${encodeURIComponent(
                                      p.email || ""
                                    )}&prospectoInteres=${encodeURIComponent(p.interes || "")}`}
                                  >
                                    🧾 Cotizar
                                  </a>
                                  <a
                                    className="tel-borrar-btn"
                                    style={{ color: "#0d1b3e", fontWeight: 600 }}
                                    href={`/alta-cliente?nombre=${encodeURIComponent(p.nombre)}&email=${encodeURIComponent(
                                      p.email || ""
                                    )}&telefono=${encodeURIComponent(p.telefono || "")}&empresa=${encodeURIComponent(
                                      p.empresa || ""
                                    )}&rfc=${encodeURIComponent(p.rfc || "")}&diaPago=${encodeURIComponent(
                                      p.dia_pago != null ? String(p.dia_pago) : ""
                                    )}&prospectoId=${encodeURIComponent(p.id)}`}
                                  >
                                    👤 Nuevo cliente
                                  </a>
                                  <button className="tel-borrar-btn" onClick={() => borrarProspecto(p.id)}>
                                    🗑
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()
                )}
              </>
            )}
          </>
        )}
          </div>
        </>
      )}

      {rechazando && (
        <div className="modal-overlay" onClick={() => setRechazando(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Rechazar reservación</p>
            <p className="modal-email">
              {rechazando.espacio} · {rechazando.fecha} · {rechazando.hora}
            </p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              Motivo (opcional, el cliente lo verá)
            </p>
            <textarea
              placeholder="Ej. Mantenimiento programado de 8am a 8pm ese día"
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setRechazando(null)}>
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarRechazo}>
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {rechazandoInvitado && (
        <div className="modal-overlay" onClick={() => setRechazandoInvitado(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Rechazar solicitud</p>
            <p className="modal-email">
              {rechazandoInvitado.nombre} · {LABEL_TIPO_SOLICITUD[rechazandoInvitado.tipo]}
            </p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              Motivo (opcional, solo para uso interno)
            </p>
            <textarea
              placeholder="Ej. No contestó, ya no le interesa, etc."
              value={motivoRechazoInvitado}
              onChange={(e) => setMotivoRechazoInvitado(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setRechazandoInvitado(null)}>
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarRechazoInvitado}>
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarGeneradorDayPass && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!generandoDayPass) setMostrarGeneradorDayPass(false);
          }}
        >
          <div className="daypass-modal-card" onClick={(e) => e.stopPropagation()}>
            {!dayPassGenerado ? (
              <>
                <p className="modal-nombre">🎫 Generar Day Pass</p>
                <p className="sub-label">Tipo</p>
                <select
                  value={dayPassForm.tipo}
                  onChange={(e) => setDayPassForm({ ...dayPassForm, tipo: e.target.value as "coworking" | "oficina_privada" })}
                >
                  <option value="coworking">Coworking</option>
                  <option value="oficina_privada">Oficina privada</option>
                </select>
                <p className="sub-label">Nombre de quien lo va a usar</p>
                <input
                  value={dayPassForm.nombre}
                  onChange={(e) => setDayPassForm({ ...dayPassForm, nombre: e.target.value })}
                  placeholder="Nombre completo"
                />
                <p className="sub-label">Teléfono</p>
                <input
                  type="tel"
                  value={dayPassForm.telefono}
                  onChange={(e) => setDayPassForm({ ...dayPassForm, telefono: e.target.value })}
                  placeholder="10 dígitos"
                />
                <p className="sub-label">Correo (opcional — le llega el Day Pass por ahí)</p>
                <input
                  type="email"
                  value={dayPassForm.email}
                  onChange={(e) => setDayPassForm({ ...dayPassForm, email: e.target.value })}
                  placeholder="correo@ejemplo.com"
                />
                <p className="sub-label">Fecha</p>
                <input
                  type="date"
                  value={dayPassForm.fecha}
                  onChange={(e) => setDayPassForm({ ...dayPassForm, fecha: e.target.value })}
                />
                {dayPassPrevioUsado && (
                  <div className="daypass-bloqueo-aviso">
                    ⚠️ Este invitado ya usó un Day Pass el {dayPassPrevioUsado.fecha} (folio NODUS-
                    {String(dayPassPrevioUsado.folio).padStart(3, "0")}). Es una cortesía de un solo uso por
                    persona — no se puede generar otro.
                  </div>
                )}
                {errorDayPass && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorDayPass}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button className="tel-borrar-btn" onClick={() => setMostrarGeneradorDayPass(false)} disabled={generandoDayPass}>
                    Cancelar
                  </button>
                  <button className="reservar-btn" onClick={generarDayPass} disabled={generandoDayPass || !!dayPassPrevioUsado}>
                    {generandoDayPass ? "Generando..." : "Generar"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-nombre">✅ Day Pass generado</p>
                <div className="daypass-ticket-wrap">
                  <div className="daypass-ticket-3d">
                    <div className="daypass-ticket daypass-ticket-imprimible">
                      <div className="daypass-main">
                        <div className="daypass-content">
                          <div className="daypass-header">
                            <div className="daypass-brand-wrap">
                              <img src="/images/nodus-icon.png" className="daypass-brand-icon" alt="" />
                              <div>
                                <div className="daypass-brand">NODUS</div>
                                <div className="daypass-brand-sub">Flex Center</div>
                              </div>
                            </div>
                            <span className="daypass-type-badge">
                              {dayPassGenerado.tipo === "coworking" ? "Coworking" : "Oficina privada"}
                            </span>
                          </div>
                          <p className="daypass-title">Day Pass</p>
                          <p className="daypass-subtitle">
                            Disfruta de trabajar un día en{" "}
                            {dayPassGenerado.tipo === "coworking" ? "nuestro coworking" : "tu oficina privada"}
                          </p>
                          <div className="daypass-details">
                            <div className="daypass-detail-item">
                              <span className="daypass-label">Nombre</span>
                              <span className="daypass-value">{dayPassGenerado.nombre}</span>
                            </div>
                            <div className="daypass-detail-item">
                              <span className="daypass-label">Fecha</span>
                              <span className="daypass-value">{dayPassGenerado.fecha}</span>
                            </div>
                            <div className="daypass-detail-item">
                              <span className="daypass-label">Centro</span>
                              <span className="daypass-value">{dayPassGenerado.centro}</span>
                            </div>
                            <div className="daypass-detail-item">
                              <span className="daypass-label">Emite</span>
                              <span className="daypass-value">{dayPassGenerado.emitido_por_nombre || "—"}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="daypass-perforation" />

                      <div className="daypass-stub">
                        <div className="daypass-barcode-wrap">
                          {dayPassQR ? (
                            <img src={dayPassQR} className="daypass-qr" alt="Código QR del Day Pass" />
                          ) : (
                            <div className="daypass-barcode" />
                          )}
                          <p className="daypass-barcode-id">
                            NODUS-{String(dayPassGenerado.folio).padStart(3, "0")}
                          </p>
                        </div>
                        <div className="daypass-admit">
                          <p className="daypass-admit-label">Folio</p>
                          <p className="daypass-admit-num">{String(dayPassGenerado.folio).padStart(3, "0")}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {dayPassCorreoEstado === "enviado" && (
                  <p style={{ fontSize: 12, color: "#0F6E56", textAlign: "center", margin: "4px 0 0", fontWeight: 600 }}>
                    📧 Se envió a {dayPassForm.email}
                  </p>
                )}
                {dayPassCorreoEstado === "error" && (
                  <p style={{ fontSize: 12, color: "#A32D2D", textAlign: "center", margin: "4px 0 0", fontWeight: 600 }}>
                    ⚠️ No se pudo enviar el correo — usa el link de abajo para compartirlo manualmente.
                  </p>
                )}
                <p style={{ fontSize: 12, color: "#666", textAlign: "center", margin: "4px 0 0" }}>
                  El invitado no tiene cuenta — para que vea su pase en su celular, copia el link y mándaselo por
                  WhatsApp, SMS o correo.
                </p>

                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <button className="tel-borrar-btn" onClick={() => setMostrarGeneradorDayPass(false)}>
                    Cerrar
                  </button>
                  <button className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={copiarLinkDayPass}>
                    {linkDayPassCopiado ? "✓ Link copiado" : "🔗 Copiar link para el invitado"}
                  </button>
                  <button className="reservar-btn" onClick={() => window.print()}>
                    🖨 Imprimir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {prospectoPerdiendo && (
        <div
          className="modal-overlay"
          onClick={() => {
            setProspectoPerdiendo(null);
            setComentarioPerdido("");
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Marcar como Perdido</p>
            <p className="modal-email">{prospectoPerdiendo.nombre}</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Por qué se perdió este prospecto o por qué ya no se le dio seguimiento?
            </p>
            <textarea
              autoFocus
              placeholder="Ej. Ya no contestó llamadas ni mensajes"
              value={comentarioPerdido}
              onChange={(e) => setComentarioPerdido(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="tel-borrar-btn"
                onClick={() => {
                  setProspectoPerdiendo(null);
                  setComentarioPerdido("");
                }}
              >
                Cancelar
              </button>
              <button className="btn-rechazar" onClick={confirmarProspectoPerdido}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
