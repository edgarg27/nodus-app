import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { emitirComplementoPago } from "@/lib/complementoPago";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Emite UN complemento de pago que cubre una o varias facturas (PPD) de un mismo cliente.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { userId, items, formaPago, fecha, numeroOperacion, notas, comprobanteUrl } = await req.json();
  if (
    typeof userId !== "string" ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 50 ||
    items.some((i: any) => typeof i?.facturaId !== "string" || typeof i?.importe !== "number" || !Number.isFinite(i.importe))
  ) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }
  if (typeof formaPago !== "string" || typeof fecha !== "string") {
    return NextResponse.json({ error: "Falta la forma o la fecha de pago" }, { status: 400 });
  }

  // El comprobante se sube desde la pantalla al almacenamiento de este proyecto; solo se acepta esa ruta.
  if (comprobanteUrl != null && comprobanteUrl !== "") {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/`;
    if (typeof comprobanteUrl !== "string" || !comprobanteUrl.startsWith(base)) {
      return NextResponse.json({ error: "Comprobante no válido" }, { status: 400 });
    }
  }
  if ((numeroOperacion != null && typeof numeroOperacion !== "string") || (notas != null && typeof notas !== "string")) {
    return NextResponse.json({ error: "Datos del pago no válidos" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const ids = items.map((i: any) => i.facturaId);
    const { data: filas } = await admin.from("facturas").select("id, centro").in("id", ids);
    const todasDelCentro = !!filas && filas.length === ids.length && filas.every((f) => f.centro === miProfile!.centro);
    if (!todasDelCentro) {
      return NextResponse.json({ error: "No puedes emitir complementos de facturas de otro centro" }, { status: 403 });
    }
  }

  const r = await emitirComplementoPago(admin, {
    userId,
    items: items.map((i: any) => ({ facturaId: i.facturaId, importe: i.importe })),
    formaPago,
    fecha,
    usuarioId: session.user.id,
    numeroOperacion: numeroOperacion || null,
    notas: notas || null,
    comprobanteUrl: comprobanteUrl || null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, complementoId: r.complementoId, uuid: r.uuid });
}
