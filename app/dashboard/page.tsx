import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminPanel from "./AdminPanel";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre, rol, centro")
    .eq("id", session.user.id)
    .single();

  const esGlobal = ROLES_GLOBALES.includes(profile?.rol || "");
  const miCentro = profile?.centro || null;

  // Clientes: si no es rol global, solo los de su propio centro
  let clientesQuery = supabase.from("profiles").select("*").eq("rol", "cliente");
  if (!esGlobal && miCentro) clientesQuery = clientesQuery.eq("centro", miCentro);
  const { data: clientes } = await clientesQuery.order("nombre");

  const idsClientesCentro = (clientes || []).map((c) => c.id);

  // Facturas: la tabla ya tiene columna "centro" directo
  let facturasPendQuery = supabase
    .from("facturas")
    .select("*", { count: "exact", head: true })
    .eq("estado", "pendiente");
  let facturasVencQuery = supabase
    .from("facturas")
    .select("*", { count: "exact", head: true })
    .eq("estado", "vencida");
  if (!esGlobal && miCentro) {
    facturasPendQuery = facturasPendQuery.eq("centro", miCentro);
    facturasVencQuery = facturasVencQuery.eq("centro", miCentro);
  }

  // Pagos no tiene columna "centro" directo, se filtra por los clientes de ese centro
  let comprobantesQuery = supabase
    .from("pagos")
    .select("*", { count: "exact", head: true })
    .eq("estado", "en_revision");
  if (!esGlobal) {
    comprobantesQuery = comprobantesQuery.in(
      "user_id",
      idsClientesCentro.length > 0 ? idsClientesCentro : ["00000000-0000-0000-0000-000000000000"]
    );
  }

  const [
    { count: facturasPendientes },
    { count: facturasVencidas },
    { count: comprobantesRevisar },
  ] = await Promise.all([facturasPendQuery, facturasVencQuery, comprobantesQuery]);

  return (
    <AdminPanel
      nombre={profile?.nombre || session.user.email || "Sistemas"}
      rol={profile?.rol || ""}
      centro={miCentro}
      resumen={{
        totalClientes: clientes?.length || 0,
        facturasPendientes: facturasPendientes || 0,
        facturasVencidas: facturasVencidas || 0,
        comprobantesRevisar: comprobantesRevisar || 0,
      }}
      clientesIniciales={clientes || []}
    />
  );
}
