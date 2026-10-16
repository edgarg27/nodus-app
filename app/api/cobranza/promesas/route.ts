import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";

// En Cobranza el rol "cobranza" ve todos los centros (igual que la página).
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];
const MEDIOS = ["whatsapp", "llamada", "correo", "en_persona", "otro"];
const ESTADOS = ["activa", "cumplida", "incumplida", "cancelada"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function quienSoy() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  return yo ? { id: session.user.id, rol: yo.rol as string, centro: yo.centro as string | null } : null;
}

// Promesa de pago: lo que el cliente dijo que iba a pagar, la fecha en que quedó y el día que lo dijo.
export async function POST(req: NextRequest) {
  const yo = await quienSoy();
  if (!yo) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!rolPuede(yo.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const userId = typeof b.userId === "string" ? b.userId : "";
  const fechaPromesa = typeof b.fechaPromesa === "string" && FECHA.test(b.fechaPromesa) ? b.fechaPromesa : "";
  const fechaContacto = typeof b.fechaContacto === "string" && FECHA.test(b.fechaContacto) ? b.fechaContacto : "";
  const medio = MEDIOS.includes(b.medio) ? b.medio : "";
  const monto = b.monto === "" || b.monto == null ? null : Number(b.monto);
  const nota = typeof b.nota === "string" ? b.nota.trim().slice(0, 500) : "";
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });
  if (!fechaPromesa) return NextResponse.json({ error: "Elige la fecha en que quedó en pagar" }, { status: 400 });
  if (!fechaContacto) return NextResponse.json({ error: "Elige el día en que lo dijo" }, { status: 400 });
  if (!medio) return NextResponse.json({ error: "Elige por qué medio lo dijo" }, { status: 400 });
  if (monto !== null && !(monto > 0)) return NextResponse.json({ error: "El monto debe ser mayor a cero" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, yo.rol, yo.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok && !ROLES_GLOBALES.includes(yo.rol)) return NextResponse.json({ error: "No puedes registrar promesas de clientes de otro centro" }, { status: 403 });

  const { data, error } = await admin
    .from("promesas_pago")
    .insert({ user_id: userId, centro: acceso.cliente.centro, monto, fecha_promesa: fechaPromesa, fecha_contacto: fechaContacto, medio, nota: nota || null, creado_por: yo.id })
    .select("id")
    .single();
  if (error) {
    const falta = /promesas_pago/.test(error.message) && /exist|schema/i.test(error.message);
    return NextResponse.json({ error: falta ? "Falta correr la migración de promesas de pago" : "No se pudo guardar la promesa" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

// Cambiar el estado de una promesa (cumplida, incumplida o cancelada).
export async function PATCH(req: NextRequest) {
  const yo = await quienSoy();
  if (!yo) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!rolPuede(yo.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string" || !ESTADOS.includes(b.estado)) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const admin = createAdminClient();
  const { data: p } = await admin.from("promesas_pago").select("user_id").eq("id", b.id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Promesa no encontrada" }, { status: 404 });
  const acceso = await accesoCliente(admin, yo.rol, yo.centro, p.user_id);
  if (!acceso.ok && !ROLES_GLOBALES.includes(yo.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { error } = await admin.from("promesas_pago").update({ estado: b.estado }).eq("id", b.id);
  if (error) return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
