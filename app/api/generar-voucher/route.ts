import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { centroTieneUnifi, generarVoucherReal } from "@/lib/unifi";
import { AVISO_SOLO_COWORKING, esClienteCoworking } from "@/lib/coworking";
import { rolPuede } from "@/lib/permisosApi";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", session.user.id)
    .single();

  if (!rolPuede(miProfile?.rol, "vouchers")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { clienteId, minutos } = await req.json();
  if (!clienteId) {
    return NextResponse.json({ error: "Falta clienteId" }, { status: 400 });
  }

  const { data: cliente } = await supabase
    .from("profiles")
    .select("id, nombre, centro, empresa")
    .eq("id", clienteId)
    .single();

  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  // Solo clientes con Coworking vigente (las oficinas usan su propia red).
  // Para alguien más está el voucher manual (/api/voucher-manual).
  if (!(await esClienteCoworking(supabase, cliente.id))) {
    return NextResponse.json({ error: AVISO_SOLO_COWORKING }, { status: 400 });
  }

  if (!cliente.centro || !centroTieneUnifi(cliente.centro)) {
    return NextResponse.json(
      {
        error: `Todavía no hay conexión real a UniFi configurada para "${cliente.centro || "este centro"}". Por ahora solo funciona para Bosques.`,
      },
      { status: 400 }
    );
  }

  try {
    const minutosFinal = typeof minutos === "number" && minutos > 0 ? minutos : 43200;
    const { codigo, unifiId } = await generarVoucherReal(cliente.centro, {
      notaBase: `${cliente.empresa || "Nodus"} - ${cliente.nombre}`,
      minutos: minutosFinal,
    });

    const folio = `VCH-${Date.now().toString().slice(-6)}`;
    const expiraEn = new Date(Date.now() + minutosFinal * 60 * 1000).toISOString();

    const { data: voucherGuardado, error: insertError } = await supabase
      .from("vouchers")
      .insert({
        user_id: cliente.id,
        codigo,
        folio,
        centro: cliente.centro,
        generado_por: session.user.id,
        duracion_minutos: minutosFinal,
        expira_en: expiraEn,
        unifi_id: unifiId,
      })
      .select()
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
