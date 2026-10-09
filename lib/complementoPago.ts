// Complemento de pago (CFDI tipo "P"): cubre, cuando el cliente paga, una o
// varias facturas emitidas a pago diferido (PPD). Un solo complemento puede
// cubrir varias facturas del mismo cliente. El saldo de cada factura es su
// monto menos lo cubierto por complementos no cancelados.

import crypto from "crypto";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { normalizarDatosFiscales } from "@/lib/datosFiscales";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";
import { estatusDesdeFacturapi } from "@/lib/facturapiCancelacion";
import { clienteFacturapi, bufferDesdeUrlFirmada, subirArchivoFactura, ErrorFacturacion } from "@/lib/facturapi";

type Admin = ReturnType<typeof createAdminClient>;

export { FORMAS_PAGO_COMPLEMENTO };

const centavos = (n: number) => Math.round(n * 100) / 100;

export type SaldoFactura = { pagado: number; parcialidadesVigentes: number; complementosEmitidos: number };

// Cuánto lleva cubierto cada factura. Los complementos cancelados no cuentan,
// pero sí se cuentan como "emitidos" (para que una reemisión use otra llave).
export async function saldosFacturas(admin: Admin, facturaIds: string[]): Promise<Map<string, SaldoFactura>> {
  const mapa = new Map<string, SaldoFactura>();
  facturaIds.forEach((id) => mapa.set(id, { pagado: 0, parcialidadesVigentes: 0, complementosEmitidos: 0 }));
  if (facturaIds.length === 0) return mapa;

  const { data: filas } = await admin
    .from("complemento_pago_facturas")
    .select("factura_id, importe, complemento_id")
    .in("factura_id", facturaIds);
  const complementoIds = Array.from(new Set((filas || []).map((f) => f.complemento_id)));
  const { data: complementos } = complementoIds.length
    ? await admin.from("complementos_pago").select("id, cancelacion_estatus").in("id", complementoIds)
    : { data: [] as { id: string; cancelacion_estatus: string | null }[] };
  const estatus = new Map((complementos || []).map((c) => [c.id, c.cancelacion_estatus]));

  for (const f of filas || []) {
    const s = mapa.get(f.factura_id)!;
    s.complementosEmitidos++;
    if (estatus.get(f.complemento_id) !== "cancelada") {
      s.pagado = centavos(s.pagado + Number(f.importe));
      s.parcialidadesVigentes++;
    }
  }
  return mapa;
}

export type ResultadoComplemento = { ok: boolean; complementoId?: string; uuid?: string; error?: string };

