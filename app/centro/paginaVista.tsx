import { redirect } from "next/navigation";
import CentroPanel, { type VistaCentro } from "./CentroPanel";
import { datosPanelCentro } from "./datosCentro";

// Pantalla propia de un módulo que antes era pestaña del Panel de Centro
// (Reservaciones, Invitados, Solicitudes, Visitas, Vouchers, Proveedores).
// `roles` es quién la ve — mismo criterio que su tarjeta en el dashboard; el
// resto vuelve al dashboard.
export async function paginaVista(vista: VistaCentro, roles: string[]) {
  const datos = await datosPanelCentro();
  if (!roles.includes(datos.rol)) redirect("/dashboard");
  return <CentroPanel {...datos} vista={vista} />;
}
