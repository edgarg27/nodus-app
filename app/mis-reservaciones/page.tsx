import { redirect } from "next/navigation";

// "Mis Reservaciones" ahora vive como pestaña dentro de Sala de Juntas
// (/reservaciones). Esta ruta se conserva solo para que los links viejos
// (notificaciones, correos) caigan en el lugar correcto.
export default function MisReservacionesRedirect() {
  redirect("/reservaciones?tab=mis");
}