export async function emitirComplementoPago(
  admin: Admin,
  p: {
    userId: string;
    items: { facturaId: string; importe: number }[];
    formaPago: string;
    fecha: string; // YYYY-MM-DD
    usuarioId: string | null;
    pagoId?: string | null;
    // true: si el importe supera el saldo, se recorta al saldo (lo usa el pago automático).
    topeSaldo?: boolean;
    // Datos opcionales del pago: referencia bancaria (va en el CFDI), notas internas y comprobante.
    numeroOperacion?: string | null;
    notas?: string | null;
    comprobanteUrl?: string | null;
  }
): Promise<ResultadoComplemento> {
  try {
    if (!FORMAS_PAGO_COMPLEMENTO.some((f) => f.clave === p.formaPago)) throw new ErrorFacturacion("Forma de pago no válida");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) throw new ErrorFacturacion("Fecha de pago no válida");
    if (p.fecha > hoyMexicoISO()) throw new ErrorFacturacion("La fecha de pago no puede ser futura");
    const numeroOperacion = (p.numeroOperacion || "").trim();
    const notas = (p.notas || "").trim();
    if (numeroOperacion.length > 100) throw new ErrorFacturacion("El número de operación admite máximo 100 caracteres");
    if (notas.length > 500) throw new ErrorFacturacion("Las notas admiten máximo 500 caracteres");
    // Un mismo pago puede confirmarse dos veces (webhook + verificación): si ya tiene su
    // complemento vigente, no se emite otro.
    if (p.pagoId) {
      const { data: yaTiene } = await admin.from("complementos_pago").select("id, cancelacion_estatus").eq("pago_id", p.pagoId);
      const vigente = (yaTiene || []).find((c) => c.cancelacion_estatus !== "cancelada");
      if (vigente) return { ok: true, complementoId: vigente.id };
    }
    const ids = p.items.map((i) => i.facturaId);
    if (ids.length === 0) throw new ErrorFacturacion("Elige al menos una factura");
    if (new Set(ids).size !== ids.length) throw new ErrorFacturacion("Una factura no puede repetirse en el mismo complemento");

    const { data: facturas } = await admin
      .from("facturas")
      .select("id, folio, user_id, centro, monto, uuid_cfdi, metodo_pago, moneda, cancelacion_estatus")
      .in("id", ids);
    if (!facturas || facturas.length !== ids.length) throw new ErrorFacturacion("No se encontraron todas las facturas");
    for (const f of facturas) {
      if (f.user_id !== p.userId) throw new ErrorFacturacion(`La factura ${f.folio} es de otro cliente: un complemento cubre solo facturas de un mismo cliente`);
      if (!f.uuid_cfdi || f.metodo_pago !== "PPD") throw new ErrorFacturacion(`La factura ${f.folio} no es de pago diferido (PPD), no necesita complemento`);
      if (f.cancelacion_estatus === "cancelada" || f.cancelacion_estatus === "en_proceso") {
        throw new ErrorFacturacion(`La factura ${f.folio} está cancelada o en proceso de cancelación`);
      }
      if (f.moneda && f.moneda !== "MXN") throw new ErrorFacturacion(`La factura ${f.folio} no es en pesos`);
    }

    const saldos = await saldosFacturas(admin, ids);
    const docs = p.items.map((item) => {
      const f = facturas.find((x) => x.id === item.facturaId)!;
      const s = saldos.get(f.id)!;
      const saldoAnterior = centavos(Number(f.monto) - s.pagado);
      let importe = centavos(item.importe);
      if (p.topeSaldo && importe > saldoAnterior) importe = saldoAnterior;
      if (saldoAnterior <= 0) throw new ErrorFacturacion(`La factura ${f.folio} ya está cubierta por completo`);
      if (!(importe > 0)) throw new ErrorFacturacion(`El importe de la factura ${f.folio} debe ser mayor a cero`);
      if (importe > saldoAnterior) throw new ErrorFacturacion(`El importe de la factura ${f.folio} ($${importe}) supera su saldo ($${saldoAnterior})`);
      return { f, importe, saldoAnterior, parcialidad: s.parcialidadesVigentes + 1, emitidos: s.complementosEmitidos, saldoInsoluto: centavos(saldoAnterior - importe) };
    });

    const { data: cliente } = await admin
      .from("profiles")
      .select("email, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal, centro")
      .eq("id", p.userId)
      .maybeSingle();
    if (!cliente?.rfc || !cliente.nombre_fiscal || !cliente.regimen_fiscal || !cliente.cp_fiscal) {
      throw new ErrorFacturacion("el cliente no tiene datos fiscales completos");
    }
    const datos = normalizarDatosFiscales({
      rfc: cliente.rfc,
      nombre_fiscal: cliente.nombre_fiscal,
      regimen_fiscal: cliente.regimen_fiscal,
      cp_fiscal: cliente.cp_fiscal,
      uso_cfdi: "G03",
    });

    // La misma llave para el mismo pago evita complementos dobles (doble clic, dos personas);
    // incluye cuántos complementos hubo antes para que reemitir tras una cancelación sí se pueda.
    const huella = crypto
      .createHash("sha256")
      .update(JSON.stringify({ d: docs.map((d) => [d.f.id, d.importe, d.parcialidad, d.emitidos]), fecha: p.fecha, forma: p.formaPago }))
      .digest("hex")
      .slice(0, 40);

    const invoice: any = await clienteFacturapi.invoices.create({
      type: "P",
      customer: {
        legal_name: datos.nombre_fiscal,
        tax_id: datos.rfc,
        tax_system: datos.regimen_fiscal,
        email: cliente.email || undefined,
        address: { zip: datos.cp_fiscal },
      },
      complements: [
        {
          type: "pago",
          data: {
            payment_form: p.formaPago,
            ...(numeroOperacion ? { numOperacion: numeroOperacion } : {}),
            date: new Date(`${p.fecha}T12:00:00`),
            related_documents: docs.map((d) => ({
              uuid: d.f.uuid_cfdi,
              amount: d.importe,
              installment: d.parcialidad,
              last_balance: d.saldoAnterior,
              taxes: [{ base: centavos(d.importe / 1.16), type: "IVA", rate: 0.16, factor: "Tasa", withholding: false }],
            })),
          },
        },
      ],
      idempotency_key: `comp-${huella}`,
    } as any);

    const [xmlBuf, pdfBuf] = await Promise.all([
      clienteFacturapi.invoices.downloadXmlUrl(invoice.id).then((u: any) => bufferDesdeUrlFirmada(u.url)).catch(() => null),
      clienteFacturapi.invoices.downloadPdfUrl(invoice.id).then((u: any) => bufferDesdeUrlFirmada(u.url)).catch(() => null),
    ]);
    const base = `comp-${String(invoice.uuid || invoice.id).slice(0, 8)}`;
    const [xmlUrl, archivoUrl] = await Promise.all([
      xmlBuf ? subirArchivoFactura(admin, base, xmlBuf, "xml") : Promise.resolve(null),
      pdfBuf ? subirArchivoFactura(admin, base, pdfBuf, "pdf") : Promise.resolve(null),
    ]);

    const monto = centavos(docs.reduce((s, d) => s + d.importe, 0));
    const { data: comp, error: errComp } = await admin
      .from("complementos_pago")
      .insert({
        user_id: p.userId,
        centro: docs[0].f.centro || cliente.centro || null,
        facturapi_id: invoice.id,
        uuid_cfdi: invoice.uuid,
        serie: invoice.series || null,
        folio_fiscal: String(invoice.folio_number ?? ""),
        forma_pago: p.formaPago,
        fecha_pago: p.fecha,
        monto,
        pago_id: p.pagoId || null,
        numero_operacion: numeroOperacion || null,
        notas: notas || null,
        comprobante_url: p.comprobanteUrl || null,
        xml_url: xmlUrl,
        archivo_url: archivoUrl,
        creado_por: p.usuarioId,
      })
      .select("id")
      .single();
    if (errComp || !comp) {
      console.error(`[complemento] timbrado ${invoice.uuid} pero no se guardó:`, errComp?.message);
      throw new ErrorFacturacion(`Se timbró el complemento (${invoice.uuid}) pero no se pudo guardar; revisa Facturapi antes de reintentar`);
    }
    const { error: errFilas } = await admin.from("complemento_pago_facturas").insert(
      docs.map((d) => ({
        complemento_id: comp.id,
        factura_id: d.f.id,
        uuid_factura: d.f.uuid_cfdi,
        parcialidad: d.parcialidad,
        saldo_anterior: d.saldoAnterior,
        importe: d.importe,
        saldo_insoluto: d.saldoInsoluto,
      }))
    );
    if (errFilas) {
      console.error(`[complemento] ${comp.id}: no se guardó el detalle por factura:`, errFilas.message);
      throw new ErrorFacturacion("El complemento se emitió pero no se pudo guardar qué facturas cubre; avisa a Sistemas");
    }
    return { ok: true, complementoId: comp.id, uuid: invoice.uuid };
  } catch (err: any) {
    if (!(err instanceof ErrorFacturacion)) console.error("[complemento]", err?.message || err);
    if (/idempotencia|idempotency/i.test(err?.message || "")) {
      return { ok: false, error: "Este pago ya tiene su complemento (o se está emitiendo); actualiza la pantalla" };
    }
    return { ok: false, error: err?.message || "Facturapi rechazó el complemento" };
  }
}

