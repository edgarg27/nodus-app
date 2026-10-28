import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { accesoReporte } from "@/lib/reportesAcceso";
import { hoyMexicoISO } from "@/lib/fechaMexico";

export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = { correo: "Correo", mensaje: "Mensaje", llamada: "Llamada", tour: "Tour", otro: "Otro" };

export type PersonaSeguimiento = {
  id: string;
  nombre: string;
  centro: string | null;
  prospectosRegistrados: number;
  actividadesRegistradas: number;
  hechas: number;
  atrasadas: number;
  sinContactar: number;
  ultimaActualizacion: string | null;
};

export type EventoSeguimiento = {
  id: string;
  cuando: string;
  evento: "Registró" | "Completó";
  persona: string;
  personaId: string | null;
  centro: string | null;
  prospecto: string;
  empresa: string | null;
  tipo: string;
  descripcion: string | null;
  fechaProgramada: string;
  estado: "Hecha" | "Pendiente" | "Atrasada";
};

// Reporte "Seguimiento de prospectos del equipo" (/reportes): cómo va cada persona (sobre todo las administradoras)
// con el seguimiento de sus prospectos en el periodo — prospectos que registró, actividades que registró y que
// completó, las que tiene atrasadas hoy, prospectos suyos todavía sin contactar y su última actualización — y la
// lista de lo que se fue registrando (qué, cuándo, quién y la nota).
export async function GET(req: NextRequest) {
  const acceso = await accesoReporte(req);
  if ("respuesta" in acceso) return acceso.respuesta;
  const { centro, desde, hasta } = acceso;
  const ini = `${desde}T00:00:00-06:00`;
  const fin = `${hasta}T23:59:59-06:00`;
  const hoy = hoyMexicoISO();

  const admin = createAdminClient();
  let qp = admin.from("prospectos").select("id, nombre, empresa, centro, estado, registrado_por, created_at");
  if (centro) qp = qp.eq("centro", centro);
  const { data: prospectos } = await qp.limit(20000);
  const prospPorId = new Map((prospectos || []).map((p) => [p.id, p]));
  const idsProsp = Array.from(prospPorId.keys());

  // Actividades de esos prospectos (en tandas para no pasar el límite del filtro .in).
  type Actividad = {
    id: string;
    prospecto_id: string;
    tipo: string;
    tipo_otro: string | null;
    descripcion: string | null;
    fecha: string;
    completada: boolean;
    completada_en: string | null;
    completada_por: string | null;
    creado_por: string | null;
    created_at: string;
  };
  const actividades: Actividad[] = [];
  for (let i = 0; i < idsProsp.length; i += 300) {
    const { data } = await admin
      .from("prospecto_actividades")
      .select("id, prospecto_id, tipo, tipo_otro, descripcion, fecha, completada, completada_en, completada_por, creado_por, created_at")
      .in("prospecto_id", idsProsp.slice(i, i + 300));
    actividades.push(...((data || []) as Actividad[]));
  }

  const tIni = Date.parse(ini);
  const tFin = Date.parse(fin);
  const enPeriodo = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return t >= tIni && t <= tFin;
  };
  const idsPersona = new Set<string>();
  (prospectos || []).forEach((p) => p.registrado_por && idsPersona.add(p.registrado_por));
  actividades.forEach((a) => [a.creado_por, a.completada_por].forEach((x) => x && idsPersona.add(x)));
  const { data: perfiles } = idsPersona.size
    ? await admin.from("profiles").select("id, nombre, centro, rol").in("id", Array.from(idsPersona))
    : { data: [] as { id: string; nombre: string | null; centro: string | null; rol: string | null }[] };
  const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]));
  const nombre = (id: string | null) => (id && perfilPorId.get(id)?.nombre) || "Sin registrar";

  const personas = new Map<string, PersonaSeguimiento>();
  const persona = (id: string) => {
    if (!personas.has(id)) {
      const p = perfilPorId.get(id);
      personas.set(id, {
        id,
        nombre: p?.nombre || "Sin registrar",
        centro: p?.centro || null,
        prospectosRegistrados: 0,
        actividadesRegistradas: 0,
        hechas: 0,
        atrasadas: 0,
        sinContactar: 0,
        ultimaActualizacion: null,
      });
    }
    return personas.get(id) as PersonaSeguimiento;
  };
  const tocar = (id: string, iso: string | null) => {
    if (!iso) return;
    const p = persona(id);
    if (!p.ultimaActualizacion || iso > p.ultimaActualizacion) p.ultimaActualizacion = iso;
  };

  const conActividad = new Set(actividades.map((a) => a.prospecto_id));
  for (const p of prospectos || []) {
    if (!p.registrado_por) continue;
    if (enPeriodo(p.created_at)) persona(p.registrado_por).prospectosRegistrados++;
    tocar(p.registrado_por, p.created_at);
    // Suyo, todavía en "Nuevo" y sin ninguna actividad: nadie lo ha contactado.
    if (p.estado === "nuevo" && !conActividad.has(p.id)) persona(p.registrado_por).sinContactar++;
  }

  const eventos: EventoSeguimiento[] = [];
  for (const a of actividades) {
    const pr = prospPorId.get(a.prospecto_id);
    const tipo = a.tipo === "otro" && a.tipo_otro ? a.tipo_otro : TIPOS[a.tipo] || a.tipo;
    const estado: EventoSeguimiento["estado"] = a.completada ? "Hecha" : a.fecha < hoy ? "Atrasada" : "Pendiente";
    const base = {
      centro: pr?.centro || null,
      prospecto: pr?.nombre || "Prospecto",
      empresa: pr?.empresa || null,
      tipo,
      descripcion: a.descripcion,
      fechaProgramada: a.fecha,
      estado,
    };
    if (a.creado_por) {
      tocar(a.creado_por, a.created_at);
      if (enPeriodo(a.created_at)) persona(a.creado_por).actividadesRegistradas++;
      if (estado === "Atrasada") persona(a.creado_por).atrasadas++;
    }
    if (a.completada_por) {
      tocar(a.completada_por, a.completada_en);
      if (enPeriodo(a.completada_en)) persona(a.completada_por).hechas++;
    }
    if (enPeriodo(a.created_at)) {
      eventos.push({ id: `${a.id}-r`, cuando: a.created_at, evento: "Registró", persona: nombre(a.creado_por), personaId: a.creado_por, ...base });
    }
    // Completada después (otro momento que el registro): también es una actualización del seguimiento.
    if (a.completada_en && enPeriodo(a.completada_en) && a.completada_en.slice(0, 16) !== a.created_at.slice(0, 16)) {
      eventos.push({ id: `${a.id}-c`, cuando: a.completada_en, evento: "Completó", persona: nombre(a.completada_por), personaId: a.completada_por, ...base });
    }
  }

  return NextResponse.json({
    centro: centro || null,
    desde,
    hasta,
    personas: Array.from(personas.values())
      .filter((p) => p.prospectosRegistrados || p.actividadesRegistradas || p.hechas || p.atrasadas || p.sinContactar)
      .sort((a, b) => (b.ultimaActualizacion || "").localeCompare(a.ultimaActualizacion || "")),
    eventos: eventos.sort((a, b) => b.cuando.localeCompare(a.cuando)).slice(0, 500),
  });
}
