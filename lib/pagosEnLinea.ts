// Pagos en línea (tarjeta, tarjeta guardada / cobro automático y referencias SPEI de Openpay). Están apagados
// mientras se define el proveedor (Stripe u Openpay): la app los muestra como "Próximamente", el cobro diario no
// genera cargos SPEI ni cobra tarjetas, y sus APIs no cobran. El cliente sigue pudiendo subir su comprobante de
// transferencia. Para encenderlos: NEXT_PUBLIC_PAGOS_EN_LINEA=1 en el .env y volver a construir la app.
export const PAGOS_EN_LINEA_ACTIVOS = process.env.NEXT_PUBLIC_PAGOS_EN_LINEA === "1";

export const MENSAJE_PAGOS_PROXIMAMENTE = "Los pagos en línea estarán disponibles próximamente.";
