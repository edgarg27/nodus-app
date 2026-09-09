import { redirect } from "next/navigation";

export default function FacturasPage() {
  // La pantalla "Facturas" de la app todavía usa datos de prueba fijos (no conectada a
  // Supabase). Estado de Cuenta sí tiene las facturas reales del cliente, así que
  // mandamos ahí en lo que se construye esa pantalla en la app.
  redirect("/estado-cuenta");
}
