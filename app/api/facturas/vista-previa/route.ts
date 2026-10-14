import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { previaPdfCobro } from "@/lib/facturarCobro";
import { FORMAS_PAGO_SAT, PERIODICIDADES, REGEX_UUID, TIPOS_RELACION } from "@/lib/formasPagoSat";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];

// Vista previa en PDF de la factura que se emitiría de un estado de cuenta (cuadro "Facturar", botón "Vista previa").
// Es el PDF real que genera Facturapi con los mismos datos que el timbrado; no timbra, no guarda nada ni gasta folio.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const cuerpo = await req.json().catch(() => ({}));
  const facturaId: string = typeof cuerpo.facturaId === "string" ? cuerpo.facturaId : "";
  if (!facturaId) return NextResponse.json({ error: "Falta el estado de cuenta" }, { status: 400 });

  const metodo: "PUE" | "PPD" = cuerpo.metodo === "PUE" ? "PUE" : "PPD";
  const formaPago: string | undefined = typeof cuerpo.formaPago === "string" ? cuerpo.formaPago : undefined;
  if (metodo === "PUE" && !FORMAS_PAGO_SAT.some((f) => f.clave === formaPago)) return NextResponse.json({ error: "Elige la forma de pago" }, { status: 400 });
  const condiciones = typeof cuerpo.condicionesPago === "string" && cuerpo.condicionesPago.trim() ? cuerpo.condicionesPago.trim().slice(0, 100) : undefined;
  const periodicidad = PERIODICIDADES.some((p) => p.clave === cuerpo.periodicidad) ? cuerpo.periodicidad : undefined;
  const cuentaPago = typeof cuerpo.cuentaPago === "string" && /^[0-9A-Za-z\- ]{4,30}$/.test(cuerpo.cuentaPago.trim()) ? cuerpo.cuentaPago.trim() : undefined;
  let relacion: { tipo: string; uuids: string[] } | undefined;
  if (cuerpo.relacion && cuerpo.relacion.tipo) {
    const uuids: string[] = Array.isArray(cuerpo.relacion.uuids) ? cuerpo.relacion.uuids.map((u: unknown) => String(u).trim().toLowerCase()) : [];
    if (!TIPOS_RELACION.some((t) => t.clave === cuerpo.relacion.tipo) || uuids.length === 0 || uuids.some((u) => !REGEX_UUID.test(u))) {
      return NextResponse.json({ error: "Revisa el tipo de relación y los UUID del CFDI relacionado" }, { status: 400 });
    }
    relacion = { tipo: cuerpo.relacion.tipo, uuids };
  }

  const admin = createAdminClient();
  const { data: f } = await admin.from("facturas").select("centro").eq("id", facturaId).maybeSingle();
  if (!f) return NextResponse.json({ error: "Estado de cuenta no encontrado" }, { status: 404 });
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && f.centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes ver estados de cuenta de otro centro" }, { status: 403 });
  }

  const r = await previaPdfCobro(admin, facturaId, { metodo, formaPago, condiciones, relacion, periodicidad, cuentaPago });
  if (!("pdf" in r)) return NextResponse.json({ error: r.error }, { status: 400 });
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="vista-previa.pdf"', "Cache-Control": "private, no-store" },
  });
}
