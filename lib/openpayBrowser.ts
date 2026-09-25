// Openpay.js en el navegador: convierte la tarjeta en un token y genera la huella
// antifraude (device session). Nodus nunca recibe el número de la tarjeta.

declare global {
  interface Window {
    OpenPay?: any;
  }
}

const OPENPAY_JS = "https://resources.openpay.mx/lib/openpay-js/1.2.38/openpay.v1.min.js";
const OPENPAY_DATA_JS = "https://resources.openpay.mx/lib/openpay-data-js/1.2.38/openpay-data.v1.min.js";

function cargarScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.body.appendChild(s);
  });
}

export const configOpenpay = {
  merchantId: process.env.NEXT_PUBLIC_OPENPAY_MERCHANT_ID || "",
  publicKey: process.env.NEXT_PUBLIC_OPENPAY_PUBLIC_KEY || "",
  sandbox: process.env.NEXT_PUBLIC_OPENPAY_SANDBOX !== "false",
  get configurado() {
    return !!this.merchantId && !!this.publicKey;
  },
};

// El formulario (con ese id) ya debe estar en pantalla: Openpay le agrega un campo
// oculto con la huella antifraude.
export async function prepararOpenpay(formId: string): Promise<{ OP: any; deviceSessionId: string }> {
  await cargarScript(OPENPAY_JS);
  await cargarScript(OPENPAY_DATA_JS);
  const OP = window.OpenPay;
  if (!OP) throw new Error("Openpay no cargó");
  OP.setId(configOpenpay.merchantId);
  OP.setApiKey(configOpenpay.publicKey);
  OP.setSandboxMode(configOpenpay.sandbox);
  const deviceSessionId = OP.deviceData.setup(formId, "device_session_id");
  return { OP, deviceSessionId };
}
