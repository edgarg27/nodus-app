"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { correoVisible } from "@/lib/correoFicticio";
import type { Baja, Cargo, ClienteCobranza, Pagado, TipoCargo } from "@/lib/cobranza";
import Link from "next/link";

const CENTROS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const CATEGORIAS: { valor: TipoCargo; label: string }[] = [
  { valor: "renta", label: "Renta / mensualidad" },
  { valor: "adicional", label: "Adicionales" },
  { valor: "deposito", label: "Depósito en garantía" },
  { valor: "otro", label: "Otros" },
];
const FORMAS_PAGO = [
  { valor: "03", label: "03 · Transferencia" },
  { valor: "01", label: "01 · Efectivo" },
  { valor: "04", label: "04 · Tarjeta de crédito" },
  { valor: "28", label: "28 · Tarjeta de débito" },
  { valor: "02", label: "02 · Cheque" },
];
const MEDIOS: Record<string, string> = {
  whatsapp: "WhatsApp",
  llamada: "Llamada",
  correo: "Correo",
  en_persona: "En persona",
  otro: "Otro",
};
const POR_PAGINA = 25;
const MENSAJE_RECORDATORIO =
  "Hola {nombre}:\n\nTe recordamos que tienes un saldo pendiente de {saldo} con fecha límite el {fecha_limite}.\n\nSi ya realizaste tu pago, por favor sube tu comprobante en tu portal de Nodus para registrarlo.\n\n¡Gracias!";

type Promesa = {
  id: string;
  user_id: string;
  monto: number | null;
  fecha_promesa: string;
  fecha_contacto: string;
  medio: string;
  nota: string | null;
  estado: "activa" | "cumplida" | "incumplida" | "cancelada";
  created_at: string;
};

type Datos = {
  esGlobal: boolean;
  centro: string | null;
  puedeRegistrar: boolean;
  clientes: ClienteCobranza[];
  cargos: Cargo[];
  pagados: Pagado[];
  bajas: Baja[];
  promesas: Promesa[];
};

type Estado = "al_corriente" | "pendiente" | "por_vencer" | "vencido";
type Pestana = "todos" | "corriente" | "por_vencer" | "vencidos" | "sin_pago" | "promesa" | "suspendidos" | "bajas" | "revisar";

type Fila = {
  c: ClienteCobranza;
  saldo: number;
  vencido: number;
  porVencer: number;
  fechaLimite: string | null;
  diasAtraso: number;
  estado: Estado;
  promesa: Promesa | null;
  porRevisar: number;
  sinPago: boolean;
  baja: Baja | null;
};

const moneda = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (iso: string | null) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta + "T12:00:00") - Date.parse(desde + "T12:00:00")) / 86400000);
function sumarDias(iso: string, dias: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
}
const nombreDe = (c: ClienteCobranza) => c.nombre_fiscal || c.empresa || c.nombre;

const ESTADO_INFO: Record<Estado, { label: string; clase: string }> = {
  al_corriente: { label: "Al corriente", clase: "ft-chip-verde" },
  pendiente: { label: "Pendiente", clase: "ft-chip-gris" },
  por_vencer: { label: "Por vencer", clase: "ft-chip-ambar" },
  vencido: { label: "Vencido", clase: "ft-chip-roja" },
};

