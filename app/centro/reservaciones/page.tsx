import { redirect } from "next/navigation";

// Reservaciones ya no es una pantalla aparte: es la primera pestaña de Sala de
// Juntas. Se deja esta ruta solo para que los enlaces viejos sigan funcionando.
export default function ReservacionesPage() {
  redirect("/sala-juntas");
}
