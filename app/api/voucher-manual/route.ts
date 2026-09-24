import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { centroTieneUnifi, generarVoucherReal } from "@/lib/unifi";

// Voucher manual "por si acaso" desde el módulo Vouchers: para quien sea
// (una visita, un proveedor, alguien de paso), sin ligarlo a un cliente ni
// a la regla de Coworking. Se guarda con user_id null y el nombre en
// "para" (migracion_vouchers_manuales.sql).
const ROLES_PERMITIDOS = ["admin", "superadmin", "gerente", "sistemas"];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!miProfile || !ROLES_PERMITIDOS.includes(miProfile.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { para, minutos, centro } = await req.json();
  const paraLimpio = typeof para === "string" ? para.trim().slice(0, 120) : "";
  if (!paraLimpio) {
    return NextResponse.json({ error: "Escribe para quién es el voucher" }, { status: 400 });
  }
  // La admin solo genera para su propio centro; los roles globales eligen.
  const centroFinal: string | null = miProfile.rol === "admin" ? miProfile.centro : typeof centro === "string" ? centro : null;
  if (!centroFinal || !centroTieneUnifi(centroFinal)) {
    return NextResponse.json(
      {
        error: `Todavía no hay conexión real a UniFi configurada para "${centroFinal || "este centro"}". Por ahora solo funciona para Bosques.`,
      },
      { status: 400 }
    );
  }

  try {
    const minutosFinal = typeof minutos === "number" && minutos > 0 ? minutos : 1440;
    const { codigo, unifiId } = await generarVoucherReal(centroFinal, {
      notaBase: `Manual - ${paraLimpio}`,
      minutos: minutosFinal,
    });

    const admin = createAdminClient();
    const { data: voucherGuardado, error: insertError } = await admin
      .from("vouchers")
      .insert({
        user_id: null,
        para: paraLimpio,
        codigo,
        folio: `VCH-${Date.now().toString().slice(-6)}`,
        centro: centroFinal,
        generado_por: session.user.id,
        duracion_minutos: minutosFinal,
        expira_en: new Date(Date.now() + minutosFinal * 60 * 1000).toISOString(),
        unifi_id: unifiId,
      })
      .select("id, codigo, folio, user_id, para, created_at, expira_en")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "El voucher se creó en UniFi pero no se pudo guardar en la base. Código: " + codigo },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, voucher: voucherGuardado });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error generando el voucher" }, { status: 500 });
  }
}
