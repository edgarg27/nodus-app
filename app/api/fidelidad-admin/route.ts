import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { CENTROS_FIDELIDAD, enviarCorreoTarjeta } from "@/lib/correoTarjetaFidelidad";

// El admin crea una tarjeta de fidelidad para un cliente (desde /fidelidad-admin),
// sin que el cliente tenga que pedirla en /tarjeta-fidelidad. Mismos datos y mismo
// folio que la que se pide en línea. El admin solo crea en su propio centro;
// gerente y superadmin eligen el centro.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "fidelidadCrear")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre || "").trim().slice(0, 120);
  const telefono = String(body?.telefono || "").trim().slice(0, 30);
  const email = String(body?.email || "").trim().slice(0, 160);
  const elige = miProfile?.rol === "superadmin" || miProfile?.rol === "gerente";
  const centro = elige ? String(body?.centro || "") : String(miProfile?.centro || "");

  if (!CENTROS_FIDELIDAD.includes(centro)) {
    return NextResponse.json({ error: elige ? "Elige el centro" : "Tu cuenta no tiene un centro asignado" }, { status: 400 });
  }
  if (!nombre || !telefono) return NextResponse.json({ error: "Nombre y teléfono son obligatorios" }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "El correo no es válido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: tarjeta, error } = await admin
    .from("tarjetas_fidelidad")
    .insert({ centro, nombre, telefono, email: email || null })
    .select("*")
    .single();
  if (error || !tarjeta) return NextResponse.json({ error: "No se pudo crear la tarjeta" }, { status: 500 });

  // Si se dio correo, el cliente recibe su folio (mismo correo que la tarjeta pedida en línea).
  if (email) await enviarCorreoTarjeta({ nombre, centro, folio: tarjeta.folio, email });

  return NextResponse.json({ ok: true, tarjeta });
}
