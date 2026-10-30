import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { esCuentaDeposito } from "@/lib/cuentasDeposito";

// Corrige a qué cuenta cayó un depósito en garantía ya realizado (/deposito-garantia → "Cambiar cuenta").
// Mismos roles que marcar un pago como pagado; un admin de centro solo los de su centro.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosMarcarPagado")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { pagoId, cuentaDestino } = await req.json();
  if (!pagoId || !esCuentaDeposito(cuentaDestino)) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const admin = createAdminClient();
  const { data: pago } = await admin.from("pagos").select("id, centro").eq("id", pagoId).maybeSingle();
  if (!pago) return NextResponse.json({ error: "No se encontró el depósito" }, { status: 404 });
  if (yo?.rol === "admin" && yo.centro && pago.centro !== yo.centro) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { error } = await admin.from("pagos").update({ cuenta_destino: cuentaDestino }).eq("id", pagoId);
  if (error) {
    const falta = /cuenta_destino/.test(error.message);
    return NextResponse.json({ error: falta ? "Falta correr migracion_deposito_cuenta.sql" : "No se pudo guardar la cuenta" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
