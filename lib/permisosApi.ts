// Qué rol de personal puede usar cada acción de servidor (rutas /api que el personal
// dispara desde sus pantallas). Antes solo se comprobaba "no ser cliente": cualquier
// cuenta de personal (Ventas, Diseño…) podía llamar directo a /api/pagos/marcar-pagado,
// a /api/dar-baja-cliente, etc. Aquí cada acción lista los roles de las pantallas que
// la usan (ver lib/permisosRutas.ts). superadmin (y gerente) puede todo; un cliente, nada.
//
// Al crear una ruta /api nueva para el personal, hay que agregarla aquí y llamar a
// rolPuede() en la ruta.

import { esSuperadmin } from "./roles";

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
  pagosCrear: ["admin", "gerente", "ventas", "sistemas", "operaciones", "gerente_ventas"],
  // Cobros adicionales sueltos (/adicionales): hora extra de sala, copias, frituras…
  adicionalesCobrar: ["admin", "gerente", "gerente_ventas"],
  // Crear una tarjeta de fidelidad desde /fidelidad-admin (mismos roles que esa pantalla).
  fidelidadCrear: ["admin", "gerente"],
  // Dinero: marcar pagado, ligar pagos a facturas, bajar facturas de cualquier cliente.
  pagosMarcarPagado: ["admin", "gerente", "cobranza", "gerente_ventas"],
  pagosVincular: ["admin", "gerente", "cobranza", "gerente_ventas"],
  facturaDescargar: ["admin", "gerente", "cobranza", "gerente_ventas"],
  cotizacionAceptar: ["admin", "gerente", "gerente_ventas"],
  cotizarPptx: ["admin", "gerente", "sistemas", "operaciones", "gerente_ventas"],
  crearCliente: ["admin", "gerente", "sistemas", "gerente_ventas"],
  reenviarInvitacion: ["admin", "gerente", "sistemas", "gerente_ventas"],
  darBajaCliente: ["admin", "gerente", "sistemas", "gerente_ventas"],
  // Botón "generar facturas ahora" de Cobranza (el cron real entra con CRON_SECRET).
  cobroDiarioManual: ["admin", "gerente", "cobranza", "gerente_ventas"],
  recordatorioTours: ["admin", "gerente", "atencion_cliente", "ventas", "gerente_ventas"],
  // Correos del seguimiento de prospectos: los roles que pueden escribir en
  // prospectos (ver migracion_prospectos_actividades.sql).
  seguimientoProspectos: ["admin", "gerente", "sistemas", "operaciones", "gerente_ventas"],
  toursConfirmar: ["admin", "gerente", "atencion_cliente", "ventas", "gerente_ventas"],
  vouchers: ["admin", "gerente", "sistemas", "operaciones", "atencion_cliente", "gerente_ventas"],
};

export function rolPuede(rol: string | null | undefined, accion: AccionApi): boolean {
  if (!rol || rol === "cliente") return false;
  if (esSuperadmin(rol)) return true;
  return ROLES_POR_ACCION[accion].includes(rol);
}
