import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { enviarCorreo } from "@/lib/email";
import { ubicacionCentro } from "@/lib/centros";

// Recordatorio por correo un día antes del tour — mismo patrón de auth que
// app/api/cron/facturacion-diaria/route.ts (secreto del cron, o sesión de
// staff para poder correrlo a mano). Se llama una vez al día desde un cron
// externo (no hay vercel.json en el repo).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const esCronValido = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!esCronValido) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
    if (!miProfile || miProfile.rol === "cliente") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const mananaISO = manana.toISOString().split("T")[0];

  const { data: tours, error: toursError } = await admin
    .from("tours")
    .select("*")
    .eq("fecha", mananaISO)
    .not("correo", "is", null)
    .eq("recordatorio_enviado", false);

  if (toursError) {
    return NextResponse.json({ error: toursError.message }, { status: 500 });
  }

  const resumen = { mandados: 0, errores: [] as string[] };

  for (const tour of tours || []) {
    const html = `
      <p>Hola ${tour.nombre},</p>
      <p>Te recordamos tu tour <strong>mañana</strong> en <strong>${tour.centro}</strong>${
      tour.hora ? ` a las <strong>${tour.hora}</strong>` : ""
    }.</p>
      ${tour.tipo_espacio_interes ? `<p>Vamos a mostrarte especialmente: <strong>${tour.tipo_espacio_interes}</strong>.</p>` : ""}
      <p>Ubicación: ${ubicacionCentro(tour.centro)}</p>
      <p>¿Nos confirmas que sigue en pie? Si necesitas moverlo, contáctanos.</p>
    `;

    const resultado = await enviarCorreo({
      to: tour.correo,
      subject: `Recordatorio: tu tour en ${tour.centro} es mañana`,
      html,
    });

    if (resultado.ok) {
      await admin.from("tours").update({ recordatorio_enviado: true }).eq("id", tour.id);
      resumen.mandados++;
    } else {
      resumen.errores.push(`${tour.id}: ${resultado.error}`);
    }
  }

  return NextResponse.json({ ok: true, ...resumen });
}
