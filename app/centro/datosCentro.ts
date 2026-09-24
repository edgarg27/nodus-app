import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Datos que necesita CentroPanel, compartidos por /centro (Panel de Centro)
// y los módulos /centro/<vista> (Invitados, Vouchers…) para que todos
// arranquen igual: sesión, perfil y lista de centros.
export async function datosPanelCentro() {
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

  if (profile?.rol === "cliente") redirect("/dashboard-cliente");

  const { data: oficinas } = await supabase.from("oficinas").select("centro");
  const { data: clientesTodos } = await supabase.from("profiles").select("centro").eq("rol", "cliente");

  const centrosSet = new Set<string>();
  (oficinas || []).forEach((o) => o.centro && centrosSet.add(o.centro));
  (clientesTodos || []).forEach((c) => c.centro && centrosSet.add(c.centro));
  if (profile?.centro) centrosSet.add(profile.centro);

  return {
    nombre: profile?.nombre || session.user.email || "Admin",
    rol: profile?.rol || "",
    centroPerfil: profile?.centro || null,
    centrosDisponibles: Array.from(centrosSet).sort(),
  };
}
