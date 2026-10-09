// Emite el CFDI de un cobro que todavía no se paga (pago diferido, PPD): es lo
// que en ZORA es "Facturar electrónicamente". Al pagarse, la factura se cubre
// con un complemento de pago. El cobro conserva su folio, su monto y su estado;
// solo se le agregan los datos del CFDI.

import { createAdminClient } from "@/lib/supabaseAdmin";
import { timbrarCfdi, ErrorFacturacion } from "@/lib/facturapi";
import { hoyMexicoISO } from "@/lib/fechaMexico";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoFacturar = { id: string; folio?: string; ok: boolean; uuid?: string; error?: string };

// Facturas que ya no se pueden facturar a pago diferido porque no hay nada que cobrar después.
const ESTADOS_NO_FACTURABLES = ["pagada", "cancelada"];

export async function facturarCobro(admin: Admin, facturaId: string): Promise<ResultadoFacturar> {
  const { data: f } = await admin
    .from("facturas")
    .select("id, folio, user_id, concepto, monto, estado, uuid_cfdi, centro, adicional_tipo")
    .eq("id", facturaId)
    .maybeSingle();
  if (!f) return { id: facturaId, ok: false, error: "Cobro no encontrado" };
  if (f.uuid_cfdi) return { id: facturaId, folio: f.folio, ok: false, error: "Ya tiene factura (CFDI)" };
  if (ESTADOS_NO_FACTURABLES.includes(f.estado)) {
    return { id: facturaId, folio: f.folio, ok: false, error: "Ya está pagado: se factura al cobrar, no a pago diferido" };
  }
  if (!f.user_id) return { id: facturaId, folio: f.folio, ok: false, error: "No tiene cliente asignado" };
  if (!(Number(f.monto) > 0)) return { id: facturaId, folio: f.folio, ok: false, error: "El monto debe ser mayor a cero" };

  const { data: cliente } = await admin
    .from("profiles")
    .select("email, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, uso_cfdi")
    .eq("id", f.user_id)
    .maybeSingle();

  // Si el cobro es de un tipo con clave del SAT propia (copias, frituras…), la usa; si no, la del pago ligado.
  const { data: pagoAdicional } = await admin
    .from("pagos")
    .select("adicional_tipo")
    .eq("factura_id", f.id)
    .not("adicional_tipo", "is", null)
    .limit(1)
    .maybeSingle();

  try {
    const { datosFactura } = await timbrarCfdi(admin, {
      cliente: cliente || {},
      concepto: f.concepto,
      monto: Number(f.monto),
      adicionalTipo: f.adicional_tipo || pagoAdicional?.adicional_tipo || null,
      metodo: "PPD",
      formaPago: "99", // "Por definir": el SAT lo exige en PPD; la forma real va en el complemento
      etiqueta: `cobro ${f.id}`,
      idempotencyKey: `cobro-${f.id}`,
    });
    // Solo si sigue sin CFDI: evita pisar el de otra persona que facturó al mismo tiempo.
    const { error } = await admin.from("facturas").update(datosFactura).eq("id", f.id).is("uuid_cfdi", null);
    if (error) {
      console.error(`[facturar-cobro] ${f.id}: se timbró pero no se pudo guardar:`, error.message);
      return { id: f.id, folio: f.folio, ok: false, error: "Se timbró en Facturapi pero no se pudo guardar; revisa Facturapi antes de reintentar" };
    }
    return { id: f.id, folio: f.folio, ok: true, uuid: datosFactura.uuid_cfdi };
  } catch (err: any) {
    if (!(err instanceof ErrorFacturacion)) console.error(`[facturar-cobro] ${f.id}:`, err?.message || err);
    // La llave de idempotencia ya usada significa que este cobro ya se facturó (o se está facturando).
    if (/idempotencia|idempotency/i.test(err?.message || "")) {
      return { id: f.id, folio: f.folio, ok: false, error: "Este cobro ya se facturó o se está facturando; actualiza la pantalla" };
    }
    return { id: f.id, folio: f.folio, ok: false, error: err?.message || "Facturapi rechazó la factura" };
  }
}


// Un cobro suelto (adicional, depósito, pago de Cotizar…) es un registro de pago sin
// factura. Para facturarlo antes de que se pague se crea su cobro con factura, se liga el
// pago y se emite el CFDI (PPD). Cuando el cliente pague, el pago se confirma como siempre
// y se emite su complemento de pago. Si el timbrado falla, no queda nada creado.
export async function facturarPagoSuelto(admin: Admin, pagoId: string): Promise<ResultadoFacturar> {
  const { data: p } = await admin
    .from("pagos")
    .select("id, user_id, monto, concepto, estado, factura_id, adicional_tipo, centro")
    .eq("id", pagoId)
    .maybeSingle();
  if (!p) return { id: pagoId, ok: false, error: "Cobro no encontrado" };
  const etiqueta = p.concepto || "Cobro";
  if (p.factura_id) return { id: pagoId, folio: etiqueta, ok: false, error: "Este cobro ya está ligado a una factura" };
  if (p.estado !== "pendiente") return { id: pagoId, folio: etiqueta, ok: false, error: "Solo se factura antes de pagar un cobro pendiente; los ya pagados se facturan solos" };
  if (!p.user_id) return { id: pagoId, folio: etiqueta, ok: false, error: "No tiene cliente asignado" };

  let centro = p.centro as string | null;
  if (!centro) {
    const { data: perfil } = await admin.from("profiles").select("centro").eq("id", p.user_id).maybeSingle();
    centro = perfil?.centro || null;
  }

  const hoy = hoyMexicoISO();
  const vence = new Date(hoy + "T12:00:00");
  vence.setDate(vence.getDate() + 7);
  const venceISO = vence.toLocaleDateString("en-CA");

  const { data: nueva, error: errNueva } = await admin
    .from("facturas")
    .insert({
      user_id: p.user_id,
      folio: "COB-" + String(p.id).slice(0, 8).toUpperCase(),
      concepto: p.concepto || "Cobro Nodus",
      monto: p.monto,
      fecha_emision: hoy,
      fecha_vencimiento: venceISO,
      estado: "pendiente",
      centro,
      adicional_tipo: p.adicional_tipo,
      fuente: "manual",
    })
    .select("id")
    .single();
  if (errNueva || !nueva) return { id: pagoId, folio: etiqueta, ok: false, error: "No se pudo crear el cobro con factura" };

  // Ligar el pago solo si sigue libre: evita que dos personas lo facturen a la vez.
  const { data: ligado } = await admin.from("pagos").update({ factura_id: nueva.id }).eq("id", p.id).is("factura_id", null).select("id");
  if (!ligado || ligado.length === 0) {
    await admin.from("facturas").delete().eq("id", nueva.id);
    return { id: pagoId, folio: etiqueta, ok: false, error: "Este cobro ya se está facturando; actualiza la pantalla" };
  }

  const r = await facturarCobro(admin, nueva.id);
  // Si ya se timbró pero no se pudo guardar, NO se deshace nada: así un reintento no emite una factura doble.
  if (!r.ok && /Se timbró/.test(r.error || "")) return { id: pagoId, folio: etiqueta, ok: false, error: r.error };
  if (!r.ok) {
    await admin.from("pagos").update({ factura_id: null }).eq("id", p.id);
    await admin.from("facturas").delete().eq("id", nueva.id);
    return { id: pagoId, folio: etiqueta, ok: false, error: r.error };
  }
  return { id: pagoId, folio: r.folio, ok: true, uuid: r.uuid };
}
