// Texto que acepta el cliente para el cobro automático con tarjeta. Es un
// BORRADOR que debe revisar un abogado y luego ir también en los Términos y
// Condiciones. Cada vez que cambie, hay que subir la versión: se guarda con
// cada aceptación (tarjetas_guardadas.consentimiento_version).

export const CONSENTIMIENTO_COBROS_VERSION = "2026-09-borrador-1";

export const CONSENTIMIENTO_COBROS_TEXTO =
  "Autorizo a Nodus Flex Center a cobrar automáticamente a esta tarjeta, cada mes, el importe de la renta y de los " +
  "servicios adicionales de mi contrato, con su IVA, en la fecha en que se generen. Si el cobro no se puede realizar, " +
  "recibiré un aviso y podré pagar por transferencia SPEI o con otra tarjeta. Puedo cancelar esta autorización o " +
  "eliminar la tarjeta en cualquier momento desde Mis tarjetas, y la cancelación aplica a los cobros posteriores. " +
  "Mis datos de tarjeta los guarda Openpay; Nodus no los conserva.";

// Con cuántos cobros automáticos fallidos seguidos se apaga solo el cobro automático.
export const FALLOS_PARA_APAGAR_COBRO_AUTOMATICO = 3;