export default function CobranzaPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const hoy = hoyMexicoISO();
  const en7 = sumarDias(hoy, 7);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [datos, setDatos] = useState<Datos | null>(null);

  // Filtros: los KPI y la lista se calculan con ellos.
  const [centro, setCentro] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [categoria, setCategoria] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pestana, setPestana] = useState<Pestana>("todos");
  const [orden, setOrden] = useState<"saldo" | "atraso" | "fecha" | "nombre">("saldo");
  const [pagina, setPagina] = useState(1);
  const [verTodasPromesas, setVerTodasPromesas] = useState(false);

  const [menu, setMenu] = useState<{ userId: string; top: number; left: number } | null>(null);
  const [aviso, setAviso] = useState("");

  const [pagado, setPagado] = useState<{
    cliente: ClienteCobranza;
    seleccion: string[];
    fecha: string;
    forma: string;
    archivo: File | null;
    guardando: boolean;
    error: string;
  } | null>(null);
  const [promesa, setPromesa] = useState<{
    cliente: ClienteCobranza;
    monto: string;
    fechaPromesa: string;
    fechaContacto: string;
    medio: string;
    nota: string;
    guardando: boolean;
    error: string;
  } | null>(null);
  const [recordatorio, setRecordatorio] = useState<{
    userIds: string[];
    elegidos: string[];
    asunto: string;
    mensaje: string;
    enviando: boolean;
    error: string;
  } | null>(null);

  useEffect(() => {
    // Los enlaces viejos a la pestaña de gastos (/cobranza?tab=gastos) llevan a Gastos.
    if (searchParams.get("tab") === "gastos") {
      window.location.replace("/gastos");
      return;
    }
    if (searchParams.get("revisar") === "1") setPestana("revisar");
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => setPagina(1), [centro, anio, mes, categoria, busqueda, pestana, orden]);

  // El menú ⋯ va fijo en pantalla: si se mueve la página, se cierra para que no quede despegado de su fila.
  useEffect(() => {
    if (!menu) return;
    const cerrar = () => setMenu(null);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [menu]);

  async function cargar() {
    setError("");
    try {
      const res = await fetch("/api/cobranza/datos", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) setError(d.error || "No se pudo cargar la cobranza");
      else setDatos(d);
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    }
    setLoading(false);
  }

  const clientePorId = useMemo(() => new Map((datos?.clientes || []).map((c) => [c.id, c])), [datos]);

  const enPeriodo = (iso: string) => (!anio || iso.slice(0, 4) === anio) && (!mes || iso.slice(5, 7) === mes);
  const centroDe = (x: { centro: string | null; userId: string }) => x.centro || clientePorId.get(x.userId)?.centro || null;

  const anios = useMemo(() => {
    const s = new Set<string>([hoy.slice(0, 4)]);
    (datos?.cargos || []).forEach((c) => s.add(c.fechaLimite.slice(0, 4)));
    (datos?.pagados || []).forEach((p) => s.add(p.fecha.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [datos, hoy]);

  // Cargos y pagos que entran en los filtros (centro, año, mes y categoría).
  const cargosF = useMemo(
    () =>
      (datos?.cargos || []).filter(
        (c) => (!centro || centroDe(c) === centro) && (!categoria || c.tipo === categoria) && enPeriodo(c.fechaLimite)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, centro, categoria, anio, mes]
  );
  const pagadosF = useMemo(
    () =>
      (datos?.pagados || []).filter(
        (p) => (!centro || centroDe(p) === centro) && (!categoria || p.tipo === categoria) && enPeriodo(p.fecha)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos, centro, categoria, anio, mes]
  );

  const filas: Fila[] = useMemo(() => {
    if (!datos) return [];
    const cargosPorCliente = new Map<string, Cargo[]>();
    cargosF.forEach((c) => cargosPorCliente.set(c.userId, [...(cargosPorCliente.get(c.userId) || []), c]));
    const conPagos = new Set(datos.pagados.map((p) => p.userId));
    const bajaPorCliente = new Map(datos.bajas.map((b) => [b.userId, b]));
    const promesaActiva = new Map<string, Promesa>();
    datos.promesas
      .filter((p) => p.estado === "activa")
      .forEach((p) => {
        const previa = promesaActiva.get(p.user_id);
        if (!previa || p.created_at > previa.created_at) promesaActiva.set(p.user_id, p);
      });
    const q = busqueda.trim().toLowerCase();

    return datos.clientes
      .filter((c) => !centro || c.centro === centro || cargosPorCliente.has(c.id))
      .filter(
        (c) =>
          !q ||
          [c.nombre, c.empresa, c.nombre_fiscal, c.email, c.numero_usuario, c.telefono].some((v) => (v || "").toLowerCase().includes(q))
      )
      .map((c) => {
        const suyos = cargosPorCliente.get(c.id) || [];
        const saldo = suyos.reduce((s, x) => s + x.monto, 0);
        const vencidos = suyos.filter((x) => x.fechaLimite < hoy);
        const vencido = vencidos.reduce((s, x) => s + x.monto, 0);
        const porVencer = suyos.filter((x) => x.fechaLimite >= hoy && x.fechaLimite <= en7).reduce((s, x) => s + x.monto, 0);
        const fechaLimite = suyos.map((x) => x.fechaLimite).sort()[0] || null;
        const masViejo = vencidos.map((x) => x.fechaLimite).sort()[0];
        const estado: Estado = saldo <= 0 ? "al_corriente" : vencido > 0 ? "vencido" : porVencer > 0 ? "por_vencer" : "pendiente";
        return {
          c,
          saldo,
          vencido,
          porVencer,
          fechaLimite,
          diasAtraso: masViejo ? diasEntre(masViejo, hoy) : 0,
          estado,
          promesa: promesaActiva.get(c.id) || null,
          porRevisar: suyos.filter((x) => x.estado === "en_revision").length,
          sinPago: saldo > 0 && !conPagos.has(c.id),
          baja: c.activo ? null : bajaPorCliente.get(c.id) || { userId: c.id, fechaBaja: null, montoAdeudado: 0 },
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, cargosF, busqueda, centro, hoy, en7]);

  const idsVisibles = useMemo(() => new Set(filas.map((f) => f.c.id)), [filas]);

  const kpis = useMemo(() => {
    const deVisibles = cargosF.filter((c) => idsVisibles.has(c.userId));
    const pagos = pagadosF.filter((p) => idsVisibles.has(p.userId));
    const suma = (xs: { monto: number }[]) => xs.reduce((s, x) => s + x.monto, 0);
    const clientesDe = (xs: { userId: string }[]) => new Set(xs.map((x) => x.userId)).size;
    const vencidos = deVisibles.filter((c) => c.fechaLimite < hoy);
    const porVencer = deVisibles.filter((c) => c.fechaLimite >= hoy && c.fechaLimite <= en7);
    return {
      porCobrar: { monto: suma(deVisibles), clientes: clientesDe(deVisibles) },
      vencido: { monto: suma(vencidos), clientes: clientesDe(vencidos) },
      porVencer: { monto: suma(porVencer), clientes: clientesDe(porVencer) },
      pagado: { monto: suma(pagos), pagos: pagos.length },
    };
  }, [cargosF, pagadosF, idsVisibles, hoy, en7]);

  const enPestana = (f: Fila, p: Pestana) => {
    switch (p) {
      case "corriente":
        return f.estado === "al_corriente" && f.c.activo;
      case "por_vencer":
        return f.estado === "por_vencer";
      case "vencidos":
        return f.estado === "vencido";
      case "sin_pago":
        return f.sinPago;
      case "promesa":
        return !!f.promesa;
      case "suspendidos":
        return f.c.suspendido && f.c.activo;
      case "bajas":
        return !!f.baja;
      case "revisar":
        return f.porRevisar > 0;
      default:
        return true;
    }
  };
  const conteo = (p: Pestana) => filas.filter((f) => enPestana(f, p)).length;

  const filasPestana = useMemo(() => {
    const lista = filas.filter((f) => enPestana(f, pestana));
    const porNombre = (a: Fila, b: Fila) => nombreDe(a.c).localeCompare(nombreDe(b.c), "es");
    return lista.sort((a, b) => {
      if (orden === "nombre") return porNombre(a, b);
      if (orden === "atraso") return b.diasAtraso - a.diasAtraso || b.saldo - a.saldo;
      if (orden === "fecha") return (a.fechaLimite || "9999").localeCompare(b.fechaLimite || "9999") || porNombre(a, b);
      return b.saldo - a.saldo || porNombre(a, b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, pestana, orden]);

  const paginas = Math.max(1, Math.ceil(filasPestana.length / POR_PAGINA));
  const filasPagina = filasPestana.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const promesasVisibles = useMemo(
    () =>
      (datos?.promesas || [])
        .filter((p) => idsVisibles.has(p.user_id) && (verTodasPromesas || p.estado === "activa"))
        .sort((a, b) => (verTodasPromesas ? b.created_at.localeCompare(a.created_at) : a.fecha_promesa.localeCompare(b.fecha_promesa))),
    [datos, idsVisibles, verTodasPromesas]
  );

  const puedeRegistrar = !!datos?.puedeRegistrar;
  const textoPeriodo = [mes ? MESES[Number(mes) - 1] : "", anio].filter(Boolean).join(" ") || "Todo el periodo";

  function limpiarFiltros() {
    setCentro("");
    setAnio("");
    setMes("");
    setCategoria("");
    setBusqueda("");
    setPestana("todos");
  }

  function abrirMenu(e: MouseEvent<HTMLButtonElement>, userId: string) {
    const r = e.currentTarget.getBoundingClientRect();
    const alto = 230;
    const top = r.bottom + alto > window.innerHeight ? Math.max(8, r.top - alto) : r.bottom + 4;
    setMenu({ userId, top, left: Math.max(8, r.right - 240) });
  }

  // ---------- Pagado ----------
  function abrirPagado(cliente: ClienteCobranza, soloIds?: string[]) {
    setMenu(null);
    const pendientes = (datos?.cargos || []).filter((x) => x.userId === cliente.id);
    const conComprobante = pendientes.some((x) => x.comprobanteUrl && (!soloIds || soloIds.includes(x.id)));
    setPagado({
      cliente,
      seleccion: soloIds || pendientes.map((x) => x.id),
      fecha: hoy,
      forma: conComprobante ? "03" : "",
      archivo: null,
      guardando: false,
      error: "",
    });
  }

  async function guardarPagado() {
    if (!pagado || !datos) return;
    const elegidos = datos.cargos.filter((x) => pagado.seleccion.includes(x.id));
    if (elegidos.length === 0) return setPagado({ ...pagado, error: "Elige qué pagó el cliente" });
    if (!pagado.fecha) return setPagado({ ...pagado, error: "Elige la fecha del pago" });
    if (!pagado.forma) return setPagado({ ...pagado, error: "Elige la forma de pago" });
    setPagado({ ...pagado, guardando: true, error: "" });

    let comprobanteUrl: string | null = null;
    if (pagado.archivo) {
      const ext = (pagado.archivo.name.split(".").pop() || "pdf").toLowerCase();
      const ruta = `cobranza/${pagado.cliente.id}-${Date.now()}.${ext}`;
      const { error: errSubida } = await supabase.storage
        .from("comprobantes")
        .upload(ruta, pagado.archivo, { contentType: pagado.archivo.type, upsert: true });
      if (errSubida) return setPagado({ ...pagado, guardando: false, error: "No se pudo subir el comprobante: " + errSubida.message });
      comprobanteUrl = supabase.storage.from("comprobantes").getPublicUrl(ruta).data.publicUrl;
    }

    try {
      const res = await fetch("/api/cobranza/pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pagoIds: elegidos.filter((x) => x.origen === "pago").map((x) => x.id),
          facturaIds: elegidos.filter((x) => x.origen === "factura").map((x) => x.id),
          fecha: pagado.fecha,
          formaPago: pagado.forma,
          comprobanteUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setPagado({ ...pagado, guardando: false, error: d.error || "No se pudo registrar el pago" });
      setPagado(null);
      setAviso(`Pago registrado (${d.registrados} cargo${d.registrados === 1 ? "" : "s"}) de ${nombreDe(pagado.cliente)}`);
      cargar();
    } catch {
      setPagado({ ...pagado, guardando: false, error: "No se pudo conectar. Intenta de nuevo." });
    }
  }

  // ---------- Promesa de pago ----------
  function abrirPromesa(f: Fila) {
    setMenu(null);
    setPromesa({
      cliente: f.c,
      monto: f.saldo > 0 ? String(Math.round(f.saldo * 100) / 100) : "",
      fechaPromesa: "",
      fechaContacto: hoy,
      medio: "whatsapp",
      nota: "",
      guardando: false,
      error: "",
    });
  }

  async function guardarPromesa() {
    if (!promesa) return;
    if (!promesa.fechaPromesa) return setPromesa({ ...promesa, error: "Elige la fecha en que quedó en pagar" });
    if (!promesa.fechaContacto) return setPromesa({ ...promesa, error: "Elige el día en que lo dijo" });
    setPromesa({ ...promesa, guardando: true, error: "" });
    try {
      const res = await fetch("/api/cobranza/promesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: promesa.cliente.id,
          monto: promesa.monto,
          fechaPromesa: promesa.fechaPromesa,
          fechaContacto: promesa.fechaContacto,
          medio: promesa.medio,
          nota: promesa.nota,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setPromesa({ ...promesa, guardando: false, error: d.error || "No se pudo guardar la promesa" });
      setPromesa(null);
      setAviso(`Promesa de pago de ${nombreDe(promesa.cliente)} guardada`);
      cargar();
    } catch {
      setPromesa({ ...promesa, guardando: false, error: "No se pudo conectar. Intenta de nuevo." });
    }
  }

  async function cambiarPromesa(id: string, estado: Promesa["estado"]) {
    const res = await fetch("/api/cobranza/promesas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, estado }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setAviso(d.error || "No se pudo actualizar la promesa");
      return;
    }
    setDatos((prev) => (prev ? { ...prev, promesas: prev.promesas.map((p) => (p.id === id ? { ...p, estado } : p)) } : prev));
  }

  // ---------- Recordatorios ----------
  function abrirRecordatorio(userIds?: string[]) {
    setMenu(null);
    const ids = userIds || filasPestana.filter((f) => f.saldo > 0).map((f) => f.c.id);
    setRecordatorio({ userIds: ids, elegidos: ids, asunto: "Recordatorio de pago · Nodus Flex Center", mensaje: MENSAJE_RECORDATORIO, enviando: false, error: "" });
  }

  async function enviarRecordatorio() {
    if (!recordatorio) return;
    if (recordatorio.elegidos.length === 0) return setRecordatorio({ ...recordatorio, error: "Elige a quién mandarlo" });
    if (!recordatorio.asunto.trim() || !recordatorio.mensaje.trim()) return setRecordatorio({ ...recordatorio, error: "Escribe el asunto y el mensaje" });
    setRecordatorio({ ...recordatorio, enviando: true, error: "" });
    try {
      const res = await fetch("/api/cobranza/recordatorios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: recordatorio.elegidos, asunto: recordatorio.asunto, mensaje: recordatorio.mensaje }),
      });
      const d = await res.json();
      if (!res.ok) return setRecordatorio({ ...recordatorio, enviando: false, error: d.error || "No se pudo enviar" });
      if (d.fallos?.length) return setRecordatorio({ ...recordatorio, enviando: false, error: `Se enviaron ${d.enviados}. No se pudo a: ${d.fallos.join("; ")}` });
      setRecordatorio(null);
      setAviso(`Recordatorio enviado a ${d.enviados} cliente${d.enviados === 1 ? "" : "s"}`);
    } catch {
      setRecordatorio({ ...recordatorio, enviando: false, error: "No se pudo conectar. Intenta de nuevo." });
    }
  }

  // ---------- Exportación ----------
  const sufijo = () => ["cobranza", centro || "todos", anio, mes].filter(Boolean).join("-").replace(/\s+/g, "_");
  function exportarCartera() {
    exportarExcel(
      sufijo() + "-cartera",
      filasPestana.map((f) => ({
        Cliente: nombreDe(f.c),
        Contacto: f.c.nombre,
        "No. cliente": f.c.numero_usuario || "",
        Centro: f.c.centro || "",
        Correo: correoVisible(f.c.email),
        Teléfono: f.c.telefono || "",
        Saldo: f.saldo,
        Vencido: f.vencido,
        "Por vencer (7 días)": f.porVencer,
        "Fecha límite": f.fechaLimite || "",
        "Días de atraso": f.diasAtraso,
        Estado: ESTADO_INFO[f.estado].label + (f.c.suspendido ? " · Suspendido" : "") + (f.baja ? " · Baja" : ""),
        "Promesa de pago": f.promesa ? f.promesa.fecha_promesa : "",
      }))
    );
  }
  function exportarCargos() {
    const ids = new Set(filasPestana.map((f) => f.c.id));
    exportarExcel(
      sufijo() + "-cargos",
      cargosF
        .filter((x) => ids.has(x.userId))
        .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))
        .map((x) => {
          const c = clientePorId.get(x.userId);
          return {
            Cliente: c ? nombreDe(c) : "",
            Centro: centroDe(x) || "",
            Concepto: x.concepto,
            Categoría: CATEGORIAS.find((k) => k.valor === x.tipo)?.label || "",
            Folio: x.folio || "",
            Monto: x.monto,
            "Fecha límite": x.fechaLimite,
            Estado: x.fechaLimite < hoy ? "Vencido" : x.estado === "en_revision" ? "Comprobante por revisar" : "Pendiente",
          };
        })
    );
  }
  function exportarPromesas() {
    exportarExcel(
      sufijo() + "-promesas",
      (datos?.promesas || [])
        .filter((p) => idsVisibles.has(p.user_id))
        .map((p) => {
          const c = clientePorId.get(p.user_id);
          return {
            Cliente: c ? nombreDe(c) : "",
            Centro: c?.centro || "",
            Monto: p.monto ?? "",
            "Fecha prometida": p.fecha_promesa,
            "Día que lo dijo": p.fecha_contacto,
            Medio: MEDIOS[p.medio] || p.medio,
            Nota: p.nota || "",
            Estado: p.estado,
          };
        })
    );
  }

  const proximaAccion = (p: Promesa) => {
    if (p.estado !== "activa") return p.estado === "cumplida" ? "Cumplida" : p.estado === "incumplida" ? "No cumplió" : "Cancelada";
    if (p.fecha_promesa < hoy) return `Venció hace ${diasEntre(p.fecha_promesa, hoy)} día(s): volver a contactar`;
    if (p.fecha_promesa === hoy) return "Hoy: confirmar el pago";
    return `Confirmar el ${fechaCorta(p.fecha_promesa)}`;
  };

  const menuFila = menu ? filas.find((f) => f.c.id === menu.userId) || null : null;

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Cobranza</p>
        <p className="rep-sub">
          {datos?.esGlobal ? centro || "Todos los centros" : datos?.centro || "Tu centro"} · {textoPeriodo}
        </p>
      </div>

      <div className="rep-content rep-content-completo">
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
        ) : !datos ? (
          <div className="empty-card">{error || "No se pudo cargar la cobranza"}</div>
        ) : (
          <>
            {/* Filtros */}
            <div className="ft-card">
              <div className="ft-card-cab">
                <div className="ft-cab-titulo">
                  <span className="ft-cab-icono">
                    <IconoFiltro />
                  </span>
                  <div>
                    <p className="ft-titulo">Filtros</p>
                    <p className="ft-sub">Los totales de arriba y la lista se actualizan con lo que elijas.</p>
                  </div>
                </div>
                <div className="ft-res-botones">
                  <button type="button" className="ft-btn-sec" onClick={limpiarFiltros}>
                    Limpiar filtros
                  </button>
                  {puedeRegistrar && (
                    <button type="button" className="ft-btn-buscar" onClick={() => abrirRecordatorio()}>
                      <IconoCampana /> Enviar recordatorios
                    </button>
                  )}
                </div>
              </div>
              <div className="ft-grid">
                <label className="ft-campo">
                  <span>Centro</span>
                  <select value={datos.esGlobal ? centro : datos.centro || ""} disabled={!datos.esGlobal} onChange={(e) => setCentro(e.target.value)}>
                    {datos.esGlobal ? (
                      <>
                        <option value="">Todos los centros</option>
                        {CENTROS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </>
                    ) : (
                      <option value={datos.centro || ""}>{datos.centro || "—"}</option>
                    )}
                  </select>
                </label>
                <label className="ft-campo">
                  <span>Año</span>
                  <select value={anio} onChange={(e) => setAnio(e.target.value)}>
                    <option value="">Todos</option>
                    {anios.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ft-campo">
                  <span>Mes</span>
                  <select value={mes} onChange={(e) => setMes(e.target.value)}>
                    <option value="">Todos</option>
                    {MESES.map((m, i) => (
                      <option key={m} value={String(i + 1).padStart(2, "0")}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ft-campo">
                  <span>Categoría</span>
                  <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    <option value="">Todas</option>
                    {CATEGORIAS.map((k) => (
                      <option key={k.valor} value={k.valor}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* KPI: cambian con los filtros */}
            <div className="cb-kpis">
              <button type="button" className={"cb-kpi cb-kpi-azul" + (pestana === "todos" ? " activa" : "")} onClick={() => setPestana("todos")}>
                <span className="cb-kpi-lbl">Por cobrar</span>
                <span className="cb-kpi-val">{moneda(kpis.porCobrar.monto)}</span>
                <span className="cb-kpi-sub">{kpis.porCobrar.clientes} cliente(s) con saldo</span>
              </button>
              <button type="button" className={"cb-kpi cb-kpi-roja" + (pestana === "vencidos" ? " activa" : "")} onClick={() => setPestana("vencidos")}>
                <span className="cb-kpi-lbl">Vencido</span>
                <span className="cb-kpi-val">{moneda(kpis.vencido.monto)}</span>
                <span className="cb-kpi-sub">{kpis.vencido.clientes} cliente(s) atrasados</span>
              </button>
              <button type="button" className={"cb-kpi cb-kpi-ambar" + (pestana === "por_vencer" ? " activa" : "")} onClick={() => setPestana("por_vencer")}>
                <span className="cb-kpi-lbl">Por vencer · 7 días</span>
                <span className="cb-kpi-val">{moneda(kpis.porVencer.monto)}</span>
                <span className="cb-kpi-sub">{kpis.porVencer.clientes} cliente(s)</span>
              </button>
              <button type="button" className={"cb-kpi cb-kpi-verde" + (pestana === "corriente" ? " activa" : "")} onClick={() => setPestana("corriente")}>
                <span className="cb-kpi-lbl">Pagado</span>
                <span className="cb-kpi-val">{moneda(kpis.pagado.monto)}</span>
                <span className="cb-kpi-sub">
                  {kpis.pagado.pagos} pago(s) · {textoPeriodo.toLowerCase()}
                </span>
              </button>
            </div>

            {/* Clientes */}
            <div className="ft-card">
              <div className="ft-res-cab">
                <div>
                  <p className="ft-titulo">Clientes</p>
                  <p className="ft-sub">Saldo, fecha límite y estado de cada cliente.</p>
                </div>
                <div className="ft-res-botones" style={{ alignItems: "center" }}>
                  <label className="ft-campo" style={{ minWidth: 260 }}>
                    <input placeholder="Buscar cliente, RFC, correo, teléfono..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                  </label>
                  <label className="ft-campo">
                    <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
                      <option value="saldo">Mayor saldo</option>
                      <option value="atraso">Más días de atraso</option>
                      <option value="fecha">Fecha límite más próxima</option>
                      <option value="nombre">Nombre (A-Z)</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="cb-tabs">
                {(
                  [
                    ["todos", "Todos"],
                    ["corriente", "Al corriente"],
                    ["por_vencer", "Por vencer"],
                    ["vencidos", "Vencidos"],
                    ["sin_pago", "Sin pago registrado"],
                    ["promesa", "Con promesa"],
                    ["revisar", "Comprobantes por revisar"],
                    ["suspendidos", "Suspendidos"],
                    ["bajas", "Bajas con adeudo"],
                  ] as [Pestana, string][]
                ).map(([p, label]) => (
                  <button key={p} type="button" className={pestana === p ? "activa" : ""} onClick={() => setPestana(p)}>
                    {label} ({conteo(p)})
                  </button>
                ))}
              </div>

              {filasPestana.length === 0 ? (
                <div className="ft-vacio">{busqueda ? "Ningún cliente coincide con la búsqueda" : "Sin clientes en esta categoría"}</div>
              ) : (
                <>
                  <div className="ft-tabla-wrap" style={{ marginTop: 14 }}>
                    <table className="ft-tabla">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          {datos.esGlobal && !centro && <th>Centro</th>}
                          <th className="ft-num">Saldo</th>
                          <th className="ft-num">Vencido</th>
                          <th className="ft-num">Días de atraso</th>
                          <th>Fecha límite</th>
                          <th>Estado</th>
                          <th>Contactar</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasPagina.map((f) => (
                          <tr key={f.c.id}>
                            <td>
                              <div className="cb-cliente">{nombreDe(f.c)}</div>
                              <div className="cb-cliente-sub">
                                {[f.c.numero_usuario, nombreDe(f.c) !== f.c.nombre ? f.c.nombre : null].filter(Boolean).join(" · ") || correoVisible(f.c.email)}
                              </div>
                            </td>
                            {datos.esGlobal && !centro && <td className="ft-nowrap">{f.c.centro || "—"}</td>}
                            <td className="ft-num ft-nowrap">
                              <b>{moneda(f.saldo)}</b>
                            </td>
                            <td className="ft-num ft-nowrap" style={{ color: f.vencido > 0 ? "#b42323" : undefined }}>
                              {f.vencido > 0 ? moneda(f.vencido) : "—"}
                            </td>
                            <td className="ft-num">{f.diasAtraso > 0 ? f.diasAtraso : "—"}</td>
                            <td className="ft-nowrap" style={{ color: f.fechaLimite && f.fechaLimite < hoy ? "#b42323" : undefined }}>
                              {fechaCorta(f.fechaLimite)}
                            </td>
                            <td>
                              <div className="cb-chips">
                                <span className={"ft-chip " + ESTADO_INFO[f.estado].clase}>{ESTADO_INFO[f.estado].label}</span>
                                {f.promesa && <span className="ft-chip ft-chip-ambar">Promesa {fechaCorta(f.promesa.fecha_promesa)}</span>}
                                {f.porRevisar > 0 &&
                                  (puedeRegistrar ? (
                                    <button
                                      type="button"
                                      className="ft-chip cb-chip-btn"
                                      style={{ background: "#e8f0fb", color: "#254b8c" }}
                                      onClick={() =>
                                        abrirPagado(
                                          f.c,
                                          datos.cargos.filter((x) => x.userId === f.c.id && x.estado === "en_revision").map((x) => x.id)
                                        )
                                      }
                                    >
                                      Comprobante por revisar
                                    </button>
                                  ) : (
                                    <span className="ft-chip" style={{ background: "#e8f0fb", color: "#254b8c" }}>
                                      Comprobante por revisar
                                    </span>
                                  ))}
                                {f.c.suspendido && f.c.activo && <span className="ft-chip ft-chip-roja">Suspendido</span>}
                                {f.baja && <span className="ft-chip ft-chip-gris">Baja</span>}
                              </div>
                            </td>
                            <td>
                              <Contacto c={f.c} />
                            </td>
                            <td>
                              <button type="button" className="cb-puntos" aria-label="Acciones" onClick={(e) => abrirMenu(e, f.c.id)}>
                                ⋯
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="ft-paginacion">
                    <span>
                      {filasPestana.length} cliente(s) · página {pagina} de {paginas}
                    </span>
                    {paginas > 1 && (
                      <div className="ft-paginas">
                        <button type="button" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>
                          ‹
                        </button>
                        {Array.from({ length: paginas }, (_, i) => i + 1)
                          .filter((n) => n === 1 || n === paginas || Math.abs(n - pagina) <= 2)
                          .map((n) => (
                            <button key={n} type="button" className={n === pagina ? "activa" : ""} onClick={() => setPagina(n)}>
                              {n}
                            </button>
                          ))}
                        <button type="button" disabled={pagina === paginas} onClick={() => setPagina(pagina + 1)}>
                          ›
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Promesas de pago */}
            <div className="ft-card">
              <div className="ft-res-cab">
                <div>
                  <p className="ft-titulo">Promesas de pago</p>
                  <p className="ft-sub">Lo que los clientes dijeron que iban a pagar y cuándo.</p>
                </div>
                <button type="button" className="ft-btn-sec" onClick={() => setVerTodasPromesas((v) => !v)}>
                  {verTodasPromesas ? "Ver solo activas" : "Ver todas"}
                </button>
              </div>
              {promesasVisibles.length === 0 ? (
                <div className="ft-vacio">
                  {verTodasPromesas ? "Sin promesas registradas" : "Sin promesas activas. Regístralas desde los ⋯ de cada cliente."}
                </div>
              ) : (
                <div className="ft-tabla-wrap">
                  <table className="ft-tabla" style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th className="ft-num">Monto</th>
                        <th>Fecha prometida</th>
                        <th>Último contacto</th>
                        <th>Próxima acción</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {promesasVisibles.map((p) => {
                        const c = clientePorId.get(p.user_id);
                        return (
                          <tr key={p.id}>
                            <td>
                              <div className="cb-cliente">{c ? nombreDe(c) : "—"}</div>
                              {p.nota && <div className="cb-cliente-sub">{p.nota}</div>}
                            </td>
                            <td className="ft-num ft-nowrap">{p.monto != null ? moneda(Number(p.monto)) : "—"}</td>
                            <td className="ft-nowrap" style={{ color: p.estado === "activa" && p.fecha_promesa < hoy ? "#b42323" : undefined }}>
                              {fechaCorta(p.fecha_promesa)}
                            </td>
                            <td className="ft-nowrap">
                              {fechaCorta(p.fecha_contacto)} · {MEDIOS[p.medio] || p.medio}
                            </td>
                            <td>{proximaAccion(p)}</td>
                            <td>
                              {p.estado === "activa" && (
                                <div className="ft-res-botones" style={{ flexWrap: "nowrap" }}>
                                  <button type="button" className="ft-btn-sec" onClick={() => cambiarPromesa(p.id, "cumplida")}>
                                    Cumplida
                                  </button>
                                  <button type="button" className="ft-btn-sec" onClick={() => cambiarPromesa(p.id, "incumplida")}>
                                    No cumplió
                                  </button>
                                  <button type="button" className="ft-btn-sec" onClick={() => cambiarPromesa(p.id, "cancelada")}>
                                    Cancelar
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Exportación y reportes */}
            <div className="ft-card">
              <div className="ft-res-cab">
                <div>
                  <p className="ft-titulo">Exportación y reportes</p>
                  <p className="ft-sub">Descarga en Excel con los filtros que tienes puestos ({textoPeriodo.toLowerCase()}).</p>
                </div>
              </div>
              <div className="cb-reportes">
                <button type="button" className="cb-reporte" onClick={exportarCartera}>
                  <b>Cartera por cliente</b>
                  <span>Saldo, vencido, fecha límite, días de atraso y estado de los clientes de la lista.</span>
                </button>
                <button type="button" className="cb-reporte" onClick={exportarCargos}>
                  <b>Detalle de cargos pendientes</b>
                  <span>Cada cargo con su concepto, categoría, folio, monto y fecha límite.</span>
                </button>
                <button type="button" className="cb-reporte" onClick={exportarPromesas}>
                  <b>Promesas de pago</b>
                  <span>Todas las promesas, con el día en que se hicieron y si se cumplieron.</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Menú ⋯ de cada cliente */}
      {menu && menuFila && (
        <>
          <div className="cb-capa" onClick={() => setMenu(null)} />
          <div className="cb-menu" style={{ top: menu.top, left: menu.left }}>
            <button type="button" disabled={!puedeRegistrar || menuFila.saldo <= 0} onClick={() => abrirPagado(menuFila.c)}>
              Pagado (subir comprobante)
            </button>
            <button type="button" onClick={() => abrirPromesa(menuFila)}>
              Promesa de pago
            </button>
            <button type="button" disabled={!puedeRegistrar || !correoVisible(menuFila.c.email)} onClick={() => abrirRecordatorio([menuFila.c.id])}>
              Enviar recordatorio
            </button>
            <a href={`/facturas-admin/estados-de-cuenta?cliente=${menuFila.c.id}`}>Ver estados de cuenta</a>
            <a href={`/facturas-admin/timbradas?cliente=${menuFila.c.id}${menuFila.c.centro ? "&centro=" + encodeURIComponent(menuFila.c.centro) : ""}`}>
              Ver facturas timbradas
            </a>
          </div>
        </>
      )}

      {/* Pagado */}
      {pagado && datos && (
        <div className="modal-overlay" onClick={() => !pagado.guardando && setPagado(null)}>
          <div className="modal-card cb-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <p className="cb-modal-titulo">Registrar pago</p>
              <p className="cb-modal-sub">{nombreDe(pagado.cliente)}</p>
            </div>
            <p className="cb-nota">Marca lo que pagó el cliente. Esto no timbra factura: finanzas la emite al integrar.</p>
            <div className="cb-lista">
              {datos.cargos
                .filter((x) => x.userId === pagado.cliente.id)
                .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))
                .map((x) => (
                  <label key={x.id}>
                    <input
                      type="checkbox"
                      checked={pagado.seleccion.includes(x.id)}
                      onChange={(e) =>
                        setPagado({
                          ...pagado,
                          seleccion: e.target.checked ? [...pagado.seleccion, x.id] : pagado.seleccion.filter((s) => s !== x.id),
                        })
                      }
                    />
                    <span>
                      {x.concepto}
                      <small>
                        {[x.folio, "Fecha límite " + fechaCorta(x.fechaLimite)].filter(Boolean).join(" · ")}
                        {x.comprobanteUrl && (
                          <>
                            {" · "}
                            <a href={x.comprobanteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              Ver comprobante del cliente
                            </a>
                          </>
                        )}
                      </small>
                    </span>
                    <b>{moneda(x.monto)}</b>
                  </label>
                ))}
            </div>
            <div className="cb-total">
              <span>Total que pagó</span>
              <span>{moneda(datos.cargos.filter((x) => pagado.seleccion.includes(x.id)).reduce((s, x) => s + x.monto, 0))}</span>
            </div>
            <div className="cb-dos">
              <label className="ft-campo">
                <span>Fecha del pago</span>
                <input type="date" value={pagado.fecha} max={hoy} onChange={(e) => setPagado({ ...pagado, fecha: e.target.value })} />
              </label>
              <label className="ft-campo">
                <span>Forma de pago</span>
                <select value={pagado.forma} onChange={(e) => setPagado({ ...pagado, forma: e.target.value })}>
                  <option value="">Elige…</option>
                  {FORMAS_PAGO.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="ft-campo">
              <span>Comprobante (imagen o PDF)</span>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setPagado({ ...pagado, archivo: e.target.files?.[0] || null })} />
            </label>
            {pagado.error && <p className="cb-error">{pagado.error}</p>}
            <div className="cb-botones">
              <button type="button" className="ft-btn-sec" disabled={pagado.guardando} onClick={() => setPagado(null)}>
                Cancelar
              </button>
              <button type="button" className="ft-btn-buscar" disabled={pagado.guardando} onClick={guardarPagado}>
                {pagado.guardando ? "Guardando..." : "Registrar pago"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promesa de pago */}
      {promesa && (
        <div className="modal-overlay" onClick={() => !promesa.guardando && setPromesa(null)}>
          <div className="modal-card cb-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <p className="cb-modal-titulo">Promesa de pago</p>
              <p className="cb-modal-sub">{nombreDe(promesa.cliente)}</p>
            </div>
            <div className="cb-dos">
              <label className="ft-campo">
                <span>Quedó en pagar el</span>
                <input type="date" value={promesa.fechaPromesa} onChange={(e) => setPromesa({ ...promesa, fechaPromesa: e.target.value })} />
              </label>
              <label className="ft-campo">
                <span>Día en que lo dijo</span>
                <input type="date" value={promesa.fechaContacto} max={hoy} onChange={(e) => setPromesa({ ...promesa, fechaContacto: e.target.value })} />
              </label>
              <label className="ft-campo">
                <span>Monto prometido</span>
                <input type="number" min="0" step="0.01" value={promesa.monto} onChange={(e) => setPromesa({ ...promesa, monto: e.target.value })} />
              </label>
              <label className="ft-campo">
                <span>¿Por dónde lo dijo?</span>
                <select value={promesa.medio} onChange={(e) => setPromesa({ ...promesa, medio: e.target.value })}>
                  {Object.entries(MEDIOS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="ft-campo">
              <span>Nota (opcional)</span>
              <textarea rows={3} value={promesa.nota} onChange={(e) => setPromesa({ ...promesa, nota: e.target.value })} />
            </label>
            {promesa.error && <p className="cb-error">{promesa.error}</p>}
            <div className="cb-botones">
              <button type="button" className="ft-btn-sec" disabled={promesa.guardando} onClick={() => setPromesa(null)}>
                Cancelar
              </button>
              <button type="button" className="ft-btn-buscar" disabled={promesa.guardando} onClick={guardarPromesa}>
                {promesa.guardando ? "Guardando..." : "Guardar promesa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recordatorios */}
      {recordatorio && (
        <div className="modal-overlay" onClick={() => !recordatorio.enviando && setRecordatorio(null)}>
          <div className="modal-card cb-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <p className="cb-modal-titulo">Enviar recordatorio de pago</p>
              <p className="cb-modal-sub">Se manda por correo. No genera cobros ni facturas.</p>
            </div>
            <p className="cb-nota">
              Los recordatorios automáticos siguen saliendo solos (2 días antes, el día de pago y el último día para pagar). Este es un
              recordatorio extra que mandas tú.
            </p>
            {recordatorio.userIds.length === 0 ? (
              <p className="cb-error">No hay clientes con saldo en la lista actual.</p>
            ) : (
              <>
                <div className="cb-total">
                  <span>
                    Para ({recordatorio.elegidos.length} de {recordatorio.userIds.length})
                  </span>
                  {recordatorio.userIds.length > 1 && (
                    <button
                      type="button"
                      className="ft-btn-sec"
                      onClick={() =>
                        setRecordatorio({
                          ...recordatorio,
                          elegidos: recordatorio.elegidos.length === recordatorio.userIds.length ? [] : recordatorio.userIds,
                        })
                      }
                    >
                      {recordatorio.elegidos.length === recordatorio.userIds.length ? "Quitar todos" : "Elegir todos"}
                    </button>
                  )}
                </div>
                <div className="cb-lista" style={{ maxHeight: 180 }}>
                  {recordatorio.userIds.map((id) => {
                    const f = filas.find((x) => x.c.id === id);
                    const c = clientePorId.get(id);
                    if (!c) return null;
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={recordatorio.elegidos.includes(id)}
                          onChange={(e) =>
                            setRecordatorio({
                              ...recordatorio,
                              elegidos: e.target.checked ? [...recordatorio.elegidos, id] : recordatorio.elegidos.filter((s) => s !== id),
                            })
                          }
                        />
                        <span>
                          {nombreDe(c)}
                          <small>{correoVisible(c.email) || "Sin correo"}</small>
                        </span>
                        <b>{f ? moneda(f.saldo) : ""}</b>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <label className="ft-campo">
              <span>Asunto</span>
              <input value={recordatorio.asunto} onChange={(e) => setRecordatorio({ ...recordatorio, asunto: e.target.value })} />
            </label>
            <label className="ft-campo">
              <span>Mensaje</span>
              <textarea rows={8} value={recordatorio.mensaje} onChange={(e) => setRecordatorio({ ...recordatorio, mensaje: e.target.value })} />
            </label>
            <p className="cb-nota" style={{ marginTop: -4 }}>
              Puedes usar <b>{"{nombre}"}</b>, <b>{"{saldo}"}</b> y <b>{"{fecha_limite}"}</b>: se cambian por los datos de cada cliente.
            </p>
            {recordatorio.error && <p className="cb-error">{recordatorio.error}</p>}
            <div className="cb-botones">
              <button type="button" className="ft-btn-sec" disabled={recordatorio.enviando} onClick={() => setRecordatorio(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ft-btn-buscar"
                disabled={recordatorio.enviando || recordatorio.elegidos.length === 0}
                onClick={enviarRecordatorio}
              >
                {recordatorio.enviando ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && <div className="cb-aviso">{aviso}</div>}
    </div>
  );
}

function Contacto({ c }: { c: ClienteCobranza }) {
  const digitos = (c.telefono || "").replace(/\D/g, "");
  const whatsapp = digitos.length >= 10 ? (digitos.length === 10 ? "52" + digitos : digitos) : "";
  return (
    <div className="cb-contacto">
      {whatsapp ? (
        <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" title="WhatsApp">
          <IconoWhatsapp />
        </a>
      ) : (
        <span className="cb-off" title="Sin teléfono">
          <IconoWhatsapp />
        </span>
      )}
      {digitos ? (
        <a href={`tel:${digitos}`} title={"Llamar " + c.telefono}>
          <IconoTelefono />
        </a>
      ) : (
        <span className="cb-off" title="Sin teléfono">
          <IconoTelefono />
        </span>
      )}
      {correoVisible(c.email) ? (
        <a href={`mailto:${c.email}`} title={c.email}>
          <IconoCorreo />
        </a>
      ) : (
        <span className="cb-off" title="Sin correo">
          <IconoCorreo />
        </span>
      )}
    </div>
  );
}

function IconoFiltro() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
    </svg>
  );
}
function IconoCampana() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function IconoWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}
function IconoTelefono() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}
function IconoCorreo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}
