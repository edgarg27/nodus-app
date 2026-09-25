// Política de cancelación y reembolsos que ve el cliente en la app (página
// /politica-cancelacion y aviso antes de pagar). Es un BORRADOR que debe revisar un
// abogado. Solo trae las reglas que el sistema y los contratos ya aplican: los
// puntos que el negocio todavía no define (cargo por cancelación tardía, reembolso
// del paquete de 30 horas, pena por terminar antes del plazo forzoso, plazo de
// reembolsos…) se agregan aquí cuando se decidan.
//
// Cada vez que cambie el texto hay que subir la versión: se guarda con cada pago
// (pagos.politica_version) para saber qué política aceptó el cliente.

import { HORAS_ANTICIPACION_CANCELACION } from "@/lib/horasCowork";

export const POLITICA_CANCELACION_VERSION = "2026-09-borrador-1";
export const POLITICA_CANCELACION_URL = "/politica-cancelacion";

// Hasta cuántos minutos antes del inicio puede el cliente cancelar una sala en línea.
export const MINUTOS_LIMITE_CANCELACION = 30;

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
      "El paquete de 30 horas se contrata una sola vez por persona y se paga completo al inicio.",
    ],
  },
  {
    titulo: "Contratos y pagos mensuales",
    puntos: [
      "Después del plazo forzoso inicial puedes terminar tu contrato sin responsabilidad si estás libre de adeudos y avisas por escrito con al menos 30 días naturales de anticipación.",
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
