import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCfdiPorCorreo } from "@/lib/facturapi";
import { esFacturaSimulada } from "@/lib/facturaSimulada";
import { correoVisible } from "@/lib/correoFicticio";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoEnvioCfdi = { ok: true; correo: string } | { ok: false; error: string };

// Manda al correo del cliente el PDF y el XML de su factura timbrada (los envía Facturapi). Se usa al timbrar y desde
// "Enviar factura por correo" (estado de cuenta y Facturas timbradas). Queda la fecha del último envío
// (facturas.cfdi_enviado_at, migracion_cfdi_enviado.sql; si la columna todavía no existe, no pasa nada).
export async function enviarFacturaAlCliente(admin: Admin, facturaId: string): Promise<ResultadoEnvioCfdi> {
  const { data: f } = await admin.from("facturas").select("id, user_id, uuid_cfdi, facturapi_id, cancelacion_estatus").eq("id", facturaId).maybeSingle();
  if (!f) return { ok: false, error: "no se encontró la factura" };
  if (!f.uuid_cfdi) return { ok: false, error: "todavía no está timbrada" };
  if (esFacturaSimulada(f.uuid_cfdi)) return { ok: false, error: "es una factura simulada de prueba" };
  if (f.cancelacion_estatus === "cancelada") return { ok: false, error: "está cancelada" };
  if (!f.facturapi_id) return { ok: false, error: "no se emitió desde Nodus (importada): mándala desde donde se emitió" };
  if (!f.user_id) return { ok: false, error: "no tiene cliente" };

  const { data: cliente } = await admin.from("profiles").select("email").eq("id", f.user_id).maybeSingle();
  const correo = correoVisible(cliente?.email).trim();
  if (!correo) return { ok: false, error: "el cliente no tiene correo registrado" };

  const r = await enviarCfdiPorCorreo(f.facturapi_id, correo);
  if ("error" in r) return { ok: false, error: "no se pudo enviar el correo: " + r.error };
  await admin.from("facturas").update({ cfdi_enviado_at: new Date().toISOString() }).eq("id", f.id);
  return { ok: true, correo };
}
