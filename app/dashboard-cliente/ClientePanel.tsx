"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  nombre: string | null;
  email: string | null;
  rol: string | null;
  centro: string | null;
  ciudad: string | null;
  rfc: string | null;
  numero_oficina: string | null;
  tipo_oficina: string | null;
  numero_usuario: string | null;
} | null;

type PagoPendiente = { estado: string; fecha_limite: string | null };

// Próxima ocurrencia del día de pago del contrato: si el día ya pasó
// este mes, se proyecta al mes siguiente.
function diasHastaProximoPago(diaPago: number): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let proximo = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago);
  if (proximo < hoy) proximo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, diaPago);
  return Math.round((proximo.getTime() - hoy.getTime()) / 86400000);
}

type Voucher = {
  codigo: string;
  folio: string;
  created_at: string;
  expira_en: string | null;
} | null;

type MiExtension = {
  extension: string;
  did: string | null;
  tipo: string;
} | null;

type TicketResumen = { id: string; folio: string; asunto: string; descripcion?: string | null };

// Sala de Juntas vs Horas Bolsa (Coworking / Sala de Capacitación) — mismo
// criterio que app/reservaciones/page.tsx: startsWith en vez de igualdad
// exacta para clasificar también oficinas numeradas tipo "Coworking 1".
function esSalaDeJuntas(espacio: string) {
  return !espacio.startsWith("Coworking") && !espacio.startsWith("Sala de Capacitación");
}

type ContratoCliente = {
  id: string;
  horas_sala_juntas: number | null;
  horas_bolsa: number | null;
  paquete_id: string | null;
  oficina_id: string | null;
  fecha_inicio: string;
  dia_pago: number | null;
  label: string;
};

type BannerDestacado = { src: string; alt: string };

// Banners promocionales del carrusel de arriba del dashboard (estilo
// "Rappi"): hoy solo llevamos el banner de Nodus Flex Center, pero para
// sumar más (p.ej. empresas de éxito / testimoniales) basta con:
//   1. Poner la imagen en /public/images
//   2. Agregar un objeto { src, alt } a este arreglo
// El carrusel se ajusta solo — muestra los puntos y hace autoplay
// automáticamente en cuanto hay más de un banner.
const BANNERS_DESTACADOS: BannerDestacado[] = [
  {
    src: "/images/nodus-flex-center-banner.jpg",
    alt: "Nodus Flex Center · Aguascalientes, León, San Luis Potosí y Querétaro",
  },
  {
    src: "/images/nodus-flex-center-capacitacion.jpg",
    alt: "Capacitación en vivo en las salas de Nodus Flex Center",
  },
  {
    src: "/images/nodus-san-telmo.jpg",
    alt: "Nodus Flex Center · Sucursal San Telmo",
  },
];

