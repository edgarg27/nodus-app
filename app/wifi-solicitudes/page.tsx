import { redirect } from "next/navigation";

// Las solicitudes de WiFi ahora viven dentro de Vouchers
// (app/centro/SolicitudesWifi.tsx). Esta ruta solo redirige los enlaces
// viejos (notificaciones, marcadores).
export default function WifiSolicitudesPage() {
  redirect("/centro/vouchers");
}
