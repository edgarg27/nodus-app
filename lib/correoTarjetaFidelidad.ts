import { enviarCorreo } from "@/lib/email";

// Solo servidor. Los mismos centros que acepta el alta pública de tarjetas
// (app/api/tarjeta-fidelidad/route.ts).
export const CENTROS_FIDELIDAD = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

const esc = (t: string) => t.replace(/</g, "&lt;");

// Correo al cliente con su folio, para que lo guarde. Va por Resend (lib/email.ts).
// Lo usan el aviso del alta pública y la tarjeta que crea el admin. Best-effort:
// si falla, la tarjeta ya está creada.
export async function enviarCorreoTarjeta({ nombre, centro, folio, email }: { nombre: string; centro: string; folio: number; email: string }) {
  const folioMostrar = "NODUS-FID-" + String(folio).padStart(6, "0");
  const r = await enviarCorreo({
    to: email,
    subject: `Tu tarjeta de fidelidad Nodus — folio ${folioMostrar}`,
    html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
          <div style="background:#0d1b3e;padding:20px 24px;border-radius:12px 12px 0 0">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">Nodus Flex Center</p>
          </div>
          <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
            <h2 style="margin:0 0 12px;font-size:18px;color:#0d1b3e">¡Listo, ${esc(nombre)}!</h2>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.5">Ya tienes tu tarjeta de fidelidad de <strong>${esc(centro)}</strong>. Este es tu folio:</p>
            <p style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:1px;color:#0d1b3e;background:#f4f5f9;padding:14px;border-radius:10px;text-align:center">${folioMostrar}</p>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.5">Guárdalo: es con lo que te identificamos para sellar tu tarjeta en cada visita. Al completar 8 sellos, el noveno servicio va por nuestra cuenta.</p>
            <p style="margin:16px 0 0;font-size:12px;color:#888">Nodus Flex Center</p>
          </div>
        </div>`,
  });
  if (!r.ok) console.error(`[tarjeta-fidelidad] correo a ${email}: ${r.error}`);
  return r;
}
