import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { agregarTarjetaACliente, crearClienteOpenpay } from "@/lib/openpay";
import { CONSENTIMIENTO_COBROS_VERSION } from "@/lib/consentimientoCobros";
import { checkRateLimit, ipDeRequest } from "@/lib/rateLimit";

// Guarda una tarjeta del cliente en Openpay (con el token que generó Openpay.js: el
// número nunca pasa por aquí) y, si el cliente lo autoriza, la deja como su
// tarjeta de cobro automático. Las tarjetas las lee el propio cliente con RLS;
// solo este servidor las crea, cambia o borra.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!checkRateLimit(`tarjetas:${session.user.id}:${ipDeRequest(req.headers)}`, 6, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
  }

  const { tokenId, deviceSessionId, cobroAutomatico, consentimiento } = await req.json();
  if (!tokenId || !deviceSessionId) return NextResponse.json({ error: "Faltan datos de la tarjeta" }, { status: 400 });
  if (cobroAutomatico && consentimiento !== true) {
    return NextResponse.json({ error: "Para activar el cobro automático hay que aceptar la autorización" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: perfil } = await admin.from("profiles").select("nombre, email, rol").eq("id", session.user.id).maybeSingle();
  if (!perfil) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });

  try {
    // Un solo cliente de Openpay por cuenta de Nodus.
    const { data: previa } = await admin
      .from("tarjetas_guardadas")
      .select("openpay_customer_id")
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle();
    let customerId = previa?.openpay_customer_id as string | undefined;
    if (!customerId) {
      const cliente = await crearClienteOpenpay({
        nombre: perfil.nombre || "Cliente Nodus",
        email: perfil.email || session.user.email || "",
        externalId: session.user.id,
      });
      customerId = cliente.id;
    }

    const tarjeta = await agregarTarjetaACliente(customerId, tokenId, deviceSessionId);

    // Solo una tarjeta con cobro automático: al activar esta, se apaga la anterior.
    if (cobroAutomatico) {
      await admin.from("tarjetas_guardadas").update({ cobro_automatico: false }).eq("user_id", session.user.id);
    }
    const { data: fila, error } = await admin
      .from("tarjetas_guardadas")
      .insert({
        user_id: session.user.id,
        openpay_customer_id: customerId,
        openpay_card_id: tarjeta.id,
        marca: tarjeta.brand || null,
        ultimos4: (tarjeta.card_number || "").slice(-4) || null,
        vence_mes: tarjeta.expiration_month || null,
        vence_anio: tarjeta.expiration_year || null,
        titular: tarjeta.holder_name || null,
        banco: tarjeta.bank_name || null,
        cobro_automatico: !!cobroAutomatico,
        ...(cobroAutomatico
          ? {
              consentimiento_at: new Date().toISOString(),
              consentimiento_version: CONSENTIMIENTO_COBROS_VERSION,
              consentimiento_ip: ipDeRequest(req.headers),
            }
          : {}),
      })
      .select("id, marca, ultimos4, vence_mes, vence_anio, cobro_automatico")
      .single();
    if (error || !fila) {
      return NextResponse.json({ error: "La tarjeta se guardó en Openpay pero no en Nodus. Avisa al centro." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, tarjeta: fila });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "No se pudo guardar la tarjeta" }, { status: 402 });
  }
}
