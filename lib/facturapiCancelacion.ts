// Cancelación de CFDI emitidos con Facturapi y seguimiento de su estatus ante
// el SAT. Una cancelación puede quedar "en proceso" hasta que el cliente la
// acepte; el estatus se refresca consultando a Facturapi.

import Facturapi from "facturapi";
import { createAdminClient } from "@/lib/supabaseAdmin";

type Admin = ReturnType<typeof createAdminClient>;

const facturapi = new Facturapi(process.env.FACTURAPI_API_KEY || "");

export const MOTIVOS_CANCELACION: Record<string, string> = {
  "01": "Comprobante emitido con errores con relación",
  "02": "Comprobante emitido con errores sin relación",
  "03": "No se llevó a cabo la operación",
  "04": "Operación nominativa relacionada en una factura global",
};

export type EstatusCancelacion = "en_proceso" | "cancelada" | "rechazada" | null;

// Traduce lo que reporta Facturapi a nuestro estatus. Si la factura ya está
// cancelada, eso manda; "pending/verifying" es que falta la aceptación del
// cliente; "rejected" deja la factura vigente; "expired" (plazo vencido sin
// respuesta) también la deja vigente hasta que Facturapi diga lo contrario.
export function estatusDesdeFacturapi(inv: any): EstatusCancelacion {
  if (inv?.status === "canceled") return "cancelada";
  const cs = inv?.cancellation_status ?? inv?.cancellation?.status;
  if (cs === "pending" || cs === "verifying") return "en_proceso";
  if (cs === "rejected" || cs === "expired") return "rechazada";
  if (cs === "accepted") return "cancelada";
  return null;
}

type FilaFactura = { id: string; facturapi_id: string | null; uuid_cfdi: string | null };

// Facturas emitidas antes de guardar `facturapi_id` se localizan por UUID.
async function idFacturapi(admin: Admin, f: FilaFactura): Promise<string | null> {
  if (f.facturapi_id) return f.facturapi_id;
  if (!f.uuid_cfdi) return null;
  const res: any = await facturapi.invoices.list({ q: f.uuid_cfdi });
  const encontrada = (res?.data || []).find((i: any) => String(i.uuid).toLowerCase() === f.uuid_cfdi!.toLowerCase());
  if (!encontrada) return null;
  await admin.from("facturas").update({ facturapi_id: encontrada.id }).eq("id", f.id);
  return encontrada.id;
}

export type ResultadoCancelacion = { id: string; ok: boolean; estatus?: EstatusCancelacion; error?: string };

export async function cancelarFactura(
  admin: Admin,
  facturaId: string,
  opts: { motivo: string; sustitutaUuid?: string | null; usuarioId: string }
): Promise<ResultadoCancelacion> {
  const { data: f } = await admin
    .from("facturas")
    .select("id, facturapi_id, uuid_cfdi, fuente, cancelacion_estatus")
    .eq("id", facturaId)
    .maybeSingle();
  if (!f) return { id: facturaId, ok: false, error: "Factura no encontrada" };
  if (f.fuente !== "facturapi_auto" || !f.uuid_cfdi) {
    return { id: facturaId, ok: false, error: "Solo se pueden cancelar aquí las facturas emitidas desde Nodus (las de ZORA se cancelan en ZORA)" };
  }
  if (f.cancelacion_estatus === "cancelada") return { id: facturaId, ok: false, error: "Ya está cancelada" };
  if (f.cancelacion_estatus === "en_proceso") return { id: facturaId, ok: false, error: "Ya tiene una cancelación en proceso" };

  try {
    const idFp = await idFacturapi(admin, f);
    if (!idFp) return { id: facturaId, ok: false, error: "No se encontró la factura en Facturapi" };

    const inv: any = await facturapi.invoices.cancel(idFp, {
      motive: opts.motivo as any,
      ...(opts.motivo === "01" && opts.sustitutaUuid ? { substitution: opts.sustitutaUuid } : {}),
    });
    const estatus = estatusDesdeFacturapi(inv) ?? "en_proceso";
    await admin
      .from("facturas")
      .update({
        cancelacion_estatus: estatus,
        cancelacion_motivo: opts.motivo,
        cancelacion_sustituta_uuid: opts.motivo === "01" ? opts.sustitutaUuid || null : null,
        cancelacion_solicitada_en: new Date().toISOString(),
        cancelacion_solicitada_por: opts.usuarioId,
      })
      .eq("id", facturaId);
    return { id: facturaId, ok: true, estatus };
  } catch (err: any) {
    console.error(`[facturapi] cancelar factura ${facturaId}:`, err?.message || err);
    return { id: facturaId, ok: false, error: err?.message || "Facturapi rechazó la cancelación" };
  }
}

// Refresca las cancelaciones "en proceso" (o una factura concreta). Avisa al
// staff del centro cuando una pendiente se resuelve.
export async function refrescarCancelaciones(admin: Admin, ids?: string[]): Promise<ResultadoCancelacion[]> {
  let q = admin
    .from("facturas")
    .select("id, facturapi_id, uuid_cfdi, folio, centro, cancelacion_estatus")
    .eq("cancelacion_estatus", "en_proceso");
  if (ids?.length) q = q.in("id", ids);
  const { data: pendientes } = await q.limit(50);

  const resultados: ResultadoCancelacion[] = [];
  for (const f of pendientes || []) {
    try {
      const idFp = await idFacturapi(admin, f);
      if (!idFp) continue;
      const inv: any = await facturapi.invoices.retrieve(idFp);
      const nuevo = estatusDesdeFacturapi(inv);
      if (nuevo && nuevo !== "en_proceso") {
        await admin.from("facturas").update({ cancelacion_estatus: nuevo }).eq("id", f.id);
        if (f.centro) {
          await admin.from("notificaciones").insert({
            centro: f.centro,
            tipo: "cancelacion_factura",
            mensaje:
              nuevo === "cancelada"
                ? `La cancelación de la factura ${f.folio} fue aceptada por el SAT.`
                : `El cliente rechazó la cancelación de la factura ${f.folio}: sigue vigente.`,
          });
        }
        resultados.push({ id: f.id, ok: true, estatus: nuevo });
      } else {
        resultados.push({ id: f.id, ok: true, estatus: "en_proceso" });
      }
    } catch (err: any) {
      console.error(`[facturapi] refrescar cancelación ${f.id}:`, err?.message || err);
      resultados.push({ id: f.id, ok: false, error: err?.message || "error" });
    }
  }
  return resultados;
}
