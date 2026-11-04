import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import { hoyMexicoISO } from "@/lib/fechaMexico";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];

// Cobranza → ⋯ → "Suspender servicios" / "Reactivar servicios". La suspensión la deciden la admin o Cobranza: el cobro
// diario solo avisa al cliente (día de pago y día siguiente), ya no suspende solo. Al registrar su pago se reactiva
// sola (Cobranza → Pagado).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosMarcarPagado")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const userId = typeof b.userId === "string" ? b.userId : "";
  const suspender = b.suspender === true;
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, yo!.rol, yo!.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok && !ROLES_GLOBALES.includes(yo!.rol)) return NextResponse.json({ error: "No puedes cambiar clientes de otro centro" }, { status: 403 });

  const { error } = await admin
    .from("profiles")
    .update(suspender ? { suspendido: true, suspendido_desde: hoyMexicoISO() } : { suspendido: false })
    .eq("id", userId)
    .eq("rol", "cliente");
  if (error) return NextResponse.json({ error: "No se pudo actualizar: " + error.message }, { status: 500 });

  await admin.from("notificaciones").insert({
    centro: acceso.cliente.centro,
    user_id: userId,
    tipo: suspender ? "cuenta_pausada" : "pago_confirmado",
    mensaje: suspender
      ? "⚠️ Tus servicios fueron pausados por falta de pago. Comunícate con el administrador del centro."
      : "✅ Tus servicios fueron reactivados. ¡Gracias!",
  });
  return NextResponse.json({ ok: true, suspendido: suspender });
}
