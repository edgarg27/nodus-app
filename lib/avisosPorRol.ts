// Qué avisos (tabla notificaciones) ve cada rol de personal en la campana del
// panel (app/dashboard/AdminPanel.tsx). Un solo lugar: al crear un tipo de
// aviso nuevo o un rol nuevo, se agrega aquí.
//
// Regla: a cada rol solo le llegan avisos de los módulos que tiene
// (lib/permisosRutas.ts). Los avisos que la app le manda al CLIENTE
// ("Te llegó un paquete", "Hoy es tu fecha de pago"…) no van en ninguna
// lista: son para el panel del cliente, no para el personal.
// CEO y Captive no tienen campana (su panel es solo de consulta).

// Avisos dirigidos al personal, con el módulo del que salen.
const PERSONAL = {
  tickets: ["nuevo_ticket", "ticket_en_proceso", "ticket_resuelto", "ticket_comentario"],
  mantenimiento: ["proximo_mantenimiento"],
  telefonia: ["nuevo_did", "baja_extension"],
  vouchers: ["nuevo_voucher"],
  cobros: ["pago_confirmado", "factura_automatica_fallida"],
  gastos: ["nuevo_gasto"],
  tours: ["nuevo_tour"],
  contratosAFirma: ["contrato_a_firma"],
  // Sala de juntas: aviso informativo (aceptar/rechazar sigue siendo de la
  // admin, el gerente y el superadmin; a Ventas no le salen esos botones).
  salaJuntas: ["nueva_reservacion", "reservacion_cancelada_cliente"],
  centro: [
    "nueva_solicitud_invitado",
    "solicitud_cliente",
    "visita_cliente",
    "nueva_tarjeta_fidelidad",
  ],
  quejas: ["nueva_queja"],
  logros: ["nuevo_logro"],
};

const todosLosDePersonal = Object.values(PERSONAL).flat();
const sin = (lista: string[], quitar: string[]) => lista.filter((t) => !quitar.includes(t));

// "Contrato a firma" es solo de Ventas; quejas y logros solo del superadmin
// (y de Atención al Cliente / Diseño, que son sus módulos).
export const AVISOS_POR_ROL: Record<string, string[]> = {
  superadmin: sin(todosLosDePersonal, PERSONAL.contratosAFirma),
  // Gerente = superadmin con otro nombre.
  gerente: sin(todosLosDePersonal, PERSONAL.contratosAFirma),
  admin: sin(todosLosDePersonal, [...PERSONAL.contratosAFirma, ...PERSONAL.quejas, ...PERSONAL.logros]),
  sistemas: [...PERSONAL.tickets, ...PERSONAL.telefonia, ...PERSONAL.vouchers],
  operaciones: [...PERSONAL.tickets, ...PERSONAL.mantenimiento],
  cobranza: [...PERSONAL.cobros, ...PERSONAL.gastos],
  atencion_cliente: [...PERSONAL.quejas, ...PERSONAL.tours],
  diseno: [...PERSONAL.logros],
  ventas: [...PERSONAL.tours, ...PERSONAL.contratosAFirma, ...PERSONAL.salaJuntas],
  gerente_ventas: [...PERSONAL.tours, ...PERSONAL.contratosAFirma, ...PERSONAL.cobros],
};

// Respuestas a algo que pidió esa misma persona (p. ej. una reservación de
// sala que solicitó Ventas): le llegan a quien la pidió, sea cual sea su rol.
export const AVISOS_PROPIOS = ["reservacion_confirmada", "reservacion_rechazada"];

const TICKETS = PERSONAL.tickets;

// Filtro fino que el tipo solo no resuelve: un aviso de ticket le toca a
// Sistemas si es de categoría "sistemas" y a Operaciones si es de
// "mantenimiento".
export function avisoEsParaRol(rol: string, aviso: { tipo: string; categoria?: string | null }): boolean {
  if (rol === "sistemas" && TICKETS.includes(aviso.tipo)) return aviso.categoria === "sistemas";
  if (rol === "operaciones" && TICKETS.includes(aviso.tipo)) return aviso.categoria === "mantenimiento";
  return true;
}
