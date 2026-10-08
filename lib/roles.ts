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
  ceo: "CEO",
  captive: "Captive",
};

export function labelRol(rol: string): string {
  return ROL_LABEL[rol] || rol;
}

// "gerente" tiene exactamente los mismos privilegios que "superadmin" (solo
// cambia el nombre que se muestra). Todo permiso de superadmin se pregunta
// con esto, no con rol === "superadmin". Las políticas RLS hacen lo mismo
// (ver migracion_gerente_igual_superadmin.sql).
export const ROLES_SUPERADMIN = ["superadmin", "gerente"];

export function esSuperadmin(rol: string | null | undefined): boolean {
  return !!rol && ROLES_SUPERADMIN.includes(rol);
}
