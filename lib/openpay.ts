// Cliente mínimo para la API REST de Openpay. Solo se usa en Route Handlers
// (código de servidor) — la llave privada nunca debe llegar al navegador.

const OPENPAY_URL = process.env.OPENPAY_API_URL || "https://sandbox-api.openpay.mx/v1";
const MERCHANT_ID = process.env.OPENPAY_MERCHANT_ID!;
const PRIVATE_KEY = process.env.OPENPAY_PRIVATE_KEY!;

function authHeader() {
  const token = Buffer.from(`${PRIVATE_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

export type CargoSPEI = {
  id: string;
  status: string;
  amount: number;
  payment_method?: {
    type: string;
    bank: string;
    clabe: string;
    agreement: string;
    reference?: string;
  };
  due_date?: string;
};

/**
 * Crea un cargo tipo SPEI (transferencia bancaria) en Openpay. El cliente
 * recibe una CLABE única para transferir; cuando el banco confirma el
 * depósito, Openpay marca el cargo como "completed".
 */
export async function crearCargoSPEI(opts: {
  monto: number;
  descripcion: string;
  ordenId: string;
  nombre: string;
  email: string;
  diasVigencia?: number;
}): Promise<CargoSPEI> {
  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() + (opts.diasVigencia || 3));

  const res = await fetch(`${OPENPAY_URL}/${MERCHANT_ID}/charges`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "bank_account",
      amount: opts.monto,
      description: opts.descripcion,
      order_id: opts.ordenId,
      due_date: fechaLimite.toISOString(),
      customer: { name: opts.nombre, email: opts.email },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.description || data.error_code || "Error al generar el cargo SPEI en Openpay");
  }
  return data;
}

/**
 * Vuelve a consultar el estatus real de un cargo directo en Openpay —
 * nunca hay que confiar ciegamente en lo que llega por webhook sin
 * reconfirmarlo así.
 */
export async function consultarCargo(chargeId: string): Promise<CargoSPEI> {
  const res = await fetch(`${OPENPAY_URL}/${MERCHANT_ID}/charges/${chargeId}`, {
    headers: { Authorization: authHeader() },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.description || "Error consultando el cargo en Openpay");
  }
  return data;
}

export type CargoTarjeta = {
  id: string;
  status: string; // "completed" | "charge_pending" | "in_progress" | "failed"…
  amount: number;
  error_message?: string;
  // Con 3D Secure el banco pide una verificación: Openpay regresa la liga a la
  // que hay que mandar al cliente.
  payment_method?: { type: string; url?: string };
};

/**
 * Cobra una tarjeta con el token que generó Openpay.js en el navegador. Nodus
 * nunca recibe el número de la tarjeta, solo `tokenId` y `deviceSessionId`
 * (huella antifraude). Con 3D Secure activo, si el banco pide verificar al
 * cliente el cargo queda "charge_pending" y regresa la liga de verificación en
 * `payment_method.url`; al terminar, el cliente vuelve a `redirectUrl`.
 */
export async function crearCargoTarjeta(opts: {
  tokenId: string;
  deviceSessionId: string;
  monto: number;
  descripcion: string;
  ordenId: string; // único por intento: Openpay rechaza order_id repetidos
  nombre: string;
  email: string;
  redirectUrl: string;
}): Promise<CargoTarjeta> {
  const res = await fetch(`${OPENPAY_URL}/${MERCHANT_ID}/charges`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "card",
      source_id: opts.tokenId,
      amount: opts.monto,
      currency: "MXN",
      description: opts.descripcion.slice(0, 250),
      order_id: opts.ordenId.slice(0, 100),
      device_session_id: opts.deviceSessionId,
      customer: { name: opts.nombre, email: opts.email },
      use_3d_secure: true,
      redirect_url: opts.redirectUrl,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.description || "No se pudo procesar el cargo con tarjeta");
  }
  return data;
}
