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
