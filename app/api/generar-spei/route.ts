import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearCargoSPEI } from "@/lib/openpay";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { facturaId } = await req.json();
  if (!facturaId) {
    return NextResponse.json({ error: "Falta facturaId" }, { status: 400 });
  }

  // La factura tiene que ser del propio cliente que está pidiendo el cargo
  const { data: factura } = await supabase
    .from("facturas")
    .select("id, folio, concepto, monto, user_id, estado")
    .eq("id", facturaId)
    .eq("user_id", session.user.id)
    .single();

  if (!factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }

  if (factura.estado === "pagada") {
    return NextResponse.json({ error: "Esta factura ya está pagada" }, { status: 400 });
  }

  // Si ya existe un cargo SPEI vigente para esta factura, se regresa el
  // mismo en vez de generar uno nuevo cada vez que entra a la pantalla.
  const { data: pagoExistente } = await supabase
    .from("pagos")
    .select("*")
    .eq("factura_id", facturaId)
    .eq("estado", "pendiente_spei")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pagoExistente?.clabe && pagoExistente.fecha_limite && new Date(pagoExistente.fecha_limite) > new Date()) {
    return NextResponse.json({ ok: true, pago: pagoExistente });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre, email")
    .eq("id", session.user.id)
    .single();

  try {
    const cargo = await crearCargoSPEI({
      monto: Number(factura.monto),
      descripcion: `${factura.folio} - ${factura.concepto}`,
      ordenId: factura.id,
      nombre: profile?.nombre || "Cliente Nodus",
      email: profile?.email || session.user.email || "",
    });

    const { data: pago, error: insertError } = await supabase
      .from("pagos")
      .insert({
        factura_id: factura.id,
        user_id: session.user.id,
        monto: factura.monto,
        estado: "pendiente_spei",
        notas: "Cargo SPEI generado vía Openpay",
        openpay_charge_id: cargo.id,
        clabe: cargo.payment_method?.clabe || null,
        banco: cargo.payment_method?.bank || null,
        referencia: cargo.payment_method?.reference || cargo.payment_method?.agreement || null,
        fecha_limite: cargo.due_date || null,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "El cargo se generó pero no se pudo guardar" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, pago });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error generando el cargo SPEI" }, { status: 500 });
  }
}
