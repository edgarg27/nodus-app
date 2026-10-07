// Qué rol de personal puede usar cada acción de servidor (rutas /api que el personal
// dispara desde sus pantallas). Antes solo se comprobaba "no ser cliente": cualquier
// cuenta de personal (Ventas, Diseño…) podía llamar directo a /api/pagos/marcar-pagado,
// a /api/dar-baja-cliente, etc. Aquí cada acción lista los roles de las pantallas que
// la usan (ver lib/permisosRutas.ts). superadmin puede todo; un cliente, nada.
//
// Al crear una ruta /api nueva para el personal, hay que agregarla aquí y llamar a
// rolPuede() en la ruta.

export type AccionApi =
  | "pagosCrear"
  | "adicionalesCobrar"
  | "fidelidadCrear"
  | "pagosMarcarPagado"
  | "pagosVincular"
  | "facturaDescargar"
  | "cotizacionAceptar"
  | "cotizarPptx"
  | "crearCliente"
  | "reenviarInvitacion"
  | "darBajaCliente"
  | "cobroDiarioManual"
  | "recordatorioTours"
  | "seguimientoProspectos"
  | "toursConfirmar"
  | "vouchers";

const ROLES_POR_ACCION: Record<AccionApi, string[]> = {
  // Cotizar y aprobar contratos (Centro, Alta de cliente, Contratos): generan cobros sueltos.
  pagosCrear: ["admin", "gerente", "ventas", "sistemas", "operaciones"],
  // Cobros adicionales sueltos (/adicionales): hora extra de sala, copias, frituras…
  adicionalesCobrar: ["admin", "gerente"],
  // Crear una tarjeta de fidelidad desde /fidelidad-admin (mismos roles que esa pantalla).
  fidelidadCrear: ["admin", "gerente"],
  // Dinero: marcar pagado, ligar pagos a facturas, bajar facturas de cualquier cliente.
  pagosMarcarPagado: ["admin", "gerente", "cobranza"],
  pagosVincular: ["admin", "gerente", "cobranza"],
  facturaDescargar: ["admin", "gerente", "cobranza"],
  cotizacionAceptar: ["admin", "gerente"],
  cotizarPptx: ["admin", "gerente", "sistemas", "operaciones"],
  crearCliente: ["admin", "gerente", "sistemas"],
  reenviarInvitacion: ["admin", "gerente", "sistemas"],
  darBajaCliente: ["admin", "gerente", "sistemas"],
  // Botón "generar facturas ahora" de Cobranza (el cron real entra con CRON_SECRET).
  cobroDiarioManual: ["admin", "gerente", "cobranza"],
  recordatorioTours: ["admin", "gerente", "atencion_cliente", "ventas"],
  // Correos del seguimiento de prospectos: los roles que pueden escribir en
  // prospectos (ver migracion_prospectos_actividades.sql).
  seguimientoProspectos: ["admin", "gerente", "sistemas", "operaciones"],
  toursConfirmar: ["admin", "gerente", "atencion_cliente", "ventas"],
  vouchers: ["admin", "gerente", "sistemas", "operaciones", "atencion_cliente"],
};

export function rolPuede(rol: string | null | undefined, accion: AccionApi): boolean {
  if (!rol || rol === "cliente") return false;
  if (rol === "superadmin") return true;
  return ROLES_POR_ACCION[accion].includes(rol);
}
