// Plantilla de los comunicados masivos (Correos). Se usa igual en la vista
// previa de la pantalla y en el envío real (/api/comunicados), para que lo
// que se ve es lo que le llega al cliente.

export const LOGO_URL = "https://xpywjzdsbngcdqqzfgoh.supabase.co/storage/v1/object/public/contratos/logo-nodus-blanco.png";

export function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Cada línea del mensaje es un párrafo; las líneas en blanco separan; los
// links (http/https) se vuelven clicables. Todo lo que escribe la persona se
// escapa: no se puede meter HTML suelto.
function textoAParrafos(cuerpo: string): string {
  return cuerpo
    .split(/\r?\n/)
    .map((linea) => {
      if (!linea.trim()) return `<p style="margin:0 0 10px 0;">&nbsp;</p>`;
      const seguro = escaparHtml(linea).replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" style="color:#2563eb;">${url}</a>`
      );
      return `<p style="margin:0 0 10px 0;font-size:15px;line-height:1.55;color:#1a1a1a;">${seguro}</p>`;
    })
    .join("");
}

export function construirHtmlComunicado({
  cuerpo,
  imagenes,
  remitente,
}: {
  cuerpo: string;
  imagenes: string[];
  remitente?: string;
}): string {
  const fotos = imagenes
    .map(
      (src) =>
        `<div style="margin:14px 0;text-align:center;"><img src="${escaparHtml(src)}" alt="" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;" /></div>`
    )
    .join("");
  const firma = remitente
    ? `<p style="margin:18px 0 0 0;font-size:14px;color:#555;">${escaparHtml(remitente)}<br/>Nodus Flex Center</p>`
    : "";

  return (
    '<div style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;">' +
    '<table role="presentation" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">' +
    '<tr><td style="background:#0D1B3E;padding:28px 24px;text-align:center;">' +
    `<img src="${LOGO_URL}" alt="Nodus" style="height:40px;margin-bottom:10px;" />` +
    '<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;">NODUS</div>' +
    '<div style="color:#9aa4c4;font-size:12px;letter-spacing:2px;">FLEX CENTER</div>' +
    "</td></tr>" +
    `<tr><td style="padding:26px 24px 8px 24px;">${textoAParrafos(cuerpo)}${fotos}${firma}</td></tr>` +
    '<tr><td style="padding:12px 24px 24px 24px;text-align:center;">' +
    '<p style="margin:0;font-size:12px;color:#aaa;">Nodus Flex Center · Aguascalientes · León · San Luis Potosí</p>' +
    "</td></tr></table></div>"
  );
}
