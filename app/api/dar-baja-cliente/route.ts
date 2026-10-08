import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";

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

  if (!rolPuede(miProfile?.rol, "darBajaCliente")) {
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

  if (miProfile.rol !== "sistemas" && miProfile.rol !== "superadmin" && miProfile.rol !== "gerente" && miProfile.rol !== "gerente_ventas" && miProfile.centro !== cliente.centro) {
    return NextResponse.json({ error: "No puedes dar de baja clientes de otro centro" }, { status: 403 });
  }

  const fechaBajaFinal = fechaBaja || new Date().toISOString().split("T")[0];
  const estatusFinal = debe ? "inactivo_debe" : "inactivo_pagado";

  // "Dar de baja" ya NO borra nada: se bloquea la cuenta y todo su
  // historial (perfil, facturas, pagos, vouchers, tickets…) se queda ligado
  // a él en la base. Antes se intentaba borrar perfil y cuenta; la base lo
  // impedía (facturas/pagos ligados) y la pantalla decía "listo" igual.
  // Cada paso se revisa y, si falla, se responde qué sí se hizo.
  const hechos: string[] = [];
  function fallo(paso: string, detalle?: string) {
    const yaHecho = hechos.length > 0 ? ` Sí se hizo: ${hechos.join("; ")}.` : "";
    return NextResponse.json(
      { error: `No se pudo terminar la baja: falló "${paso}".${yaHecho}${detalle ? ` Detalle: ${detalle}` : ""}` },
      { status: 500 }
    );
  }

  // 1) Contrato: copia de los datos del cliente (para leerlo aunque cambie
  //    el perfil), estatus final, cuánto debe y fecha real de salida.
  //    inactivo_debe pasa solo a inactivo_pagado cuando ya no tiene pagos
  //    pendientes (cron diario, ver cerrarBajasPagadas).
  const { data: contratosDelCliente, error: errContrato } = await admin
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
    .eq("estatus", "vigente")
    .select("oficina_id");
  if (errContrato) return fallo("marcar el contrato como dado de baja", errContrato.message);
  hechos.push("contrato marcado como dado de baja");

  // 1.1) Liberar la(s) oficina(s) que tenía (y cualquiera que lo tuviera
  //      como cliente), para que se puedan volver a rentar.
  const oficinaIds = (contratosDelCliente || []).map((c) => c.oficina_id).filter(Boolean);
  if (oficinaIds.length > 0) {
    const { error } = await admin.from("oficinas").update({ estado: "disponible", cliente_id: null }).in("id", oficinaIds);
    if (error) return fallo("liberar su oficina", error.message);
  }
  await admin.from("oficinas").update({ estado: "disponible", cliente_id: null }).eq("cliente_id", clienteId);
  hechos.push("oficina liberada");

  // 2) Extensión/DID: avisar a sistemas para que la libere en el
  //    conmutador y quitarla (es lo único que se borra: es una línea que
  //    se le asigna a otro).
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
    const { error } = await admin.from("extensiones").delete().eq("user_id", clienteId);
    if (error) return fallo("quitar su extensión", error.message);
    hechos.push("extensión liberada");
  }

  // 3) Reservaciones futuras: se cancelan (no se borran) para liberar esos
  //    horarios; las pasadas se quedan como están.
  {
    const hoy = new Date().toISOString().split("T")[0];
    const { error } = await admin
      .from("reservaciones")
      .update({ estado: "cancelada" })
      .eq("user_id", clienteId)
      .gte("fecha", hoy)
      .in("estado", ["pendiente", "confirmada"]);
    if (error) return fallo("cancelar sus reservaciones futuras", error.message);
    hechos.push("reservaciones futuras canceladas");
  }

  // 4) Bloquear: el perfil queda inactivo (sale de las listas de clientes)
  //    y la cuenta de acceso queda vetada (no puede iniciar sesión ni
  //    renovar la que tenga abierta).
  {
    const { error } = await admin.from("profiles").update({ activo: false }).eq("id", clienteId);
    if (error) return fallo("marcar su perfil como inactivo", error.message);
  }
  {
    const { error } = await admin.auth.admin.updateUserById(clienteId, { ban_duration: "876000h" });
    if (error) return fallo("bloquear su cuenta de acceso", error.message);
  }

  return NextResponse.json({ ok: true });
}
