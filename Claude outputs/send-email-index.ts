import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = 're_Vx19uLSf_9FAFTMekj9S2SbHmmBRJXbAZ';

const EMAILS: { [key: string]: string | string[] } = {
  sistemas: ['it.aux@nodusbc.mx', 'it.admin@nodusbc.mx'],
  mantenimiento: 'proyectos@nodusbc.mx',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LOGO_URL = 'https://xpywjzdsbngcdqqzfgoh.supabase.co/storage/v1/object/public/contratos/logo-nodus-blanco.png';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('Body recibido:', JSON.stringify(body));

    const tipo = body.tipo;
    const categoria = body.categoria;
    const folio = body.folio;
    const asunto = body.asunto;
    const descripcion = body.descripcion;
    const clienteNombre = body.clienteNombre;
    const clienteEmail = body.clienteEmail;
    const centro = body.centro;
    const numeroOficina = body.numeroOficina;

    if (tipo === 'nuevo_ticket') {
      const destinatario = EMAILS[categoria];
      const to = Array.isArray(destinatario) ? destinatario : [destinatario];
      const categoriaLabel = categoria === 'sistemas' ? 'Reporte de Sistemas' : 'Reporte de Mantenimiento';
      const oficinaMostrar = numeroOficina && numeroOficina.trim() !== '' ? numeroOficina : 'No especificada';

      const html = '<div style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;">' +
        '<table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">' +
        '<tr><td style="background:#0D1B3E;padding:32px 24px;text-align:center;">' +
        '<img src="' + LOGO_URL + '" alt="Nodus" style="height:40px;margin-bottom:12px;" />' +
        '<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;">NODUS</div>' +
        '<div style="color:#9aa4c4;font-size:12px;letter-spacing:2px;">FLEX CENTER</div>' +
        '</td></tr>' +
        '<tr><td style="padding:28px 24px 0 24px;text-align:center;">' +
        '<span style="display:inline-block;background:#e6f1fb;color:#0D1B3E;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;">' + categoriaLabel + '</span>' +
        '<h2 style="margin:16px 0 4px 0;color:#0D1B3E;font-size:20px;">Nuevo reporte recibido</h2>' +
        '<div style="color:#F07E3A;font-weight:700;font-size:15px;">' + folio + '</div>' +
        '</td></tr>' +
        '<tr><td style="padding:20px 24px 24px 24px;">' +
        '<table role="presentation" style="width:100%;background:#fafafa;border-radius:8px;" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:14px 16px;border-bottom:1px solid #eee;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Asunto</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + asunto + '</p></td></tr>' +
        '<tr><td style="padding:14px 16px;border-bottom:1px solid #eee;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Descripción</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;">' + descripcion + '</p></td></tr>' +
        '<tr><td style="padding:14px 16px;border-bottom:1px solid #eee;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Cliente</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + clienteNombre + '</p>' +
        '<p style="margin:0;font-size:13px;"><a href="mailto:' + clienteEmail + '" style="color:#2563eb;">' + clienteEmail + '</a></p></td></tr>' +
        '<tr><td style="padding:14px 16px;border-bottom:1px solid #eee;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Centro</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + centro + '</p></td></tr>' +
        '<tr><td style="padding:14px 16px;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Oficina</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + oficinaMostrar + '</p></td></tr>' +
        '</table></td></tr>' +
        '<tr><td style="padding:0 24px 24px 24px;text-align:center;">' +
        '<p style="margin:0;font-size:12px;color:#aaa;">Nodus Flex Center · Aguascalientes · León · San Luis Potosí</p>' +
        '<p style="margin:4px 0 0 0;font-size:11px;color:#ccc;">Este es un correo automático, por favor no responder.</p>' +
        '</td></tr></table></div>';

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@nodusbc.mx',
          to,
          subject: `[${folio}] Nuevo reporte: ${asunto}`,
          html,
        }),
      });

      const resBody = await res.json();
      console.log('Respuesta Resend:', JSON.stringify(resBody));
    }

    if (tipo === 'ticket_resuelto') {
      const clienteEmailResuelto = body.clienteEmail;
      const clienteNombreResuelto = body.clienteNombre;
      const folioResuelto = body.folio;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@nodusbc.mx',
          to: [clienteEmailResuelto],
          subject: `[${folioResuelto}] Tu reporte ha sido resuelto`,
          html: '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;padding:24px;"><h2 style="color:#0D1B3E;">Reporte resuelto</h2><p>Hola ' + clienteNombreResuelto + ', tu reporte <strong style="color:#F07E3A;">' + folioResuelto + '</strong> ha sido resuelto.</p></div>',
        }),
      });

      const resBody = await res.json();
      console.log('Respuesta Resend:', JSON.stringify(resBody));
    }

    if (tipo === 'day_pass_generado') {
      const clienteEmailDP = body.clienteEmail;
      const clienteNombreDP = body.clienteNombre;
      const tipoDayPass = body.tipoDayPass;
      const centroDP = body.centro;
      const fechaDP = body.fecha;
      const folioDP = body.folio;
      const linkDP = body.link;

      const tipoLabel = tipoDayPass === 'coworking' ? 'Coworking' : 'Oficina privada';
      const folioMostrar = 'NODUS-' + String(folioDP).padStart(3, '0');

      const html = '<div style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;">' +
        '<table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">' +
        '<tr><td style="background:#0D1B3E;padding:32px 24px;text-align:center;">' +
        '<img src="' + LOGO_URL + '" alt="Nodus" style="height:40px;margin-bottom:12px;" />' +
        '<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:1px;">NODUS</div>' +
        '<div style="color:#9aa4c4;font-size:12px;letter-spacing:2px;">FLEX CENTER</div>' +
        '</td></tr>' +
        '<tr><td style="padding:28px 24px 0 24px;text-align:center;">' +
        '<span style="display:inline-block;background:#e6f1fb;color:#0D1B3E;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;">' + tipoLabel + '</span>' +
        '<h2 style="margin:16px 0 4px 0;color:#0D1B3E;font-size:20px;">Tu Day Pass está listo</h2>' +
        '<div style="color:#F07E3A;font-weight:700;font-size:15px;">' + folioMostrar + '</div>' +
        '</td></tr>' +
        '<tr><td style="padding:20px 24px 24px 24px;">' +
        '<p style="margin:0 0 16px 0;font-size:14px;color:#1a1a1a;">Hola ' + clienteNombreDP + ', este es tu Day Pass para trabajar un día en ' + (tipoDayPass === 'coworking' ? 'nuestro coworking' : 'tu oficina privada') + '. Muéstralo en recepción al llegar.</p>' +
        '<table role="presentation" style="width:100%;background:#fafafa;border-radius:8px;" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:14px 16px;border-bottom:1px solid #eee;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Fecha</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + fechaDP + '</p></td></tr>' +
        '<tr><td style="padding:14px 16px;">' +
        '<p style="margin:0 0 4px 0;font-size:11px;color:#888;text-transform:uppercase;">Centro</p>' +
        '<p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:700;">' + centroDP + '</p></td></tr>' +
        '</table>' +
        '<div style="text-align:center;margin-top:24px;">' +
        '<a href="' + linkDP + '" style="display:inline-block;background:#F07E3A;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;">Ver mi Day Pass y código QR</a>' +
        '</div>' +
        '<p style="margin:16px 0 0 0;font-size:12px;color:#999;text-align:center;">O copia este link: <a href="' + linkDP + '" style="color:#2563eb;">' + linkDP + '</a></p>' +
        '</td></tr>' +
        '<tr><td style="padding:0 24px 24px 24px;text-align:center;">' +
        '<p style="margin:0;font-size:12px;color:#aaa;">Nodus Flex Center · Aguascalientes · León · San Luis Potosí</p>' +
        '<p style="margin:4px 0 0 0;font-size:11px;color:#ccc;">Este es un correo automático, por favor no responder.</p>' +
        '</td></tr></table></div>';

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'noreply@nodusbc.mx',
          to: [clienteEmailDP],
          subject: 'Tu Day Pass Nodus - ' + tipoLabel,
          html,
        }),
      });

      const resBody = await res.json();
      console.log('Respuesta Resend:', JSON.stringify(resBody));
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
