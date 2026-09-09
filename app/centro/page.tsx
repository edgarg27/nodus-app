import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CentroPanel from "./CentroPanel";

export default async function CentroPage() {
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
  const { data: clientesTodos } = await supabase
    .from("profiles")
    .select("centro")
    .eq("rol", "cliente");

  const centrosSet = new Set<string>();
  (oficinas || []).forEach((o) => o.centro && centrosSet.add(o.centro));
  (clientesTodos || []).forEach((c) => c.centro && centrosSet.add(c.centro));
  if (profile?.centro) centrosSet.add(profile.centro);

  const centros = Array.from(centrosSet).sort();

  return (
    <CentroPanel
      nombre={profile?.nombre || session.user.email || "Admin"}
      rol={profile?.rol || ""}
      centroPerfil={profile?.centro || null}
      centrosDisponibles={centros}
    />
  );
}
