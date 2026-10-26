// Nombre para mostrar de cada rol de staff — el valor real en
// profiles.rol se queda igual (lo usa todo el código y las políticas RLS
// de Supabase); esto es solo para que no se vea "atencion_cliente" tal
// cual en pantalla. Mismos textos que ya usa app/usuarios/page.tsx.
export const ROL_LABEL: Record<string, string> = {
  admin: "Admin",
  superadmin: "Superadmin",
  gerente: "Gerente",
  sistemas: "Sistemas",
  operaciones: "Operaciones",
  cobranza: "Cobranza",
  atencion_cliente: "Atención al Cliente",
  diseno: "Diseño",
  ventas: "Asesora de Ventas",
  gerente_ventas: "Gerente de Ventas",
  ejecutiva_ventas: "Ejecutiva de Ventas",
  ceo: "CEO",
  captive: "Captive",
};

export function labelRol(rol: string): string {
  return ROL_LABEL[rol] || rol;
}

// Roles que trabajan solo con algunos centros (no uno solo ni todos): registran y
// modifican únicamente en estos; lo de otros centros lo ven de solo consulta. La base
// los limita igual (ver migracion_rol_ejecutiva_ventas_2.sql y _3.sql).
export const CENTROS_POR_ROL: Record<string, string[]> = {
  ejecutiva_ventas: ["Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium"],
};

// "gerente" tiene exactamente los mismos privilegios que "superadmin" (solo
// cambia el nombre que se muestra). Todo permiso de superadmin se pregunta
// con esto, no con rol === "superadmin". Las políticas RLS hacen lo mismo
// (ver migracion_gerente_igual_superadmin.sql).
export const ROLES_SUPERADMIN = ["superadmin", "gerente"];

export function esSuperadmin(rol: string | null | undefined): boolean {
  return !!rol && ROLES_SUPERADMIN.includes(rol);
}
