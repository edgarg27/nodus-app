// Factura a "público en general" (venta de mostrador): cuando no hay un cliente
// a quien facturar. Se timbra en el momento, ya pagada (PUE), con el RFC genérico
// del SAT y el nodo de información global. El centro la lleva en su historial
// como "Público en general".

import { createAdminClient } from "@/lib/supabaseAdmin";
import { timbrarCfdi, ErrorFacturacion, cpLugarExpedicion } from "@/lib/facturapi";
import { DATOS_PUBLICO_GENERAL } from "@/lib/datosFiscales";
import { FORMAS_PAGO_COMPLEMENTO } from "@/lib/formasPagoComplemento";
import { hoyMexicoISO } from "@/lib/fechaMexico";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoPublicoGeneral = { ok: boolean; facturaId?: string; uuid?: string; folio?: string; error?: string };

export async function facturarPublicoGeneral(
  admin: Admin,
  p: { centro: string; concepto: string; monto: number; formaPago: string; adicionalTipo?: string | null }
): Promise<ResultadoPublicoGeneral> {
  try {
    const concepto = (p.concepto || "").trim();
    const monto = Math.round(Number(p.monto) * 100) / 100;
    if (!p.centro) throw new ErrorFacturacion("Falta el centro");
    if (!concepto) throw new ErrorFacturacion("Falta el concepto");
    if (concepto.length > 120) throw new ErrorFacturacion("El concepto admite máximo 120 caracteres");
    if (!(monto > 0)) throw new ErrorFacturacion("El monto debe ser mayor a cero");
    if (!FORMAS_PAGO_COMPLEMENTO.some((f) => f.clave === p.formaPago)) throw new ErrorFacturacion("Forma de pago no válida");

    // En CFDI 4.0 el código postal de público en general es el del lugar de expedición del emisor.
    const cp = await cpLugarExpedicion();
    const { invoice, datosFactura } = await timbrarCfdi(admin, {
      cliente: { ...DATOS_PUBLICO_GENERAL, cp_fiscal: cp, email: null },
      concepto,
      monto,
      adicionalTipo: p.adicionalTipo || null,
      metodo: "PUE",
      formaPago: p.formaPago,
      etiqueta: `público en general ${p.centro}`,
    });

    const hoy = hoyMexicoISO();
    const folio = `${invoice.series || "F"}${invoice.folio_number ?? ""}`;
    const { data: fila, error } = await admin
      .from("facturas")
      .insert({
        user_id: null,
        folio,
        concepto,
        monto,
        fecha_emision: hoy,
        fecha_vencimiento: hoy,
        estado: "pagada",
        centro: p.centro,
        adicional_tipo: p.adicionalTipo || null,
        ...datosFactura,
      })
      .select("id")
      .single();
    if (error || !fila) {
      console.error(`[publico-general] timbrado ${invoice.uuid} pero no se guardó:`, error?.message);
      throw new ErrorFacturacion(`Se timbró la factura (${invoice.uuid}) pero no se pudo guardar; revisa Facturapi antes de reintentar`);
    }
    return { ok: true, facturaId: fila.id, uuid: invoice.uuid, folio };
  } catch (err: any) {
    if (!(err instanceof ErrorFacturacion)) console.error("[publico-general]", err?.message || err);
    return { ok: false, error: err?.message || "Facturapi rechazó la factura" };
  }
}
