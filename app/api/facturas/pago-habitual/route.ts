import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import { esFormaPagoHabitual, esMetodoPago } from "@/lib/pagoHabitual";

// Configuración fiscal → "Pago habitual": cómo paga normalmente el cliente (método PUE/PPD y forma de pago del SAT).
// Vacío = sin preferencia (se usa lo de siempre).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "facturaEmitir")) return NextResponse.json({ error: "Solo finanzas y administración pueden cambiarlo" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const userId = typeof b.userId === "string" ? b.userId : "";
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });
  const metodo = b.metodo ? String(b.metodo) : "";
  const forma = b.forma ? String(b.forma) : "";
  if (metodo && !esMetodoPago(metodo)) return NextResponse.json({ error: "Método de pago no válido" }, { status: 400 });
  if (forma && !esFormaPagoHabitual(forma)) return NextResponse.json({ error: "Forma de pago no válida" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, yo!.rol, yo!.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok) return NextResponse.json({ error: "No puedes cambiar clientes de otro centro" }, { status: 403 });

  const datos = { metodo_pago_habitual: metodo || null, forma_pago_habitual: forma || null };
  const { error } = await admin.from("profiles").update(datos).eq("id", userId);
  if (error) return NextResponse.json({ error: "No se pudo guardar: " + error.message }, { status: 500 });
  return NextResponse.json({ ok: true, datos });
}
