// WhatsApp del chatbot de Nodus (449 414 10 38). El bot toma los datos de
// quien quiere agendar y después una administradora del centro trabaja la
// cotización.
export const WHATSAPP_NUMERO = "524494141038";
export const WHATSAPP_MOSTRAR = "449 414 10 38";

export function whatsappUrl(mensaje: string): string {
  return `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensaje)}`;
}
