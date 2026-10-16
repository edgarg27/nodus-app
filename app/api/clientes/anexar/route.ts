import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { accesoCliente } from "@/lib/facturasAcceso";
import type { CfdiParseado } from "@/lib/cfdi";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMAS = ["01", "02", "03", "04", "28"];

type ContratoAnexo = {
  folio?: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: number;
  deposito_garantia?: number;
  horas_sala_juntas?: number;
  dia_pago?: number | null;
  oficina_id?: string | null;
  archivo_url?: string | null;
};
type PagoAnexo = { concepto: string; monto: number; fecha: string; estado: "pagado" | "pendiente"; formaPago?: string; comprobanteUrl?: string | null };
type FacturaAnexo = { cfdi: CfdiParseado; xmlUrl: string | null; archivoUrl: string | null; estado: "pagada" | "pendiente" };

// Migración (ZORA) o alta rápida: anexa a la cuenta de un cliente su contrato (ya firmado, entra vigente y sin
// generar cobros), su historial de pagos (pagados o pendientes) y sus facturas (CFDI XML/PDF ya timbrados).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data: yo } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(yo?.rol, "crearCliente")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const userId = typeof b.userId === "string" ? b.userId : "";
  if (!userId) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 });

  const admin = createAdminClient();
  const acceso = await accesoCliente(admin, yo!.rol, yo!.centro, userId);
  if (!acceso.cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!acceso.ok) return NextResponse.json({ error: "No puedes anexar datos a clientes de otro centro" }, { status: 403 });
  const centro = acceso.cliente.centro;

  const avisos: string[] = [];
  let contratoId: string | null = null;
  let folioContrato: string | null = null;

  // ---------- Contrato ----------
  const c: ContratoAnexo | null = b.contrato && typeof b.contrato === "object" ? b.contrato : null;
  if (c) {
    if (!FECHA.test(c.fecha_inicio || "") || !FECHA.test(c.fecha_vencimiento || "")) {
      return NextResponse.json({ error: "El contrato necesita fecha de inicio y de vencimiento" }, { status: 400 });
    }
    if (!(Number(c.renta_mensual) > 0)) return NextResponse.json({ error: "El contrato necesita la renta mensual" }, { status: 400 });
    const folio = typeof c.folio === "string" && c.folio.trim() ? c.folio.trim().toUpperCase().slice(0, 40) : null;
    if (folio) {
      const { data: repetido } = await admin.from("contratos").select("id").eq("folio", folio).limit(1);
      if (repetido && repetido.length > 0) return NextResponse.json({ error: `Ya existe un contrato con el folio ${folio}` }, { status: 400 });
    }
    const { data: perfil } = await admin.from("profiles").select("rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi").eq("id", userId).maybeSingle();
    const { data: creado, error } = await admin
      .from("contratos")
      .insert({
        user_id: userId,
        centro,
        folio, // vacío: el disparador le pone el siguiente folio del centro
        fecha_inicio: c.fecha_inicio,
        fecha_vencimiento: c.fecha_vencimiento,
        renta_mensual: Number(c.renta_mensual),
        deposito_garantia: Number(c.deposito_garantia) || 0,
        horas_sala_juntas: Number(c.horas_sala_juntas) || 0,
        dia_pago: c.dia_pago ? Number(c.dia_pago) : null,
        oficina_id: c.oficina_id || null,
        archivo_url: c.archivo_url || null,
        firmado: !!c.archivo_url,
        estatus: "vigente",
        rfc: perfil?.rfc || null,
        nombre_fiscal: perfil?.nombre_fiscal || null,
        regimen_fiscal: perfil?.regimen_fiscal || null,
        cp_fiscal: perfil?.cp_fiscal || null,
        uso_cfdi: perfil?.uso_cfdi || null,
      })
      .select("id, folio")
      .single();
    if (error || !creado) return NextResponse.json({ error: "No se pudo guardar el contrato: " + (error?.message || "") }, { status: 500 });
    contratoId = creado.id;
    folioContrato = creado.folio;
    if (c.oficina_id) {
      const { error: errOficina } = await admin.from("oficinas").update({ cliente_id: userId, estado: "ocupada" }).eq("id", c.oficina_id);
      if (errOficina) avisos.push("El contrato quedó, pero no se pudo marcar la oficina como ocupada.");
    }
    if (c.dia_pago) await admin.from("profiles").update({ dia_pago: Number(c.dia_pago) }).eq("id", userId);
  }

  // ---------- Pagos ----------
  const pagos: PagoAnexo[] = Array.isArray(b.pagos) ? b.pagos : [];
  let pagosGuardados = 0;
  for (const p of pagos.slice(0, 300)) {
    const monto = Number(p.monto);
    const concepto = typeof p.concepto === "string" ? p.concepto.trim().slice(0, 200) : "";
    if (!concepto || !(monto > 0) || !FECHA.test(p.fecha || "")) {
      avisos.push(`Pago "${concepto || "sin concepto"}" no se guardó: falta concepto, monto o fecha.`);
      continue;
    }
    const pagado = p.estado === "pagado";
    const { data: nuevo, error } = await admin
      .from("pagos")
      .insert({
        user_id: userId,
        centro,
        contrato_id: contratoId,
        concepto,
        monto,
        estado: pagado ? "pagado" : "pendiente",
        fecha_pago: pagado ? p.fecha : null,
        comprobante_url: p.comprobanteUrl || null,
        // La fecha del cargo: de ahí sale su fecha límite en Cobranza.
        created_at: p.fecha + "T12:00:00-06:00",
      })
      .select("id")
      .single();
    if (error || !nuevo) {
      avisos.push(`Pago "${concepto}" no se guardó: ${error?.message || "error"}`);
      continue;
    }
    pagosGuardados++;
    if (pagado && FORMAS.includes(p.formaPago || "")) await admin.from("pagos").update({ forma_pago: p.formaPago }).eq("id", nuevo.id);
  }

  // ---------- Facturas (CFDI ya timbrados) ----------
  const facturas: FacturaAnexo[] = Array.isArray(b.facturas) ? b.facturas : [];
  let facturasGuardadas = 0;
  let duplicadas = 0;
  for (const f of facturas.slice(0, 300)) {
    const d = f?.cfdi;
    if (!d?.uuidCfdi) {
      avisos.push("Una factura no se guardó: el XML no trae UUID.");
      continue;
    }
    const folio = d.serie || d.folioFiscal ? `${d.serie || ""} ${d.folioFiscal || ""}`.trim() : d.uuidCfdi.slice(0, 8);
    const fecha = d.fecha ? d.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const { error } = await admin.from("facturas").insert({
      user_id: userId,
      folio,
      concepto: (d.conceptos || []).map((x) => x.descripcion).join(" · ").slice(0, 200) || "CFDI importado",
      monto: d.total,
      fecha_emision: fecha,
      fecha_vencimiento: fecha,
      estado: f.estado === "pagada" ? "pagada" : "pendiente",
      centro,
      archivo_url: f.archivoUrl || null,
      xml_url: f.xmlUrl || null,
      uuid_cfdi: d.uuidCfdi,
      serie: d.serie || null,
      folio_fiscal: d.folioFiscal || null,
      rfc_emisor: d.rfcEmisor || null,
      nombre_emisor: d.nombreEmisor || null,
      rfc_receptor: d.rfcReceptor || null,
      nombre_receptor: d.nombreReceptor || null,
      subtotal: d.subtotal || null,
      iva: d.iva || null,
      retenciones: d.retenciones || null,
      moneda: d.moneda || null,
      tipo_comprobante: d.tipoComprobante || null,
      forma_pago: d.formaPago || null,
      metodo_pago: d.metodoPago || null,
      uso_cfdi: d.usoCfdi || null,
      conceptos: d.conceptos,
      impuestos: d.impuestos,
      fuente: "cfdi_import",
    });
    if (error) {
      if ((error as any).code === "23505") duplicadas++;
      else avisos.push(`Factura ${folio} no se guardó: ${error.message}`);
      continue;
    }
    facturasGuardadas++;
  }
  if (duplicadas > 0) avisos.push(`${duplicadas} factura(s) ya estaban en el sistema (mismo UUID) y no se repitieron.`);

  return NextResponse.json({ ok: true, contratoId, folioContrato, pagos: pagosGuardados, facturas: facturasGuardadas, avisos });
}
