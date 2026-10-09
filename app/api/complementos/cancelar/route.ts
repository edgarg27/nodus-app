import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { cancelarComplemento } from "@/lib/complementoPago";
import { MOTIVOS_CANCELACION } from "@/lib/facturapiCancelacion";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Cancela ante el SAT un complemento de pago. Al cancelarse, lo que cubría vuelve al saldo de sus facturas.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaCancelar")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { complementoId, motivo, sustitutaUuid } = await req.json();
  if (typeof complementoId !== "string") return NextResponse.json({ error: "Falta el complemento" }, { status: 400 });
  if (!motivo || !MOTIVOS_CANCELACION[motivo]) return NextResponse.json({ error: "Elige el motivo de cancelación" }, { status: 400 });
  const sustituta = typeof sustitutaUuid === "string" ? sustitutaUuid.trim() : "";
  if (motivo === "01" && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sustituta)) {
    return NextResponse.json({ error: "Con el motivo 01 hay que indicar el UUID del complemento que lo sustituye" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const { data: c } = await admin.from("complementos_pago").select("centro").eq("id", complementoId).maybeSingle();
    if (!c || c.centro !== miProfile!.centro) {
      return NextResponse.json({ error: "No puedes cancelar complementos de otro centro" }, { status: 403 });
    }
  }

  const r = await cancelarComplemento(admin, complementoId, { motivo, sustitutaUuid: sustituta || null, usuarioId: session.user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, estatus: r.estatus });
}
