// Aviso de Privacidad que ve cualquier persona en /aviso-privacidad (sin iniciar sesión). Sigue la estructura del
// aviso de la página web de Nodus, con los datos que hoy recaba la app y los proveedores que usa. Antes de
// publicarlo como definitivo conviene que lo revise un abogado.
//
// Si cambia el texto, actualizar AVISO_PRIVACIDAD_FECHA.

export const AVISO_PRIVACIDAD_URL = "/aviso-privacidad";
export const AVISO_PRIVACIDAD_FECHA = "Octubre 2026";
export const CORREO_PRIVACIDAD = "servicioalcliente@nodusbc.mx";

export const RESPONSABLE =
  "NBC COMPANY, S.A.P.I. de C.V. (Nodus Flex Center), con domicilio en Prolongación Zaragoza 4200, Piso 1 Int. 7, " +
  "Col. Trojes de Alonso, C.P. 20116, Aguascalientes, Ags., es responsable de recabar tus datos personales, del uso " +
  "que se le dé a los mismos, así como de su protección.";

export type SeccionAviso = { titulo: string; texto?: string; puntos?: string[]; cierre?: string };

export const AVISO_PRIVACIDAD_SECCIONES: SeccionAviso[] = [
  {
    titulo: "¿Para qué usamos tus datos?",
    texto: "La información que nos proporciones será utilizada exclusivamente para:",
    puntos: [
      "Proveer los servicios y productos que contrates: oficina privada, coworking, working desk, sala de juntas, Day Pass y servicios adicionales.",
      "Crear y administrar tu cuenta en la app, tu contrato y su firma electrónica.",
      "Registrar tus pagos, emitir tus facturas (CFDI) y enviarte tu estado de cuenta.",
      "Darte acceso al centro: WiFi, reservaciones, registro de tus visitas e invitados, y avisarte de tu paquetería o correspondencia.",
      "Atender tus solicitudes, tickets de soporte, quejas y sugerencias.",
      "Dar cumplimiento a las obligaciones contraídas contigo.",
      "Enviarte avisos relacionados con el servicio contratado: confirmaciones, recordatorios de pago y notificaciones en la app.",
      "Informarte sobre cambios en nuestros productos o servicios.",
      "Informarte sobre nuevos productos, servicios, eventos o promociones relacionados con lo que contrataste.",
    ],
    cierre:
      "El último punto (novedades, eventos y promociones) no es necesario para darte el servicio: puedes pedirnos en cualquier momento que dejemos de enviártelo, sin que esto afecte lo que ya contrataste.",
  },
  {
    titulo: "¿Qué datos recabamos?",
    texto:
      "Los datos personales que recabamos de nuestros clientes son los siguientes, y los obtenemos de manera directa cuando tú mismo nos los proporcionas al solicitar nuestros servicios o al usar la app:",
    puntos: [
      "Identificación y contacto: nombre o razón social, teléfono, correo electrónico, dirección, empresa y fecha de nacimiento.",
      "Datos fiscales: RFC, razón social, régimen fiscal, código postal fiscal y uso de CFDI, para poder facturarte.",
      "Documentos que entregues para tu expediente o contrato: identificación oficial, constancia de situación fiscal, comprobante de domicilio y comprobantes de pago.",
      "Datos de uso del servicio: reservaciones, horas de coworking, visitas, invitados que registres, paquetería recibida a tu nombre y extensión telefónica asignada.",
      "Datos de acceso a la app: tu correo y contraseña (la contraseña se guarda cifrada; nadie en Nodus puede verla).",
    ],
    cierre:
      "Si registras a un invitado o visitante, nos compartes su nombre y datos de contacto solo para permitirle el acceso al centro. No recabamos datos personales sensibles.",
  },
  {
    titulo: "¿Con quién compartimos tus datos?",
    texto:
      "Tus datos personales serán considerados como confidenciales y no serán vendidos, divulgados ni se les dará un uso distinto al señalado en este aviso. Solo compartimos lo estrictamente necesario con los proveedores que nos ayudan a darte el servicio, y que tratan tus datos únicamente bajo nuestras instrucciones:",
    puntos: [
      "Proveedor de facturación electrónica, para timbrar tus facturas (CFDI) ante el SAT.",
      "Proveedor de firma electrónica, para la firma de tu contrato.",
      "Proveedores de envío de correos y de notificaciones de la app, para hacerte llegar los avisos del servicio.",
      "Proveedor de servicios en la nube, donde se guarda de forma segura la información de la app.",
      "Proveedor de la red WiFi del centro, para darte acceso.",
      "Procesador de pagos, únicamente cuando pagues en línea con tarjeta: el número de tu tarjeta lo recibe y guarda directamente el procesador; Nodus nunca lo ve ni lo almacena.",
    ],
    cierre: "Fuera de estos casos, no compartimos tus datos con terceros sin tu consentimiento, salvo que una autoridad o la ley nos lo exijan.",
  },
  {
    titulo: "Tus derechos ARCO y cómo revocar tu consentimiento",
    texto:
      "En todo momento podrás revocar el consentimiento que nos has otorgado para el tratamiento de tus datos personales, a fin de que dejemos de hacer uso de los mismos; solicitar dejar de recibir información o correspondencia de nuestra parte; y ejercer los derechos de acceso, rectificación, cancelación y oposición (ARCO) respecto de tus datos personales, de conformidad con la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.",
    cierre: `Para hacerlo, envía tu solicitud en cualquier momento al correo ${CORREO_PRIVACIDAD}, acompañada de una identificación oficial del titular de los datos e indicando qué derecho quieres ejercer. Por el mismo medio te comunicaremos el resultado de tu petición en un plazo máximo de 20 días hábiles a partir de que la recibamos.`,
  },
  {
    titulo: "Cookies",
    texto:
      "La app solo usa las cookies necesarias para mantener tu sesión iniciada. No usamos herramientas de rastreo ni de publicidad de terceros.",
  },
  {
    titulo: "Cambios a este aviso",
    texto:
      "El presente aviso de privacidad puede ser modificado en el futuro. Cualquier cambio te será dado a conocer por correo electrónico y con la publicación de la nueva versión en esta misma página de la app, así como en nuestra página web www.nodusbc.mx.",
  },
];
