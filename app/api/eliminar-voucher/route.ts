import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { eliminarVoucherReal } from "@/lib/unifi";

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

  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { voucherId } = await req.json();
  if (!voucherId) {
    return NextResponse.json({ error: "Falta voucherId" }, { status: 400 });
  }

  const { data: voucher } = await supabase
    .from("vouchers")
    .select("id, centro, unifi_id")
    .eq("id", voucherId)
    .single();

  if (!voucher) {
    return NextResponse.json({ error: "Voucher no encontrado" }, { status: 404 });
  }

  // Si tiene unifi_id, es un voucher real: hay que borrarlo también del
  // controlador, si no se queda "vivo" ahí aunque ya no aparezca en Nodus.
  if (voucher.unifi_id && voucher.centro) {
    try {
      await eliminarVoucherReal(voucher.centro, voucher.unifi_id);
    } catch (err: any) {
      return NextResponse.json(
        { error: "No se pudo borrar el voucher de UniFi: " + (err.message || "error desconocido") },
        { status: 500 }
      );
    }
  }

  const { error: deleteError } = await supabase.from("vouchers").delete().eq("id", voucherId);
  if (deleteError) {
    return NextResponse.json({ error: "No se pudo borrar el voucher de la base" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
