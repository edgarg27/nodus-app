import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DayPassCheckin from "./DayPassCheckin";

// Pantalla protegida a la que manda el QR del Day Pass. El middleware ya
// exige sesión aquí (y manda a /login?next=... si no la hay), pero se
// revalida server-side por si acaso, igual que en /centro.
export default async function DayPassCheckinPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect(`/login?next=/day-pass/${params.id}/checkin`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre, rol")
    .eq("id", session.user.id)
    .single();

  if (profile?.rol === "cliente") redirect("/dashboard-cliente");

  return <DayPassCheckin id={params.id} miNombre={profile?.nombre || session.user.email || "Staff"} />;
}
