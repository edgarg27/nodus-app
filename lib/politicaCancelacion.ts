// Política de cancelación y reembolsos que ve el cliente en la app (página
// /politica-cancelacion y aviso antes de pagar). Es un BORRADOR que debe revisar un
// abogado.
//
// Cada vez que cambie el texto hay que subir la versión: se guarda con cada pago
// (pagos.politica_version) para saber qué política aceptó el cliente.

import { HORAS_ANTICIPACION_CANCELACION } from "@/lib/horasCowork";

export const POLITICA_CANCELACION_VERSION = "2026-09-borrador-2";
export const POLITICA_CANCELACION_URL = "/politica-cancelacion";

// Hasta cuántos minutos antes del inicio puede el cliente cancelar una sala en línea.
export const MINUTOS_LIMITE_CANCELACION = 30;

// Anticipo que pide Ventas para apartar una sala de juntas (además de la
// reservación en línea): si el cliente no responde a la llamada de confirmación
// o cancela después de pagarlo, no se devuelve.
export const PORCENTAJE_ANTICIPO_SALA = 50;

// Terminar un contrato antes de que acabe su plazo forzoso: se paga el 100% de
// lo que resta de ese plazo. Terminar después del plazo forzoso pero sin dar los
// 30 días naturales de aviso que pide el contrato: recargo sobre la renta de ese mes.
export const PORCENTAJE_RECARGO_AVISO_INSUFICIENTE = 25;

export type SeccionPolitica = { titulo: string; puntos: string[] };

export const POLITICA_CANCELACION_INTRO =
  "Esta política aplica a las reservaciones, paquetes de horas, contratos, pagos y depósitos de Nodus Flex Center. " +
  "Si el contrato que firmaste dice algo distinto, prevalece el contrato.";

export const POLITICA_CANCELACION_SECCIONES: SeccionPolitica[] = [
  {
    titulo: "Salas de juntas",
    puntos: [
      "Tu reservación queda pendiente hasta que el centro confirme la disponibilidad. Si la fecha pasa sin confirmarse, se cancela sola.",
      `Puedes cancelar en línea hasta ${MINUTOS_LIMITE_CANCELACION} minutos antes de la hora de inicio. Después de eso, avisa a recepción.`,
      `Para algunas reservaciones, Ventas puede pedirte un anticipo del ${PORCENTAJE_ANTICIPO_SALA}% para apartar la sala y te llamará para confirmar tu visita. Si no respondes a esa llamada o cancelas después de pagar el anticipo, no se te devuelve.`,
      "Las horas fuera del horario normal se cotizan aparte y se confirman hasta que aceptes la cotización.",
      "La sala se entrega al iniciar con una carta responsiva, y debe desocuparse 15 minutos antes de la hora de término. Eres responsable de los daños o faltantes que se detecten al entregarla.",
    ],
  },
  {
    titulo: "Horas Cowork",
    puntos: [
      "Las horas se apartan al agendar y se descuentan cuando recepción registra tu llegada.",
      `Si cancelas con ${HORAS_ANTICIPACION_CANCELACION} horas o más de anticipación, las horas se te devuelven. Con menos anticipación, o si no te presentas, se descuentan.`,
      "Las horas solo pueden usarse dentro de la vigencia de tu contrato; las que no se usen en ese periodo se pierden.",
      "El paquete de 30 horas se contrata una sola vez por persona y se paga completo al inicio. No es reembolsable una vez comprado, salvo que haya un error en el cobro.",
    ],
  },
  {
    titulo: "Contratos y pagos mensuales",
    puntos: [
      "Después del plazo forzoso inicial puedes terminar tu contrato sin responsabilidad si estás libre de adeudos y avisas por escrito con al menos 30 días naturales de anticipación.",
      `Si avisas con menos de 30 días después del plazo forzoso, se aplica un recargo del ${PORCENTAJE_RECARGO_AVISO_INSUFICIENTE}% sobre la renta de ese mes.`,
      "Si terminas el contrato antes de que acabe el plazo forzoso, pagas el 100% de las rentas que faltan para cumplirlo.",
      "La renta se factura el día 1 de cada mes y puedes pagarla sin recargo hasta el día 10. Después se aplica un recargo del 3%.",
      "Puedes cancelar tu autorización de cobro automático o eliminar tu tarjeta en cualquier momento desde Mis tarjetas; aplica a los cobros posteriores.",
    ],
  },
  {
    titulo: "Depósito en garantía",
    puntos: [
      "Se devuelve en un plazo máximo de 30 días naturales contados desde la fecha efectiva de terminación del contrato, una vez revisado que no haya adeudos ni daños.",
      "Del depósito se pueden descontar adeudos pendientes (renta, servicios, recargos) y daños o faltantes.",
      "Si el contrato se rescinde por causas imputables al cliente, el depósito puede aplicarse en su totalidad.",
    ],
  },
  {
    titulo: "Reembolsos",
    puntos: [
      "Procede el reembolso cuando hay un cobro duplicado o erróneo, o cuando el centro no puede prestar el servicio por causa propia y no aceptas reprogramar.",
      "Se pide por escrito en la recepción de tu centro, con el comprobante o folio del pago. Se devuelve por el mismo medio con el que pagaste.",
    ],
  },
  {
    titulo: "Cierres del centro",
    puntos: [
      "Si el centro cierra o no puede darte el servicio (mantenimiento, fuerza mayor, día sin servicio), te avisará y te ofrecerá reprogramar. Los días sin servicio se publican en el calendario de la app.",
    ],
  },
];

// Lo esencial en dos líneas, para el aviso antes de pagar.
export const POLITICA_CANCELACION_RESUMEN =
  `Puedes cancelar una sala hasta ${MINUTOS_LIMITE_CANCELACION} min antes de que inicie, y las horas Cowork con ${HORAS_ANTICIPACION_CANCELACION} h o más de anticipación. ` +
  "Los reembolsos se piden por escrito en recepción y se devuelven por el mismo medio de pago.";
