import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Contabilidad (rol "gastos") marca un gasto como pagado (fecha y, si quiere, comprobante)
// o como "no se paga" (con motivo). Va por el servidor para que nadie más pueda cambiar
// el estado de pago: el rol "gastos" solo tiene permiso de LEER la tabla, y la base no deja
// cambiar un gasto ya revisado (trigger gastos_candado_revisado, migracion_rol_gastos.sql).
// A quien registró el gasto le llega el aviso.
const ROLES = ["gastos", "superadmin", "gerente"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ARCHIVO = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, nombre").eq("id", session.user.id).single();
  if (!yo || !ROLES.includes(yo.rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const id = String(form.get("id") || "");
  const estado = String(form.get("estado") || "");
  const fechaPago = String(form.get("fecha_pago") || "");
  const motivo = String(form.get("motivo") || "").trim().slice(0, 500);
  const comprobante = form.get("comprobante");

  if (!id || !["pagado", "no_pagado", "pendiente"].includes(estado)) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  if (estado === "pagado" && !FECHA.test(fechaPago)) return NextResponse.json({ error: "Pon la fecha de pago" }, { status: 400 });
  if (estado === "no_pagado" && !motivo) return NextResponse.json({ error: "Escribe el motivo" }, { status: 400 });

  const admin = createAdminClient();
  const { data: gasto } = await admin
    .from("gastos")
    .select("id, concepto, monto, centro, registrado_por, comprobante_pago_url")
    .eq("id", id)
    .maybeSingle();
  if (!gasto) return NextResponse.json({ error: "No se encontró el gasto" }, { status: 404 });

  let comprobanteUrl: string | null = gasto.comprobante_pago_url || null;
  if (estado === "pagado" && comprobante instanceof File && comprobante.size > 0) {
    if (comprobante.size > MAX_ARCHIVO) return NextResponse.json({ error: "El comprobante pesa más de 10 MB" }, { status: 400 });
    const ext = (comprobante.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const nombre = `pago-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("comprobantes")
      .upload(nombre, Buffer.from(await comprobante.arrayBuffer()), { contentType: comprobante.type || undefined, upsert: true });
    if (upErr) return NextResponse.json({ error: "No se pudo subir el comprobante" }, { status: 500 });
    comprobanteUrl = admin.storage.from("comprobantes").getPublicUrl(nombre).data.publicUrl;
  }

  // "pendiente" deshace una revisión (por si se marcó por error).
  const cambios =
    estado === "pendiente"
      ? { estado_pago: "pendiente", fecha_pago: null, motivo_no_pago: null, revisado_por: null, revisado_por_nombre: null, revisado_at: null }
      : {
          estado_pago: estado,
          fecha_pago: estado === "pagado" ? fechaPago : null,
          motivo_no_pago: estado === "no_pagado" ? motivo : null,
          comprobante_pago_url: comprobanteUrl,
          revisado_por: session.user.id,
          revisado_por_nombre: yo.nombre || null,
          revisado_at: new Date().toISOString(),
        };
  const { error: updErr } = await admin.from("gastos").update(cambios).eq("id", id);
  if (updErr) {
    console.error("[gastos/revisar]", updErr.message);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  if (estado !== "pendiente" && gasto.registrado_por) {
    const montoTxt = `$${Number(gasto.monto).toLocaleString("es-MX")}`;
    await admin.from("notificaciones").insert({
      user_id: gasto.registrado_por,
      centro: gasto.centro,
      tipo: estado === "pagado" ? "gasto_pagado" : "gasto_no_pagado",
      mensaje:
        estado === "pagado"
          ? `✅ Contabilidad pagó tu gasto "${gasto.concepto}" (${montoTxt}) el ${fechaPago}.`
          : `❌ Contabilidad no pagará tu gasto "${gasto.concepto}" (${montoTxt}). Motivo: ${motivo}`,
    });
  }

  return NextResponse.json({ ok: true, comprobante_pago_url: comprobanteUrl });
}
