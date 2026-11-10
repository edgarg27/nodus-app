import { createAdminClient } from "@/lib/supabaseAdmin";
import type { AccionBitacora } from "@/lib/bitacoraTipos";

type Admin = ReturnType<typeof createAdminClient>;

export type { AccionBitacora } from "@/lib/bitacoraTipos";
export { TEXTO_ACCION, textoAccion } from "@/lib/bitacoraTipos";

export interface DatosBitacora {
  actorId: string; // personal que hizo la acción (session.user.id)
  accion: AccionBitacora;
  entidad: "pago" | "factura";
  entidadId?: string | null;
  folio?: string | null;
  clienteId?: string | null;
  centro?: string | null;
  monto?: number | null;
  detalle?: string | null;
}

// Deja constancia de una acción del personal sobre un pago o una factura (quién, qué, sobre quién y cuándo).
// Es "al mejor esfuerzo": si algo falla (p. ej. la tabla aún no existe), NUNCA rompe la operación principal.
export async function registrarBitacora(admin: Admin, datos: DatosBitacora): Promise<void> {
  try {
    const { data: actor } = await admin.from("profiles").select("nombre, rol").eq("id", datos.actorId).maybeSingle();
    let clienteNombre: string | null = null;
    if (datos.clienteId) {
      const { data: cli } = await admin.from("profiles").select("nombre").eq("id", datos.clienteId).maybeSingle();
      clienteNombre = (cli as { nombre?: string | null } | null)?.nombre || null;
    }
    await admin.from("bitacora_movimientos").insert({
      actor_id: datos.actorId,
      actor_nombre: (actor as { nombre?: string | null } | null)?.nombre || null,
      actor_rol: (actor as { rol?: string | null } | null)?.rol || null,
      accion: datos.accion,
      entidad: datos.entidad,
      entidad_id: datos.entidadId || null,
      folio: datos.folio || null,
      cliente_id: datos.clienteId || null,
      cliente_nombre: clienteNombre,
      centro: datos.centro || null,
      monto: typeof datos.monto === "number" ? datos.monto : null,
      detalle: datos.detalle || null,
    });
  } catch {
    // La bitácora nunca debe tumbar la acción real.
  }
}
