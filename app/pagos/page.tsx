import { redirect } from "next/navigation";

// Pagos se unificó en Cobranza: ahí se marcan pagados (con comprobante, fecha y forma de pago).
export default function PagosPage() {
  redirect("/cobranza");
}
