import type { SupabaseClient } from "@supabase/supabase-js";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// ¿Puede esta persona del staff facturar a este cliente? Los roles globales, siempre. Los demás, si el cliente es de
// su centro o tiene un contrato en su centro (un cliente puede tener contratos en varios centros). `cruzado` es que
// el perfil del cliente es de otro centro: entonces solo se le ven los contratos y pagos de este centro.
export async function accesoCliente(
  admin: SupabaseClient,
  rol: string,
  centroStaff: string | null,
  userId: string
): Promise<{ ok: boolean; cliente: { id: string; centro: string | null } | null; cruzado: boolean }> {
  const { data: cliente } = await admin.from("profiles").select("id, centro").eq("id", userId).maybeSingle();
  if (!cliente) return { ok: false, cliente: null, cruzado: false };
  if (ROLES_GLOBALES.includes(rol)) return { ok: true, cliente, cruzado: false };
  if (!centroStaff) return { ok: false, cliente, cruzado: false };
  if (cliente.centro === centroStaff) return { ok: true, cliente, cruzado: false };
  const { data: contrato } = await admin.from("contratos").select("id").eq("user_id", userId).eq("centro", centroStaff).limit(1).maybeSingle();
  return { ok: !!contrato, cliente, cruzado: true };
}
