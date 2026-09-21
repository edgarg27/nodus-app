import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

// Un cliente (con sesión) registra o cancela una visita para que recepción
// la espere. Las escrituras pasan por aquí para validar fecha/hora en el
// servidor y llenar centro y datos del cliente.
const MAX_VISITAS_FUTURAS = 20;
const MAX_DIAS_ADELANTE = 90;

// Fecha y hora de hoy en horario de México ('YYYY-MM-DD' y 'HH:MM').
function ahoraMexico() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => partes.find((p) => p.type === t)?.value || "";
  const hora = g("hour") === "24" ? "00" : g("hour");
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${hora}:${g("minute")}` };
}

function sumarDias(fechaISO: string, dias: number) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + dias));
  return f.toISOString().split("T")[0];
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre || "").trim().slice(0, 120);
  const empresa = String(body?.empresa || "").trim().slice(0, 120);
  const telefono = String(body?.telefono || "").trim().slice(0, 30);
  const motivo = String(body?.motivo || "").trim().slice(0, 300);
  const fecha = String(body?.fecha || "");
  const hora = String(body?.hora || "");

  if (!nombre) return NextResponse.json({ error: "Escribe el nombre del visitante" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "Fecha no válida" }, { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return NextResponse.json({ error: "Hora no válida" }, { status: 400 });

  const hoy = ahoraMexico();
  if (fecha < hoy.fecha) return NextResponse.json({ error: "La fecha ya pasó" }, { status: 400 });
  if (fecha > sumarDias(hoy.fecha, MAX_DIAS_ADELANTE)) {
    return NextResponse.json({ error: `Solo puedes registrar visitas de los próximos ${MAX_DIAS_ADELANTE} días` }, { status: 400 });
  }
  if (fecha === hoy.fecha && hora < hoy.hora) {
    return NextResponse.json({ error: "Esa hora de hoy ya pasó" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("profiles")
    .select("id, rol, nombre, empresa, centro, numero_oficina")
    .eq("id", session.user.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== "cliente") {
    return NextResponse.json({ error: "Solo los clientes pueden registrar visitas" }, { status: 403 });
  }
  if (!perfil.centro) {
    return NextResponse.json({ error: "Tu cuenta no tiene un centro asignado. Contacta a recepción." }, { status: 400 });
  }

  const { count } = await admin
    .from("visitas_cliente")
    .select("id", { count: "exact", head: true })
    .eq("user_id", perfil.id)
    .eq("estado", "esperada")
    .gte("fecha", hoy.fecha);
  if ((count || 0) >= MAX_VISITAS_FUTURAS) {
    return NextResponse.json({ error: "Tienes demasiadas visitas pendientes. Cancela alguna e intenta de nuevo." }, { status: 400 });
  }

  const { error: insertError } = await admin.from("visitas_cliente").insert({
    user_id: perfil.id,
    centro: perfil.centro,
    visitante_nombre: nombre,
    visitante_empresa: empresa || null,
    visitante_telefono: telefono || null,
    fecha,
    hora,
    motivo: motivo || null,
    cliente_nombre: perfil.nombre,
    cliente_empresa: perfil.empresa,
    numero_oficina: perfil.numero_oficina,
  });
  if (insertError) {
    return NextResponse.json({ error: "No se pudo registrar la visita: " + insertError.message }, { status: 500 });
  }

  await admin.from("notificaciones").insert({
    centro: perfil.centro,
    tipo: "visita_cliente",
    mensaje: `🚪 ${perfil.nombre || "Un cliente"}${
      perfil.numero_oficina ? ` (oficina ${perfil.numero_oficina})` : ""
    } espera a ${nombre} el ${fecha} a las ${hora}.`,
  });

  return NextResponse.json({ ok: true });
}

// Cancelar una visita propia que todavía está esperada.
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "Falta la visita" }, { status: 400 });

  const admin = createAdminClient();
  const { data: visita } = await admin
    .from("visitas_cliente")
    .select("id, user_id, estado")
    .eq("id", id)
    .maybeSingle();
  if (!visita || visita.user_id !== session.user.id) {
    return NextResponse.json({ error: "Visita no encontrada" }, { status: 404 });
  }
  if (visita.estado !== "esperada") {
    return NextResponse.json({ error: "Esta visita ya no se puede cancelar" }, { status: 400 });
  }

  const { error } = await admin.from("visitas_cliente").update({ estado: "cancelada" }).eq("id", id);
  if (error) return NextResponse.json({ error: "No se pudo cancelar la visita" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
