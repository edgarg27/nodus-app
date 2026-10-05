import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { conceptoCobroAdicional, tipoCobroAdicional } from "@/lib/adicionales";

// Cobros adicionales sueltos (pantalla /adicionales): una hora extra de sala,
// copias, frituras… Cada uno es un registro de `pagos` pendiente y sin factura
// (como los de Cotizar): el cliente lo ve en su estado de cuenta y lo paga con
// tarjeta, o el staff lo marca pagado en /pagos o aquí mismo. Ver
// migracion_pagos_adicionales.sql.

const round2 = (n: number) => Math.round(n * 100) / 100;

// admin solo toca clientes de su propio centro; superadmin y gerente, de todos.
function puedeTocarCentro(rol: string, miCentro: string | null | undefined, centroCliente: string | null | undefined) {
  if (rol === "superadmin" || rol === "gerente") return true;
  return !!miCentro && miCentro === centroCliente;
}

async function sesionStaff() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "adicionalesCobrar")) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  }
  return { userId: session.user.id, rol: miProfile!.rol as string, centro: (miProfile!.centro as string | null) ?? null };
}

export async function POST(req: NextRequest) {
  const s = await sesionStaff();
  if ("error" in s) return s.error;

  const { clienteId, tipo, concepto, cantidad, precioUnitario } = await req.json();

  const tipoInfo = tipoCobroAdicional(tipo);
  if (!tipoInfo) return NextResponse.json({ error: "Elige el tipo de cobro" }, { status: 400 });

  const conceptoLimpio = String(concepto || "").trim();
  if (!conceptoLimpio) return NextResponse.json({ error: "Escribe qué se está cobrando" }, { status: 400 });
  if (conceptoLimpio.length > 120) return NextResponse.json({ error: "El concepto es muy largo (máximo 120 letras)" }, { status: 400 });

  const cant = Number(cantidad);
  if (!Number.isFinite(cant) || cant <= 0 || cant > 1000) {
    return NextResponse.json({ error: "La cantidad debe ser mayor a 0" }, { status: 400 });
  }
  const precio = Number(precioUnitario);
  if (!Number.isFinite(precio) || precio <= 0 || precio > 100000) {
    return NextResponse.json({ error: "El precio debe ser mayor a 0" }, { status: 400 });
  }
  const cantidadFinal = round2(cant);
  const monto = round2(cantidadFinal * precio);
  if (monto <= 0) return NextResponse.json({ error: "El total debe ser mayor a 0" }, { status: 400 });

  if (!clienteId) return NextResponse.json({ error: "Elige al cliente" }, { status: 400 });
  const admin = createAdminClient();
  const { data: cliente } = await admin.from("profiles").select("id, rol, centro, activo").eq("id", clienteId).maybeSingle();
  if (!cliente || cliente.rol !== "cliente") return NextResponse.json({ error: "No se encontró al cliente" }, { status: 404 });
  if (cliente.activo === false) return NextResponse.json({ error: "Ese cliente está dado de baja" }, { status: 400 });
  if (!cliente.centro || !puedeTocarCentro(s.rol, s.centro, cliente.centro)) {
    return NextResponse.json({ error: "Ese cliente no es de tu centro" }, { status: 403 });
  }

  const { data: pago, error } = await admin
    .from("pagos")
    .insert({
      user_id: cliente.id,
      monto,
      concepto: conceptoCobroAdicional(conceptoLimpio, cantidadFinal),
      centro: cliente.centro,
      estado: "pendiente",
      adicional_tipo: tipoInfo.clave,
      creado_por: s.userId,
    })
    .select("id, user_id, monto, concepto, estado, created_at")
    .single();

  if (error || !pago) return NextResponse.json({ error: "No se pudo generar el cobro" }, { status: 500 });
  return NextResponse.json({ ok: true, pago });
}

// Borra un cobro adicional que se capturó por error. Solo si sigue pendiente y
// sin cargo en Openpay ni factura: uno que ya se empezó a pagar o se facturó ya
// no se toca.
export async function DELETE(req: NextRequest) {
  const s = await sesionStaff();
  if ("error" in s) return s.error;

  const { pagoId } = await req.json();
  if (!pagoId) return NextResponse.json({ error: "Falta pagoId" }, { status: 400 });

  const admin = createAdminClient();
  const { data: pago } = await admin
    .from("pagos")
    .select("id, centro, estado, adicional_tipo, openpay_charge_id, factura_id")
    .eq("id", pagoId)
    .maybeSingle();
  if (!pago || !pago.adicional_tipo) return NextResponse.json({ error: "No se encontró el cobro" }, { status: 404 });
  if (!puedeTocarCentro(s.rol, s.centro, pago.centro)) return NextResponse.json({ error: "No es de tu centro" }, { status: 403 });
  if (pago.estado !== "pendiente" || pago.openpay_charge_id || pago.factura_id) {
    return NextResponse.json({ error: "Este cobro ya no se puede eliminar porque se empezó a pagar o ya está pagado" }, { status: 409 });
  }

  const { error } = await admin.from("pagos").delete().eq("id", pago.id);
  if (error) return NextResponse.json({ error: "No se pudo eliminar el cobro" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
