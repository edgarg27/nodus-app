import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { previaCobro } from "@/lib/facturarCobro";
import { avisosDatosFiscales } from "@/lib/datosFiscales";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Vista previa de la factura que se emitiría de un estado de cuenta (cuadro "Facturar", botón "Vista previa").
// No timbra ni toca nada: devuelve las líneas, las claves del SAT y los totales.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const facturaId = req.nextUrl.searchParams.get("facturaId") || "";
  if (!facturaId) return NextResponse.json({ error: "Falta el estado de cuenta" }, { status: 400 });

  const admin = createAdminClient();
  const { data: f } = await admin.from("facturas").select("centro").eq("id", facturaId).maybeSingle();
  if (!f) return NextResponse.json({ error: "Estado de cuenta no encontrado" }, { status: 404 });
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && f.centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes ver estados de cuenta de otro centro" }, { status: 403 });
  }

  const r = await previaCobro(admin, facturaId);
  if (!("previa" in r)) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({
    previa: r.previa,
    avisos: avisosDatosFiscales({ rfc: r.previa.receptor.rfc, nombre_fiscal: r.previa.receptor.nombre, regimen_fiscal: r.previa.receptor.regimen }),
  });
}
