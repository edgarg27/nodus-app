import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { enviarGraciasPorPago } from "@/lib/correosPagos";
import { complementoAlPagar } from "@/lib/facturapi";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "cobranza", "gerente_ventas"];
const FORMAS = ["01", "02", "03", "04", "28"];
const FORMA_A_METODO: Record<string, string> = { "01": "cash", "02": "bank_account", "03": "bank_account", "04": "card", "28": "card" };

// Cobranza → "Pagado": registra que el cliente pagó ciertos cargos, con la fecha, la forma de pago y el
// comprobante. No timbra factura (eso lo hace finanzas); si el cargo ya estaba en una factura PPD se emite su
// complemento de pago.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "pagosMarcarPagado")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const pagoIds: string[] = Array.isArray(b.pagoIds) ? b.pagoIds.filter((x: unknown) => typeof x === "string") : [];
  const facturaIds: string[] = Array.isArray(b.facturaIds) ? b.facturaIds.filter((x: unknown) => typeof x === "string") : [];
  const fecha: string = typeof b.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : "";
  const formaPago: string = FORMAS.includes(b.formaPago) ? b.formaPago : "";
  const comprobanteUrl: string | null = typeof b.comprobanteUrl === "string" && b.comprobanteUrl ? b.comprobanteUrl : null;
  if (pagoIds.length + facturaIds.length === 0) return NextResponse.json({ error: "Elige qué pagó el cliente" }, { status: 400 });
  if (!fecha) return NextResponse.json({ error: "Elige la fecha del pago" }, { status: 400 });
  if (!formaPago) return NextResponse.json({ error: "Elige la forma de pago" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: pagos }, { data: facturas }] = await Promise.all([
    pagoIds.length ? admin.from("pagos").select("id, user_id, estado, centro, adicional_tipo").in("id", pagoIds) : Promise.resolve({ data: [] as any[] }),
    facturaIds.length ? admin.from("facturas").select("id, user_id, estado, centro").in("id", facturaIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  if (!ROLES_GLOBALES.includes(yo!.rol)) {
    const todos = [...(pagos || []), ...(facturas || [])];
    if (todos.some((x) => x.centro && x.centro !== yo!.centro)) return NextResponse.json({ error: "No puedes registrar pagos de otro centro" }, { status: 403 });
  }

  let registrados = 0;
  for (const p of pagos || []) {
    if (p.estado === "pagado") continue;
    const { error } = await admin
      .from("pagos")
      .update({ estado: "pagado", fecha_pago: fecha, ...(comprobanteUrl ? { comprobante_url: comprobanteUrl } : {}) })
      .eq("id", p.id);
    if (error) continue;
    registrados++;
    // Forma de pago (columna de migracion_cobranza_promesas.sql; si aún no existe, no pasa nada).
    await admin.from("pagos").update({ forma_pago: formaPago }).eq("id", p.id);
    // Pagar lo que se debe (no un adicional) reactiva una cuenta suspendida, igual que "marcar pagado".
    if (p.user_id && !p.adicional_tipo) await admin.from("profiles").update({ suspendido: false }).eq("id", p.user_id);
    await enviarGraciasPorPago(admin, p.id);
    await complementoAlPagar(admin, p.id, FORMA_A_METODO[formaPago]);
  }
  for (const f of facturas || []) {
    if (f.estado === "pagada") continue;
    const { error } = await admin.from("facturas").update({ estado: "pagada" }).eq("id", f.id);
    if (!error) registrados++;
  }
  return NextResponse.json({ ok: true, registrados });
}
