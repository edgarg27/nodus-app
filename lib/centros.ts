// Dirección completa por centro, para los correos de confirmación de Tours
// y de envío a firma — antes solo existía CIUDAD_POR_CENTRO en
// app/api/crear-cliente/route.ts, que da la ciudad pero no la calle.
// Completar conforme se tengan las direcciones de los demás centros.
export const UBICACION_POR_CENTRO: Record<string, string | null> = {
  Bosques: "Av Aguascalientes Norte #517 interior 1, Fraccionamiento Bosques del Prado Sur, CP 20130, Aguascalientes, Ags.",
  "Punto 45": null,
  "San Telmo": null,
  "Puerta Bajío Piso 2": null,
  "Puerta Bajío Piso 8": null,
  Stadium: null,
  ILEVA: null,
};

// Código postal de cada centro: es el "lugar de expedición" de las facturas y el que se
// usa en una factura a público en general. Completar conforme se tengan.
export const CP_POR_CENTRO: Record<string, string | null> = {
  Bosques: "20130",
  "Punto 45": null,
  "San Telmo": null,
  "Puerta Bajío Piso 2": null,
  "Puerta Bajío Piso 8": null,
  Stadium: null,
  ILEVA: null,
};

export function cpCentro(centro: string | null | undefined): string {
  return (centro && CP_POR_CENTRO[centro]) || "";
}

export function ubicacionCentro(centro: string): string {
  return UBICACION_POR_CENTRO[centro] || `Centro ${centro}`;
}

// Serie de las facturas de cada centro (la lleva el CFDI junto con el folio: A12, SNT3…).
// El folio cuenta por separado en cada serie. Definidas por el área de facturación.
export const SERIE_POR_CENTRO: Record<string, string> = {
  Bosques: "A",
  "Punto 45": "P45",
  "San Telmo": "SNT",
  "Puerta Bajío Piso 2": "PB2",
  "Puerta Bajío Piso 8": "PB8",
  Stadium: "STA",
  ILEVA: "ILE",
};

export function serieCentro(centro: string | null | undefined): string | null {
  return (centro && SERIE_POR_CENTRO[centro]) || null;
}
