import { redirect } from "next/navigation";

// El Panel de Centro ya no existe como pantalla con pestañas: cada módulo
// tiene la suya. Los enlaces viejos (/centro?tab=…) se mandan a donde
// corresponde.
const DESTINO_POR_TAB: Record<string, string> = {
  reservaciones: "/sala-juntas",
  invitados: "/centro/invitados",
  solicitudes: "/centro/solicitudes",
  visitas: "/centro/visitas",
  vouchers: "/centro/vouchers",
  proveedores: "/centro/proveedores",
  resumen: "/centro/resumen",
  prospectos: "/prospectos",
  telefonia: "/telefonia",
  internet: "/telefonia",
};

export default function CentroPage({ searchParams }: { searchParams: { tab?: string } }) {
  redirect(DESTINO_POR_TAB[searchParams.tab || ""] || "/dashboard");
}
