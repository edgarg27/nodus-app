// Clientes dados de alta sin correo (por ejemplo, quien solo renta una sala de juntas y no quiere hacer el registro
// completo). La cuenta necesita un correo para existir, así que se le pone uno que no es real, en el dominio
// reservado ".invalid": nunca se le manda nada (lib/email.ts lo descarta) y entra con su número de usuario.
export const DOMINIO_SIN_CORREO = "sin-correo.invalid";

export function correoFicticio(numeroUsuario: string) {
  return `${numeroUsuario.toLowerCase()}@${DOMINIO_SIN_CORREO}`;
}

export function esCorreoFicticio(email: string | null | undefined) {
  return !!email && email.trim().toLowerCase().endsWith("@" + DOMINIO_SIN_CORREO);
}

// El correo para mostrar: vacío si es el ficticio.
export function correoVisible(email: string | null | undefined) {
  return email && !esCorreoFicticio(email) ? email : "";
}
