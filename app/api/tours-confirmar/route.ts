import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { ubicacionCentro } from "@/lib/centros";

// Correo de confirmación inmediata al agendar un tour (app/tours/page.tsx →
// agregarTour()) — no bloquea el guardado del tour si falla.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { tourId } = await req.json();
  if (!tourId) {
    return NextResponse.json({ error: "Falta el id del tour" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: tour, error: tourError } = await admin.from("tours").select("*").eq("id", tourId).single();
  if (tourError || !tour) {
    return NextResponse.json({ error: "No se encontró el tour" }, { status: 404 });
  }
  if (!tour.correo) {
    return NextResponse.json({ error: "Este tour no tiene correo registrado" }, { status: 400 });
  }

  const fechaFmt = new Date(tour.fecha + "T00:00:00").toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = `
    <p>Hola ${tour.nombre},</p>
    <p>Quedó agendado tu tour en <strong>${tour.centro}</strong> para el <strong>${fechaFmt}</strong>${
    tour.hora ? ` a las <strong>${tour.hora}</strong>` : ""
  }.</p>
    ${tour.tipo_espacio_interes ? `<p>Vamos a mostrarte especialmente: <strong>${tour.tipo_espacio_interes}</strong>.</p>` : ""}
    <p>Ubicación: ${ubicacionCentro(tour.centro)}</p>
    <p>Te mandaremos un recordatorio un día antes. ¡Te esperamos!</p>
  `;

  const resultado = await enviarCorreo({
    to: tour.correo,
    subject: `Tu tour en ${tour.centro} — confirmado`,
    html,
  });

  return NextResponse.json(resultado);
}
