import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { hoyMexicoISO } from "@/lib/fechaMexico";

// Correos de cobranza al cliente: aviso de que su pago está por vencer, aviso
// del día de pago y agradecimiento cuando paga. Ninguno truena el flujo que
// lo llama — si el correo falla solo se registra en consola.
type Admin = ReturnType<typeof createAdminClient>;

const moneda = (n: number) =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function plantilla(titulo: string, parrafos: string[]) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0d1b3e">${titulo}</h2>
      ${parrafos.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${p}</p>`).join("")}
      <p style="margin:16px 0 0;font-size:12px;color:#888">Nodus Flex Center</p>
    </div>
  </div>`;
}

export type TipoAvisoPago = "antes" | "hoy" | "ultimo_dia";

// Aviso de cobro. "antes": se acerca la fecha; "hoy": es su día de pago;
// "ultimo_dia": último día para pagar sin recargo (contratos mes a mes).
export async function enviarAvisoPago(datos: {
  to: string | null | undefined;
  nombre: string | null | undefined;
  tipo: TipoAvisoPago;
  monto?: number | null;
  diaPago?: number;
  diasFaltan?: number;
}) {
  if (!datos.to) return;
  const nombre = datos.nombre || "cliente";
  const montoTxt = datos.monto ? ` por <strong>${moneda(datos.monto)}</strong>` : "";

  let asunto = "";
  let titulo = "";
  let parrafos: string[] = [];

  if (datos.tipo === "antes") {
    asunto = "Tu fecha de pago en Nodus se acerca";
    titulo = "Tu fecha de pago se acerca";
    parrafos = [
      `Hola ${nombre},`,
      `Te recordamos que tu pago${montoTxt} vence ${
        datos.diasFaltan ? `en ${datos.diasFaltan} días` : "pronto"
      }${datos.diaPago ? ` (día ${datos.diaPago} del mes)` : ""}.`,
      "Puedes pagarlo por SPEI o subir tu comprobante desde tu panel de cliente.",
    ];
  } else if (datos.tipo === "hoy") {
    asunto = "Hoy es tu fecha de pago en Nodus";
    titulo = "Hoy es tu fecha de pago";
    parrafos = [
      `Hola ${nombre},`,
      `Hoy es tu fecha de pago${montoTxt}.`,
      "Puedes pagarlo por SPEI o subir tu comprobante desde tu panel de cliente.",
    ];
  } else {
    asunto = "Hoy es el último día para pagar sin recargo";
    titulo = "Hoy es el último día para pagar tu renta";
    parrafos = [
      `Hola ${nombre},`,
      `Hoy es el último día para pagar tu renta${montoTxt} sin recargo.`,
      "Pasado el día 10 se genera un recargo del 3% sobre la renta. Puedes pagar por SPEI o subir tu comprobante desde tu panel de cliente.",
    ];
  }

  const r = await enviarCorreo({ to: datos.to, subject: asunto, html: plantilla(titulo, parrafos) });
  if (!r.ok) console.error(`[correosPagos] aviso "${datos.tipo}" a ${datos.to}: ${r.error}`);
}

// Gracias por pagar. Si el pago corresponde a una factura y llegó a más
// tardar en su fecha de vencimiento, se felicita "en tiempo y forma"; si
// llegó tarde (o no hay fecha que comparar) se agradece sin esa frase para
// no afirmar algo que no es cierto.
export async function enviarGraciasPorPago(admin: Admin, pagoId: string) {
  try {
    const { data: pago } = await admin
      .from("pagos")
      .select("id, user_id, monto, concepto, factura_id")
      .eq("id", pagoId)
      .maybeSingle();
    if (!pago?.user_id) return;

    const { data: cliente } = await admin.from("profiles").select("nombre, email").eq("id", pago.user_id).maybeSingle();
    if (!cliente?.email) return;

    let enTiempo = false;
    let folio: string | null = null;
    if (pago.factura_id) {
      const { data: factura } = await admin
        .from("facturas")
        .select("folio, fecha_vencimiento")
        .eq("id", pago.factura_id)
        .maybeSingle();
      folio = factura?.folio || null;
      if (factura?.fecha_vencimiento) enTiempo = hoyMexicoISO() <= factura.fecha_vencimiento;
    }

    const concepto = pago.concepto || (folio ? `Factura ${folio}` : "tu pago");
    const parrafos = [
      `Hola ${cliente.nombre || "cliente"},`,
      `¡Gracias por tu pago! Recibimos <strong>${moneda(Number(pago.monto) || 0)}</strong> por concepto de <strong>${concepto}</strong>.`,
      enTiempo
        ? "Nodus agradece tu pago en tiempo y forma."
        : "Nodus agradece tu pago y tu confianza.",
    ];

    const r = await enviarCorreo({
      to: cliente.email,
      subject: "Gracias por tu pago — Nodus Flex Center",
      html: plantilla("¡Gracias por tu pago!", parrafos),
    });
    if (!r.ok) console.error(`[correosPagos] gracias por pago ${pagoId}: ${r.error}`);
  } catch (e: any) {
    console.error(`[correosPagos] gracias por pago ${pagoId}:`, e?.message);
  }
}