export async function cancelarComplemento(
  admin: Admin,
  complementoId: string,
  opts: { motivo: string; sustitutaUuid?: string | null; usuarioId: string }
): Promise<ResultadoComplemento & { estatus?: string }> {
  const { data: c } = await admin
    .from("complementos_pago")
    .select("id, facturapi_id, cancelacion_estatus")
    .eq("id", complementoId)
    .maybeSingle();
  if (!c || !c.facturapi_id) return { ok: false, error: "Complemento no encontrado" };
  if (c.cancelacion_estatus === "cancelada") return { ok: false, error: "Ya está cancelado" };
  if (c.cancelacion_estatus === "en_proceso") return { ok: false, error: "Ya tiene una cancelación en proceso" };
  try {
    const inv: any = await clienteFacturapi.invoices.cancel(c.facturapi_id, {
      motive: opts.motivo as any,
      ...(opts.motivo === "01" && opts.sustitutaUuid ? { substitution: opts.sustitutaUuid } : {}),
    });
    const estatus = estatusDesdeFacturapi(inv) ?? "en_proceso";
    await admin
      .from("complementos_pago")
      .update({
        cancelacion_estatus: estatus,
        cancelacion_motivo: opts.motivo,
        cancelacion_solicitada_en: new Date().toISOString(),
        cancelacion_solicitada_por: opts.usuarioId,
      })
      .eq("id", complementoId);
    return { ok: true, estatus };
  } catch (err: any) {
    console.error(`[complemento] cancelar ${complementoId}:`, err?.message || err);
    return { ok: false, error: err?.message || "Facturapi rechazó la cancelación" };
  }
}

// Refresca las cancelaciones de complementos que esperaban respuesta del cliente.
export async function refrescarCancelacionesComplementos(admin: Admin, centro?: string | null): Promise<number> {
  let q = admin.from("complementos_pago").select("id, facturapi_id, centro, serie, folio_fiscal").eq("cancelacion_estatus", "en_proceso");
  if (centro) q = q.eq("centro", centro);
  const { data: pendientes } = await q.limit(50);
  let cambiaron = 0;
  for (const c of pendientes || []) {
    try {
      if (!c.facturapi_id) continue;
      const inv: any = await clienteFacturapi.invoices.retrieve(c.facturapi_id);
      const nuevo = estatusDesdeFacturapi(inv);
      if (nuevo && nuevo !== "en_proceso") {
        await admin.from("complementos_pago").update({ cancelacion_estatus: nuevo }).eq("id", c.id);
        cambiaron++;
      }
    } catch (err: any) {
      console.error(`[complemento] refrescar ${c.id}:`, err?.message || err);
    }
  }
  return cambiaron;
}
