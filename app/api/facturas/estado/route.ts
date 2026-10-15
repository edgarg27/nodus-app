import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { enviarCorreo } from "@/lib/email";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { etiquetaPagoSuelto } from "@/lib/adicionales";
import { complementoAlPagar } from "@/lib/facturapi";
import { esFacturaSimulada } from "@/lib/facturaSimulada";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.nodusbc.mx").replace(/\/+$/, "");
const DIAS_PARA_PAGAR = 10;
const FORMA_A_METODO: Record<string, string> = { "01": "cash", "03": "bank_account", "04": "card" };

const moneda = (n: number) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function sumarDias(iso: string, dias: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
}

// Acciones del estado de cuenta (menú Acciones): enviar por correo, editar concepto y fecha, y registrar pagos.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const cuerpo = await req.json().catch(() => ({}));
  const accion: string = cuerpo.accion;
  const facturaId: string = typeof cuerpo.facturaId === "string" ? cuerpo.facturaId : "";
  if (!facturaId) return NextResponse.json({ error: "Falta el estado de cuenta" }, { status: 400 });

  const admin = createAdminClient();
  const { data: factura } = await admin
    .from("facturas")
    .select("*")
    .eq("id", facturaId)
    .maybeSingle();
  if (!factura) return NextResponse.json({ error: "Estado de cuenta no encontrado" }, { status: 404 });
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && factura.centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes modificar estados de cuenta de otro centro" }, { status: 403 });
  }

  // ---- Enviar el estado de cuenta al correo del cliente ----
  if (accion === "enviar") {
    if (!factura.user_id) return NextResponse.json({ error: "Este estado de cuenta no tiene cliente" }, { status: 400 });
    const { data: cliente } = await admin.from("profiles").select("nombre, email, empresa, nombre_fiscal").eq("id", factura.user_id).maybeSingle();
    if (!cliente?.email) return NextResponse.json({ error: "El cliente no tiene correo registrado" }, { status: 400 });
    const { data: pagos } = await admin.from("pagos").select("concepto, monto, estado").eq("factura_id", factura.id).order("created_at", { ascending: true });
    const filas = (pagos && pagos.length > 0 ? pagos.map((p) => ({ d: etiquetaPagoSuelto(p.concepto), m: Number(p.monto) })) : [{ d: factura.concepto, m: Number(factura.monto) }])
      .map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapar(l.d)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${moneda(l.m)}</td></tr>`)
      .join("");
    const nombre = cliente.nombre_fiscal || cliente.empresa || cliente.nombre || "cliente";
    const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0d1b3e">Tu estado de cuenta ${escapar(factura.folio)}</h2>
      <p style="margin:0 0 12px;font-size:14px">Hola ${escapar(nombre)}, este es el detalle de lo que se te cobra:</p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">${escapar(factura.concepto)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${filas}
        <tr><td style="padding:8px;font-weight:700">Total</td><td style="padding:8px;text-align:right;font-weight:700">${moneda(Number(factura.monto))}</td></tr>
      </table>
      <p style="margin:12px 0;font-size:14px">Fecha: ${factura.fecha_emision} · Vence: ${factura.fecha_vencimiento}</p>
      <p style="margin:0 0 12px;font-size:14px">Puedes consultarlo y pagarlo en tu panel: <a href="${SITIO}/estado-cuenta">${SITIO}/estado-cuenta</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#888">Nodus Flex Center</p>
    </div>
  </div>`;
    const r = await enviarCorreo({ to: cliente.email, subject: `Tu estado de cuenta ${factura.folio} - Nodus`, html });
    if (!r.ok) return NextResponse.json({ error: r.error || "No se pudo enviar el correo" }, { status: 502 });
    // Cuenta el envío (columna nueva: si todavía no existe, no pasa nada).
    await admin.from("facturas").update({ envios_estado: Number((factura as any).envios_estado || 0) + 1 }).eq("id", factura.id);
    return NextResponse.json({ ok: true, correo: cliente.email });
  }

  // ---- Editar concepto y fecha (solo mientras no esté timbrada) ----
  if (accion === "editar") {
    if (factura.uuid_cfdi) return NextResponse.json({ error: "Ya está timbrada: el concepto y la fecha ya no se pueden cambiar" }, { status: 409 });
    if (factura.estado === "cancelada") return NextResponse.json({ error: "El estado de cuenta está cancelado" }, { status: 409 });
    const concepto = typeof cuerpo.concepto === "string" ? cuerpo.concepto.trim().slice(0, 200) : "";
    const fecha = typeof cuerpo.fecha === "string" ? cuerpo.fecha : "";
    if (!concepto || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: "Escribe el concepto y elige la fecha" }, { status: 400 });
    const { error } = await admin.from("facturas").update({ concepto, fecha_emision: fecha, fecha_vencimiento: sumarDias(fecha, DIAS_PARA_PAGAR) }).eq("id", factura.id);
    if (error) return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---- Registrar pago: marca como pagados los pagos elegidos de este estado de cuenta ----
  if (accion === "pago") {
    if (!rolPuede(miProfile?.rol, "pagosMarcarPagado")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    const pagoIds: string[] = Array.isArray(cuerpo.pagoIds) ? cuerpo.pagoIds.filter((x: unknown) => typeof x === "string") : [];
    const formaPago: string = typeof cuerpo.formaPago === "string" ? cuerpo.formaPago : "";
    if (pagoIds.length === 0) return NextResponse.json({ error: "Elige al menos un pago" }, { status: 400 });
    if (!FORMA_A_METODO[formaPago]) return NextResponse.json({ error: "Elige cómo pagó el cliente" }, { status: 400 });
    const { data: pagos } = await admin.from("pagos").select("id, estado").in("id", pagoIds).eq("factura_id", factura.id);
    const pendientes = (pagos || []).filter((p) => p.estado !== "pagado");
    if (pendientes.length === 0) return NextResponse.json({ error: "Esos pagos ya estaban pagados" }, { status: 409 });
    const { error } = await admin.from("pagos").update({ estado: "pagado", fecha_pago: hoyMexicoISO() }).in("id", pendientes.map((p) => p.id));
    if (error) return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
    // Si la factura ya se timbró a pago diferido, cada pago se cubre con su complemento de pago.
    if (factura.uuid_cfdi && factura.metodo_pago === "PPD" && !esFacturaSimulada(factura.uuid_cfdi)) {
      for (const p of pendientes) await complementoAlPagar(admin, p.id, FORMA_A_METODO[formaPago]);
    }
    return NextResponse.json({ ok: true, registrados: pendientes.length, complemento: !!factura.uuid_cfdi && factura.metodo_pago === "PPD" });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}