function CarruselDestacados({ banners }: { banners: BannerDestacado[] }) {
  const [activo, setActivo] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autoplay — solo tiene sentido si hay más de un banner.
  useEffect(() => {
    if (banners.length < 2) return;
    const id = setInterval(() => {
      setActivo((prev) => (prev + 1) % banners.length);
    }, 5000);
    return () => clearInterval(id);
  }, [banners.length]);

  useEffect(() => {
    const track = trackRef.current;
    const slide = track?.children[activo] as HTMLElement | undefined;
    if (!track || !slide) return;
    // Antes usábamos slide.scrollIntoView(), pero si el carrusel queda
    // fuera de la pantalla (ej. el cliente está hasta abajo del
    // dashboard cuando cambia el banner), scrollIntoView jala TODA la
    // página hacia arriba para volver a mostrarlo — no solo desliza el
    // carrusel. Moviendo el scrollLeft del track directamente, solo se
    // desliza el carrusel y la página se queda donde el cliente estaba.
    track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
  }, [activo]);

  useEffect(() => {
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, []);

  // El scroll (tanto el que desliza el usuario a mano como el que anima
  // el autoplay) dispara un montón de eventos intermedios mientras la
  // animación todavía va a medio camino. Si sincronizamos los puntos con
  // cada uno de esos eventos, agarramos una posición a medias que
  // redondea de vuelta al slide anterior y "pelea" con el autoplay —
  // se ve como que la imagen se mueve tantito y nunca cambia. Por eso
  // esperamos a que el scroll se asiente (deja de moverse ~120ms) antes
  // de leer la posición final y sincronizar.
  function handleScroll() {
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const index = Math.round(track.scrollLeft / track.clientWidth);
      setActivo((prev) => (index !== prev && index >= 0 && index < banners.length ? index : prev));
    }, 120);
  }

  if (banners.length === 0) return null;

  return (
    <div className="cli-carrusel">
      <div className="cli-carrusel-track" ref={trackRef} onScroll={handleScroll}>
        {banners.map((b, i) => (
          <div className="cli-carrusel-slide" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.src} alt={b.alt} className="cli-carrusel-img" />
          </div>
        ))}
      </div>
      {banners.length > 1 && (
        <div className="cli-carrusel-dots">
          {banners.map((_, i) => (
            <span key={i} className={"cli-carrusel-dot" + (i === activo ? " active" : "")} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClientePanel({
  profile,
  email,
  pagosPendientes,
  voucher,
  extension,
  ticketsEnProceso,
  ticketResuelto,
}: {
  profile: Profile;
  email: string;
  pagosPendientes: PagoPendiente[];
  voucher: Voucher;
  extension: MiExtension;
  ticketsEnProceso: TicketResumen[];
  ticketResuelto: TicketResumen | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [perfilVisible, setPerfilVisible] = useState(false);
  // La tarjeta de "Mi extensión" gira con :hover en escritorio, pero el
  // celular no tiene hover — con este estado también gira al tocarla.
  const [extensionVolteada, setExtensionVolteada] = useState(false);
  const [mostrarCelebracion, setMostrarCelebracion] = useState(!!ticketResuelto);
  const ticketRechazado = !!ticketResuelto?.descripcion?.includes("❌ Rechazada");
  const [notificaciones, setNotificaciones] = useState<
    { id: string; tipo: string; mensaje: string; leida: boolean; created_at: string }[]
  >([]);
  const [menuNotifAbierto, setMenuNotifAbierto] = useState(false);
  const [encuestasPendientes, setEncuestasPendientes] = useState(0);

  // ---------- Contratos vigentes + bancos de horas (sala / bolsa) ----------
  // Un cliente puede tener más de un contrato vigente a la vez (ej. dos
  // espacios distintos); el banco de horas es por contrato, no por cliente.
  const [contratos, setContratos] = useState<ContratoCliente[]>([]);
  const [contratoId, setContratoId] = useState("");
  const [horasSalaTotales, setHorasSalaTotales] = useState(0);
  const [horasSalaRestantes, setHorasSalaRestantes] = useState(0);
  const [horasBolsaTotales, setHorasBolsaTotales] = useState(0);
  const [horasBolsaRestantes, setHorasBolsaRestantes] = useState(0);

  // Banners de "Logros" que las empresas comparten y Diseño trabaja —
  // se suman a los banners promocionales fijos de arriba, así el
  // carrusel crece solo conforme se van publicando.
  const [bannersLogros, setBannersLogros] = useState<BannerDestacado[]>([]);

  useEffect(() => {
    supabase
      .from("logros")
      .select("banner_url, titulo, empresa")
      .eq("estado", "publicado")
      .not("banner_url", "is", null)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setBannersLogros(
          (data || [])
            .filter((l) => l.banner_url)
            .map((l) => ({ src: l.banner_url as string, alt: `Logro de ${l.empresa || "un cliente"}: ${l.titulo}` }))
        );
      });
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("notificaciones")
        .select("id, tipo, mensaje, leida, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setNotificaciones(data || []);

      const { count } = await supabase
        .from("encuestas_envios")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", user.id)
        .eq("estado", "pendiente");
      setEncuestasPendientes(count || 0);

      const { data: contratosData } = await supabase
        .from("contratos")
        .select("id, horas_sala_juntas, horas_bolsa, paquete_id, oficina_id, fecha_inicio, dia_pago")
        .eq("user_id", user.id)
        .eq("estatus", "vigente")
        .order("created_at", { ascending: false });

      if (!contratosData || contratosData.length === 0) return;

      // Resuelve nombre del paquete/oficina vía contratos.paquete_id /
      // oficina_id — NUNCA vía cotizaciones_comerciales, el cliente no
      // tiene permiso de RLS para leer esa tabla (es de staff).
      const paqueteIds = Array.from(new Set(contratosData.map((c) => c.paquete_id).filter((id): id is string => !!id)));
      const oficinaIds = Array.from(new Set(contratosData.map((c) => c.oficina_id).filter((id): id is string => !!id)));
      const [{ data: paqs }, { data: ofs }] = await Promise.all([
        paqueteIds.length > 0
          ? supabase.from("paquetes").select("id, nombre, tipo_espacio").in("id", paqueteIds)
          : Promise.resolve({ data: [] as { id: string; nombre: string; tipo_espacio: string | null }[] }),
        oficinaIds.length > 0
          ? supabase.from("oficinas").select("id, numero, tipo").in("id", oficinaIds)
          : Promise.resolve({ data: [] as { id: string; numero: string; tipo: string }[] }),
      ]);
      const paquetePorId: Record<string, { nombre: string; tipo_espacio: string | null }> = {};
      (paqs || []).forEach((p) => {
        paquetePorId[p.id] = { nombre: p.nombre, tipo_espacio: p.tipo_espacio };
      });
      const oficinaPorId: Record<string, { numero: string; tipo: string }> = {};
      (ofs || []).forEach((o) => {
        oficinaPorId[o.id] = { numero: o.numero, tipo: o.tipo };
      });

      const conLabel: ContratoCliente[] = contratosData.map((c) => {
        const paq = c.paquete_id ? paquetePorId[c.paquete_id] : null;
        const ofi = c.oficina_id ? oficinaPorId[c.oficina_id] : null;
        const partes = [
          paq ? `📦 ${paq.nombre}` : null,
          paq?.tipo_espacio || ofi?.tipo || null,
          ofi ? `Oficina ${ofi.numero}` : null,
        ].filter(Boolean);
        return {
          ...c,
          label: partes.length > 0 ? partes.join(" · ") : `Contrato desde ${c.fecha_inicio}`,
        };
      });
      setContratos(conLabel);
      setContratoId(conLabel[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!contratoId) return;
    const contrato = contratos.find((c) => c.id === contratoId);
    if (!contrato) return;
    const salaTotales = Number(contrato.horas_sala_juntas || 0);
    const bolsaTotales = Number(contrato.horas_bolsa || 0);
    setHorasSalaTotales(salaTotales);
    setHorasBolsaTotales(bolsaTotales);

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Las horas se cuentan solo dentro del mes calendario actual — se
      // renuevan solas al empezar un mes nuevo. Scopeado al contrato_id
      // elegido, porque un mismo cliente puede tener más de un contrato
      // vigente, cada uno con su propio banco de horas.
      const hoy = new Date();
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split("T")[0];
      const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split("T")[0];

      const { data: usadas } = await supabase
        .from("reservaciones")
        .select("hora_inicio, hora_fin, espacio")
        .eq("user_id", user.id)
        .eq("contrato_id", contratoId)
        .in("estado", ["pendiente", "confirmada"])
        .gte("fecha", inicioMes)
        .lte("fecha", finMes);

      let salaUsadas = 0;
      let bolsaUsadas = 0;
      (usadas || []).forEach((r) => {
        if (!r.espacio || !r.hora_inicio || !r.hora_fin) return;
        const horas = parseInt(r.hora_fin.split(":")[0]) - parseInt(r.hora_inicio.split(":")[0]);
        if (esSalaDeJuntas(r.espacio)) salaUsadas += horas;
        else bolsaUsadas += horas;
      });

      setHorasSalaRestantes(salaTotales - salaUsadas);
      setHorasBolsaRestantes(bolsaTotales - bolsaUsadas);
    })();
  }, [contratoId, contratos]);

  async function marcarNotifLeida(id: string) {
    await supabase.from("notificaciones").update({ leida: true }).eq("id", id);
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
  }

  function abrirNotificacion(n: { id: string; tipo: string; leida: boolean }) {
    if (!n.leida) marcarNotifLeida(n.id);
    setMenuNotifAbierto(false);
    if (n.tipo === "encuesta_pendiente") {
      router.push("/mis-encuestas");
    } else if (n.tipo === "reservacion_rechazada" || n.tipo === "reservacion_confirmada") {
      router.push("/mis-reservaciones");
    }
  }

  const notifsSinLeer = notificaciones.filter((n) => !n.leida).length;

  // Deuda consolidada: sale exclusivamente de `pagos` (no de `facturas`),
  // así un pago sin factura (renta, depósito, adicionales) pesa igual que
  // uno con factura para efectos de "cuánto debo". Prioridad: vencido >
  // cuenta regresiva desde pagos.fecha_limite > cuenta regresiva desde
  // contratos.dia_pago > mensaje genérico > al corriente.
  const hoyISO = new Date().toISOString().split("T")[0];
  const hayVencida = pagosPendientes.some((p) => p.fecha_limite && p.fecha_limite < hoyISO);
  const hayDeuda = pagosPendientes.length > 0;
  const fechasLimite = pagosPendientes.map((p) => p.fecha_limite).filter((f): f is string => !!f);
  const proximaFechaLimite = fechasLimite.length > 0 ? fechasLimite.sort()[0] : null;
  const diaPagoContrato = (contratos.find((ct) => ct.id === contratoId) || contratos[0])?.dia_pago ?? null;
  const diasParaPagar = proximaFechaLimite
    ? Math.ceil((new Date(proximaFechaLimite).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : diaPagoContrato != null
    ? diasHastaProximoPago(diaPagoContrato)
    : null;

  useEffect(() => {
    if (!ticketResuelto) return;
    // Se marca como visto de inmediato, así aunque recarguen la página
    // mientras ven la animación, no les vuelve a salir después.
    supabase
      .from("tickets")
      .update({ notificado_resuelto: true })
      .eq("id", ticketResuelto.id)
      .then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const inicial = profile?.nombre ? profile.nombre.charAt(0).toUpperCase() : "C";

  return (
    <div className="cli-container">
      <div className="cli-header">
        <div>
          <p className="cli-header-bienvenido">Bienvenido de nuevo</p>
          <p className="cli-header-nombre">{profile?.nombre || "Cliente"}</p>
          <p className="cli-header-oficina">
            {profile?.numero_oficina ? `Oficina ${profile.numero_oficina} · ` : ""}
            {profile?.centro || profile?.ciudad || "Nodus Flex Center"}
          </p>
          {profile?.numero_usuario && (
            <p className="cli-header-numero">{profile.numero_usuario}</p>
          )}
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
                        onClick={() => abrirNotificacion(n)}
                      >
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
          <button className="cli-avatar" onClick={() => setPerfilVisible(true)}>
            {inicial}
          </button>
        </div>
      </div>

      <div className="cli-content">
        <CarruselDestacados banners={[...BANNERS_DESTACADOS, ...bannersLogros]} />

        {encuestasPendientes > 0 && (
          <a className="ticket-en-proceso-banner" href="/mis-encuestas" style={{ display: "flex", textDecoration: "none" }}>
            <span style={{ fontSize: 20 }}>📝</span>
            <div>
              <p className="ticket-en-proceso-title">
                {encuestasPendientes === 1 ? "Tienes una encuesta pendiente" : `Tienes ${encuestasPendientes} encuestas pendientes`}
              </p>
            </div>
          </a>
        )}

        {ticketsEnProceso.length > 0 &&
          ticketsEnProceso.map((t) => (
            <a className="ticket-en-proceso-banner" href="/soporte" key={t.id} style={{ display: "flex", textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/herramientas.png" alt="" className="ticket-en-proceso-icon icon-img-24" />
              <div>
                <p className="ticket-en-proceso-title">
                  Tu ticket {t.folio} fue marcado en proceso
                </p>
                <p className="ticket-en-proceso-sub">
                  Se está trabajando en &quot;{t.asunto}&quot;
                </p>
              </div>
            </a>
          ))}

        {hayDeuda ? (
          <div className="cli-estado-card">
            <div>
              <p className="cli-estado-label">Estado de cuenta</p>
              <p className="cli-estado-monto" style={{ color: hayVencida ? "#f07e3a" : undefined, fontSize: 20 }}>
                {hayVencida
                  ? "⚠️ Tienes pagos vencidos"
                  : diasParaPagar !== null
                  ? diasParaPagar <= 0
                    ? "Vence hoy"
                    : `Te quedan ${diasParaPagar} día${diasParaPagar === 1 ? "" : "s"} para pagar`
                  : "Tienes pagos pendientes"}
              </p>
              <p className="cli-estado-fecha">Ver estado de cuenta</p>
            </div>
            <a className="pay-btn" href="/estado-cuenta">
              <span className="icon-container">
                <svg
                  className="icon wallet-icon default-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2h-4a3 3 0 0 0 0 6h4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                  <path d="M17 12h.01" />
                </svg>
                <svg
                  className="icon card-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
                <svg
                  className="icon payment-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M6 12h.01M18 12h.01" />
                </svg>
                <svg
                  className="icon dollar-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <svg
                  className="icon check-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="btn-text">Pagar</span>
            </a>
          </div>
        ) : (
          <div className="cli-al-corriente">
            <p className="cli-al-corriente-icon">🎉</p>
            <p className="cli-al-corriente-text">¡Estás al corriente!</p>
            <p className="cli-al-corriente-sub">No tienes pagos pendientes</p>
          </div>
        )}

        {extension && (
          extension.did ? (
            <div className="ext-flip-card" onClick={() => setExtensionVolteada((v) => !v)}>
              <div className={"ext-flip-card-inner" + (extensionVolteada ? " volteada" : "")}>
                <div className="ext-flip-card-front">
                  <div className="servicio-icono">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/telefono.png" alt="" className="icon-img-28" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Mi extensión</p>
                    <p style={{ fontSize: 20, fontWeight: 700, color: "#0d1b3e", margin: "2px 0 0" }}>
                      {extension.extension}
                    </p>
                    <p style={{ fontSize: 10, color: "#bbb", margin: "2px 0 0" }}>Pasa el mouse para ver el DID</p>
                  </div>
                </div>
                <div className="ext-flip-card-back">
                  <p style={{ fontSize: 12, margin: 0, opacity: 0.85 }}>DID</p>
                  <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{extension.did}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="ext-card-simple">
              <div className="servicio-icono">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/telefono.png" alt="" className="icon-img-28" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Mi extensión</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "#0d1b3e", margin: "2px 0 0" }}>
                  {extension.extension}
                </p>
              </div>
            </div>
          )
        )}

        {contratos.length > 1 && (
          <div>
            <p className="panel-section-label">Contrato</p>
            <select value={contratoId} onChange={(e) => setContratoId(e.target.value)} style={{ width: "100%" }}>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {horasSalaTotales > 0 && (
          <div className="horas-banco-card">
            <div>
              <p className="horas-banco-num">{Math.max(horasSalaRestantes, 0)}</p>
              <p className="horas-banco-lbl">horas de sala de juntas</p>
            </div>
            <div className="horas-banco-bar-wrap">
              <div className="horas-banco-bar">
                <div
                  className="horas-banco-bar-fill"
                  style={{
                    width: `${Math.min((Math.max(horasSalaRestantes, 0) / horasSalaTotales) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="horas-banco-detalle">
                {Math.max(horasSalaRestantes, 0)} de {horasSalaTotales} disponibles
              </p>
            </div>
          </div>
        )}

        {horasBolsaTotales > 0 && (
          <div className="horas-banco-card">
            <div>
              <p className="horas-banco-num">{Math.max(horasBolsaRestantes, 0)}</p>
              <p className="horas-banco-lbl">horas bolsa</p>
            </div>
            <div className="horas-banco-bar-wrap">
              <div className="horas-banco-bar">
                <div
                  className="horas-banco-bar-fill"
                  style={{
                    width: `${Math.min((Math.max(horasBolsaRestantes, 0) / horasBolsaTotales) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="horas-banco-detalle">
                {Math.max(horasBolsaRestantes, 0)} de {horasBolsaTotales} disponibles
              </p>
            </div>
          </div>
        )}

        <p className="panel-section-label">Mi espacio</p>
        <div className="quick-grid">
          <a className="quick-card" href="/mi-wifi">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/wifi.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">WiFi</span>
          </a>
          <a className="quick-card" href="/estado-cuenta">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/estado-cuenta.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Estado de Cuenta</span>
          </a>
          <a className="quick-card" href="/facturas">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/factura.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Facturas</span>
          </a>
          <a className="quick-card" href={`/contrato${contratoId ? `?contratoId=${contratoId}` : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/contrato.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Contrato</span>
          </a>
          <a className="quick-card" href="/soporte">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/herramientas.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Soporte</span>
          </a>
          <a className="quick-card" href="/quejas-sugerencias">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/queja.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Quejas y Sugerencias</span>
          </a>
          <a className="quick-card" href="/logros">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/insignia.png" alt="" className="quick-icon icon-img-28" />
            <span className="quick-name">Logros</span>
          </a>
        </div>

        <p className="panel-section-label">Reservar servicios</p>
        {(() => {
          const sinHorasDefinidas = horasSalaTotales === 0 && horasBolsaTotales === 0;
          const qs = contratoId ? `&contratoId=${contratoId}` : "";
          return (
            <>
              {(horasSalaTotales > 0 || sinHorasDefinidas) && (
                <a className="servicio-card" href={`/reservaciones?categoria=sala${qs}`}>
                  <div className="servicio-icono">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/sala-juntas.png" alt="" className="icon-img-24" />
                  </div>
                  <div className="servicio-info">
                    <p className="servicio-nombre">Sala de Juntas</p>
                    <p className="servicio-desc">Reserva para hoy o cualquier día</p>
                  </div>
                  <span className="servicio-arrow">›</span>
                </a>
              )}
              {(horasBolsaTotales > 0 || sinHorasDefinidas) && (
                <a className="servicio-card" href={`/reservaciones?categoria=bolsa${qs}`}>
                  <div className="servicio-icono">🎟️</div>
                  <div className="servicio-info">
                    <p className="servicio-nombre">Horas Bolsa</p>
                    <p className="servicio-desc">Coworking / Sala de Capacitación</p>
                  </div>
                  <span className="servicio-arrow">›</span>
                </a>
              )}
            </>
          );
        })()}

        <a className="servicio-card" href="/mis-reservaciones">
          <div className="servicio-icono">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/reserva.png" alt="" className="icon-img-24" />
          </div>
          <div className="servicio-info">
            <p className="servicio-nombre">Mis Reservaciones</p>
            <p className="servicio-desc">Ver y gestionar tus reservaciones</p>
          </div>
          <span className="servicio-arrow">›</span>
        </a>
      </div>

      {perfilVisible && (
        <div className="modal-overlay" onClick={() => setPerfilVisible(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-avatar">{inicial}</div>
              <div style={{ flex: 1 }}>
                <p className="modal-nombre">{profile?.nombre}</p>
                <p className="modal-email">{profile?.email || email}</p>
              </div>
              <button className="modal-cerrar" onClick={() => setPerfilVisible(false)}>
                ✕
              </button>
            </div>

            <div className="cli-modal-datos">
              {profile?.rfc && (
                <div className="modal-row">
                  <span className="modal-label">RFC</span>
                  <span className="modal-val">{profile.rfc}</span>
                </div>
              )}
              <div className="modal-row">
                <span className="modal-label">Ciudad</span>
                <span className="modal-val">{profile?.ciudad || profile?.centro || "-"}</span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Centro</span>
                <span className="modal-val">{profile?.centro || "-"}</span>
              </div>
              {profile?.numero_oficina && (
                <div className="modal-row">
                  <span className="modal-label">Oficina</span>
                  <span className="modal-val">{profile.numero_oficina}</span>
                </div>
              )}
              {profile?.tipo_oficina && (
                <div className="modal-row">
                  <span className="modal-label">Tipo de oficina</span>
                  <span className="modal-val">{profile.tipo_oficina}</span>
                </div>
              )}
            </div>

            <button
              className="cli-modal-logout"
              onClick={() => {
                setPerfilVisible(false);
                handleLogout();
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {mostrarCelebracion && ticketResuelto && (
        <div className="modal-overlay" onClick={() => setMostrarCelebracion(false)}>
          {!ticketRechazado && (
            <div className="confetti-wrap">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="confetti-piece"
                  style={{
                    left: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 0.6}s`,
                    background: ["#f07e3a", "#0d1b3e", "#0f6e56", "#185fa5", "#f4c542"][i % 5],
                  }}
                />
              ))}
            </div>
          )}
          <div className="celebracion-card" onClick={(e) => e.stopPropagation()}>
            <p className="celebracion-icon">{ticketRechazado ? "❌" : "🎉"}</p>
            <p className="celebracion-title">
              {ticketRechazado ? "Tu solicitud fue rechazada" : "¡Tu ticket ha sido resuelto!"}
            </p>
            <p className="celebracion-sub">
              {ticketResuelto.folio} · {ticketResuelto.asunto}
            </p>
            <button className="reservar-btn" onClick={() => setMostrarCelebracion(false)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
