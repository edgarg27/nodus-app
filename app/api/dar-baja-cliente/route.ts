import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase
    .from("profiles")
    .select("rol, centro")
    .eq("id", session.user.id)
    .single();

  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { clienteId, debe, montoAdeudado, fechaBaja } = await req.json();
  if (!clienteId) {
    return NextResponse.json({ error: "Falta clienteId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: cliente } = await admin
    .from("profiles")
    .select("id, centro, nombre, email, empresa")
    .eq("id", clienteId)
    .single();
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  if (miProfile.rol !== "sistemas" && miProfile.rol !== "superadmin", "gerente" && miProfile.centro !== cliente.centro) {
    return NextResponse.json({ error: "No puedes dar de baja clientes de otro centro" }, { status: 403 });
  }

  const fechaBajaFinal = fechaBaja || new Date().toISOString().split("T")[0];
  const estatusFinal = debe ? "inactivo_debe" : "inactivo_pagado";

  // 1) Guardar en los contratos una copia de los datos del cliente
  //    para que sigan siendo legibles cuando ya no exista el perfil,
  //    marcar el estatus final, cuánto debe si aplica, y la fecha real
  //    en que dejó el espacio.
  await admin
    .from("contratos")
    .update({
      cliente_nombre_historico: cliente.nombre,
      cliente_email_historico: cliente.email,
      cliente_empresa_historico: cliente.empresa,
      estatus: estatusFinal,
      monto_adeudado: debe ? Number(montoAdeudado) || 0 : 0,
      fecha_baja: fechaBajaFinal,
    })
    .eq("user_id", clienteId)
    .eq("estatus", "vigente");

  // 2) Si tenía extensión/DID asignado, avisar a sistemas ANTES de
  //    borrarla, para que la liberen del lado del conmutador real.
  const { data: extensionesCliente } = await admin
    .from("extensiones")
    .select("extension, did, centro")
    .eq("user_id", clienteId);

  if (extensionesCliente && extensionesCliente.length > 0) {
    for (const ext of extensionesCliente) {
      await admin.from("notificaciones").insert({
        centro: ext.centro || cliente.centro,
        tipo: "baja_extension",
        mensaje: `${cliente.nombre} fue dado de baja y tenía la extensión ${ext.extension}${
          ext.did ? ` (DID ${ext.did})` : ""
        } asignada — libérala en el conmutador.`,
      });
    }
  }

  // 3) Borrar todo lo que le pertenecía: tickets, reservaciones, extensiones
  await admin.from("tickets").delete().eq("user_id", clienteId);
  await admin.from("reservaciones").delete().eq("user_id", clienteId);
  await admin.from("extensiones").delete().eq("user_id", clienteId);

  // 4) Borrar el perfil de verdad
  await admin.from("profiles").delete().eq("id", clienteId);

  // 5) Borrar la cuenta de acceso de verdad (Authentication)
  await admin.auth.admin.deleteUser(clienteId);

  return NextResponse.json({ ok: true });
}
