// Qué pantallas puede abrir cada rol de personal. El middleware (middleware.ts) lo
// aplica a cada visita: quien escribe una dirección a mano que no es de su rol regresa
// a su panel. Antes solo se impedía la entrada a los clientes, y cualquier cuenta de
// personal (Ventas, Diseño…) podía abrir cualquier pantalla escribiendo su dirección.
//
// La lista sale de lo que ya ve cada rol en su panel (módulos de AdminPanel.tsx). Si
// una pantalla nueva no aparece aquí, no se restringe (queda abierta a todo el
// personal): al crear una pantalla de personal hay que agregarla a REGLAS.
//
// OJO: esto protege las PANTALLAS. Los datos siguen protegidos por RLS (que hoy
// distingue cliente de personal, no un rol de personal de otro).

export const ROLES_PERSONAL = [
  "admin",
  "superadmin",
  "gerente",
  "sistemas",
  "operaciones",
  "cobranza",
  "atencion_cliente",
  "diseno",
  "ventas",
];

// superadmin puede abrir todo, así que no se lista en cada regla.
const REGLAS: { prefijo: string; roles: string[] }[] = [
  // ----- Administración del centro -----
  { prefijo: "/contratos", roles: ["admin", "gerente", "ventas"] },
  { prefijo: "/registrar-plan", roles: ["admin", "gerente"] },
  { prefijo: "/cotizaciones", roles: ["admin", "gerente"] },
  { prefijo: "/prospectos", roles: ["admin", "gerente"] },
  { prefijo: "/paquetes", roles: ["admin", "gerente"] },
  { prefijo: "/alta-cliente", roles: ["admin", "gerente"] },
  { prefijo: "/baja-cliente", roles: ["admin", "gerente"] },
  { prefijo: "/deposito-garantia", roles: ["admin", "gerente"] },
  { prefijo: "/fidelidad-admin", roles: ["admin", "gerente"] },
  { prefijo: "/reportes", roles: ["admin", "gerente"] },
  { prefijo: "/precios-sala-juntas", roles: ["admin", "gerente", "sistemas"] },
  { prefijo: "/sala-juntas", roles: ["admin", "gerente", "ventas"] },
  { prefijo: "/correos", roles: ["admin", "gerente", "ventas"] },
  { prefijo: "/tours", roles: ["admin", "gerente", "atencion_cliente", "ventas"] },
  { prefijo: "/paqueteria", roles: ["admin", "gerente", "atencion_cliente"] },
  { prefijo: "/mapa-oficinas", roles: ["admin", "gerente", "sistemas", "operaciones", "atencion_cliente", "ventas"] },
  { prefijo: "/experiencia-cliente", roles: ["admin", "gerente", "cobranza", "atencion_cliente", "diseno", "ventas"] },
  { prefijo: "/documentacion-centro", roles: ["admin", "atencion_cliente", "diseno"] },
  { prefijo: "/inventario", roles: ["admin", "gerente", "sistemas", "operaciones", "atencion_cliente"] },

  // ----- Panel de Centro -----
  { prefijo: "/centro/resumen", roles: ["admin", "gerente", "sistemas", "operaciones"] },
  { prefijo: "/centro/invitados", roles: ["admin", "gerente"] },
  { prefijo: "/centro/solicitudes", roles: ["admin", "gerente"] },
  { prefijo: "/centro/visitas", roles: ["admin", "gerente"] },
  { prefijo: "/centro/vouchers", roles: ["admin", "gerente", "sistemas"] },
  { prefijo: "/centro/proveedores", roles: ["admin", "gerente", "sistemas", "operaciones"] },
  { prefijo: "/centro", roles: ["admin", "gerente", "sistemas", "operaciones"] },

  // ----- Dinero -----
  { prefijo: "/cobranza", roles: ["admin", "gerente", "cobranza"] },
  { prefijo: "/pagos", roles: ["admin", "gerente", "cobranza"] },
  { prefijo: "/facturas-admin", roles: ["admin", "gerente", "cobranza"] },
  { prefijo: "/ingresos-centro", roles: ["admin", "gerente", "cobranza"] },
  { prefijo: "/gastos", roles: ["admin", "gerente", "cobranza"] },
  { prefijo: "/proveedores", roles: ["admin", "gerente", "cobranza", "sistemas"] },

  // ----- Sistemas y operación -----
  { prefijo: "/tickets", roles: ["admin", "gerente", "sistemas", "operaciones"] },
  { prefijo: "/telefonia", roles: ["admin", "gerente", "sistemas"] },
  { prefijo: "/wifi-solicitudes", roles: ["gerente", "sistemas"] },
  { prefijo: "/equipos", roles: ["gerente", "sistemas"] },
  { prefijo: "/mantenimiento", roles: ["admin", "gerente", "sistemas", "operaciones"] },

  // ----- Otros roles -----
  { prefijo: "/atencion-cliente", roles: ["gerente", "atencion_cliente"] },
  { prefijo: "/diseno/plantillas", roles: ["diseno"] },
  { prefijo: "/diseno", roles: ["gerente", "diseno"] },
  { prefijo: "/decoraciones", roles: ["admin", "gerente", "diseno"] },
  { prefijo: "/usuarios", roles: ["gerente"] },
];

// Aceptar la llegada de un invitado con Day Pass (el QR lleva a esa pantalla).
const CHECKIN_DAY_PASS = /^\/day-pass\/[^/]+\/checkin\/?$/;
const ROLES_CHECKIN = ["admin", "gerente"];

const REGLAS_ORDENADAS = [...REGLAS].sort((a, b) => b.prefijo.length - a.prefijo.length);

// `rol` es un rol de personal (los clientes se manejan aparte). Regresa false si ese
// rol no debe abrir `ruta`.
export function rutaPermitida(rol: string, ruta: string): boolean {
  if (rol === "superadmin") return true;
  if (CHECKIN_DAY_PASS.test(ruta)) return ROLES_CHECKIN.includes(rol);
  const regla = REGLAS_ORDENADAS.find((r) => ruta === r.prefijo || ruta.startsWith(r.prefijo + "/"));
  if (!regla) return true;
  return regla.roles.includes(rol);
}
