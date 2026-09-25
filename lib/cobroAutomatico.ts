import { createAdminClient } from "@/lib/supabaseAdmin";
import { cobrarTarjetaGuardada } from "@/lib/openpay";
import { confirmarPagoPorCargo } from "@/lib/pagosOpenpay";
import { enviarCobroAutomaticoFallido } from "@/lib/correosPagos";
import { FALLOS_PARA_APAGAR_COBRO_AUTOMATICO } from "@/lib/consentimientoCobros";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoCobroAutomatico = {
  intento: boolean; // hay tarjeta con cobro automático y se intentó el cobro
  pagado: boolean;
  error?: string;
};

// Cobro automático de una factura con la tarjeta que el cliente autorizó. Lo usa
// el cobro diario cuando genera la renta del mes y en sus reintentos. Si no hay
// tarjeta con cobro automático no hace nada. Si el cobro se completa, la factura
// queda pagada (mismo camino que un pago manual: aviso al centro y correo de
// gracias). Si falla, cuenta el fallo, avisa al cliente y, al llegar al tope,
// apaga solo el cobro automático. Nunca lanza error: quien lo llama sigue con su
// SPEI de respaldo.
export async function intentarCobroAutomatico(
  admin: Admin,
  datos: {
    userId: string;
    facturaId: string;
    monto: number;
    concepto: string;
    cliente: { nombre: string | null; email: string | null; centro: string | null };
    intento?: number; // número de intento del día/mes, para que el order_id sea único
  }
): Promise<ResultadoCobroAutomatico> {
  const { data: tarjeta } = await admin
    .from("tarjetas_guardadas")
    .select("id, openpay_customer_id, openpay_card_id, ultimos4, fallos_consecutivos")
    .eq("user_id", datos.userId)
    .eq("activa", true)
    .eq("cobro_automatico", true)
    .maybeSingle();
  if (!tarjeta) return { intento: false, pagado: false };

  // Por si otro proceso (o un pago manual) ya la pagó.
  const { data: factura } = await admin.from("facturas").select("estado").eq("id", datos.facturaId).maybeSingle();
  if (!factura || factura.estado === "pagada") return { intento: false, pagado: factura?.estado === "pagada" };

  try {
    const cargo = await cobrarTarjetaGuardada({
      customerId: tarjeta.openpay_customer_id,
      cardId: tarjeta.openpay_card_id,
      monto: Number(datos.monto),
      descripcion: `${datos.concepto} (cobro automático)`,
      ordenId: `${datos.facturaId}-auto-${Date.now().toString(36)}`,
    });

    // Se registra el pago con su cargo para que el flujo normal lo confirme.
    await admin.from("pagos").insert({
      factura_id: datos.facturaId,
      user_id: datos.userId,
      monto: datos.monto,
      estado: "pendiente",
      notas: `Cobro automático con tarjeta ****${tarjeta.ultimos4 || ""} vía Openpay`,
      openpay_charge_id: cargo.id,
    });

    if (cargo.status !== "completed") {
      // Openpay no lo completó al momento (p. ej. la tarjeta pide verificación): cuenta como fallo.
      throw new Error(cargo.error_message || "El banco no aprobó el cobro");
    }
    await confirmarPagoPorCargo(admin, cargo.id);
    await admin.from("tarjetas_guardadas").update({ fallos_consecutivos: 0 }).eq("id", tarjeta.id);
    return { intento: true, pagado: true };
  } catch (err: any) {
    const motivo = err?.message || "El banco rechazó el cobro";
    const fallos = (tarjeta.fallos_consecutivos || 0) + 1;
    const apagar = fallos >= FALLOS_PARA_APAGAR_COBRO_AUTOMATICO;
    await admin
      .from("tarjetas_guardadas")
      .update({ fallos_consecutivos: fallos, ...(apagar ? { cobro_automatico: false } : {}) })
      .eq("id", tarjeta.id);

    await admin.from("notificaciones").insert({
      centro: datos.cliente.centro,
      user_id: datos.userId,
      tipo: "cobro_automatico_fallido",
      mensaje: `⚠️ No pudimos cobrar tu tarjeta terminación ${tarjeta.ultimos4 || "****"} (${motivo}). Puedes pagar por SPEI o con otra tarjeta desde tu estado de cuenta.${
        apagar ? " Desactivamos el cobro automático después de varios intentos." : ""
      }`,
    });
    await enviarCobroAutomaticoFallido({
      to: datos.cliente.email,
      nombre: datos.cliente.nombre,
      ultimos4: tarjeta.ultimos4,
      motivo,
      monto: datos.monto,
      desactivado: apagar,
    });
    return { intento: true, pagado: false, error: motivo };
  }
}
