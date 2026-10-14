import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { serieCentro } from "@/lib/centros";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const DIAS_PARA_PAGAR = 10;

function sumarDias(iso: string, dias: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
}

// Integrar por cliente: junta las líneas elegidas en un solo cobro (factura sin timbrar). Las líneas que ya son
// un pago del cliente se ligan; las que no (renta y adicionales mensuales del contrato) se crean como pagos
// pendientes para que el cobro quede con un concepto por línea. Después se timbra con /api/facturas/facturar.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "pagosVincular")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const cuerpo = await req.json().catch(() => ({}));
  const userId: string = typeof cuerpo.userId === "string" ? cuerpo.userId : "";
  const concepto: string = typeof cuerpo.concepto === "string" ? cuerpo.concepto.trim().slice(0, 200) : "";
  const fecha: string = typeof cuerpo.fecha === "string" ? cuerpo.fecha : "";
  const lineas: { pagoId?: string; descripcion?: string; monto?: number }[] = Array.isArray(cuerpo.lineas) ? cuerpo.lineas : [];
  if (!userId || !concepto || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || lineas.length === 0) {
    return NextResponse.json({ error: "Faltan datos: cliente, concepto, fecha y al menos una línea" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: cliente } = await admin.from("profiles").select("id, centro").eq("id", userId).maybeSingle();
  if (!cliente || !cliente.centro) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!ROLES_GLOBALES.includes(miProfile!.rol) && cliente.centro !== miProfile!.centro) {
    return NextResponse.json({ error: "No puedes facturar a clientes de otro centro" }, { status: 403 });
  }

  // Líneas que ya son un pago del cliente, sin factura.
  const pagoIds = lineas.map((l) => l.pagoId).filter((x): x is string => typeof x === "string");
  const { data: pagosExistentes } = pagoIds.length
    ? await admin.from("pagos").select("id, monto, adicional_tipo").in("id", pagoIds).eq("user_id", userId).is("factura_id", null)
    : { data: [] as { id: string; monto: number; adicional_tipo: string | null }[] };
  if ((pagosExistentes || []).length !== pagoIds.length) {
    return NextResponse.json({ error: "Alguno de los pagos ya tiene factura o no es de este cliente. Vuelve a pulsar Previa." }, { status: 409 });
  }

  const nuevas = lineas.filter((l) => !l.pagoId);
  for (const l of nuevas) {
    if (typeof l.descripcion !== "string" || !l.descripcion.trim() || !(Number(l.monto) > 0)) {
      return NextResponse.json({ error: "Cada línea necesita descripción y un monto mayor a cero" }, { status: 400 });
    }
  }

  const total =
    Math.round(((pagosExistentes || []).reduce((s, p) => s + Number(p.monto), 0) + nuevas.reduce((s, l) => s + Number(l.monto), 0)) * 100) / 100;
  if (!(total > 0)) return NextResponse.json({ error: "El total debe ser mayor a cero" }, { status: 400 });

  const serie = serieCentro(cliente.centro);
  const folio = `${serie || "FAC"}-${Date.now().toString().slice(-6)}`;
  const { data: factura, error: errFactura } = await admin
    .from("facturas")
    .insert({
      user_id: userId,
      folio,
      concepto,
      monto: total,
      fecha_emision: fecha,
      fecha_vencimiento: sumarDias(fecha, DIAS_PARA_PAGAR),
      estado: "pendiente",
      centro: cliente.centro,
    })
    .select("id, folio")
    .single();
  if (errFactura || !factura) return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });

  const idsNuevos: string[] = [];
  if (nuevas.length > 0) {
    const { data: creados, error: errPagos } = await admin
      .from("pagos")
      .insert(
        nuevas.map((l) => ({
          user_id: userId,
          centro: cliente.centro,
          estado: "pendiente",
          concepto: String(l.descripcion).trim().slice(0, 200),
          monto: Number(l.monto),
          factura_id: factura.id,
        }))
      )
      .select("id");
    if (errPagos || !creados) {
      await admin.from("facturas").delete().eq("id", factura.id);
      return NextResponse.json({ error: "No se pudieron guardar las líneas de la factura" }, { status: 500 });
    }
    idsNuevos.push(...creados.map((c) => c.id));
  }

  if (pagoIds.length > 0) {
    const { error: errLigar } = await admin.from("pagos").update({ factura_id: factura.id }).in("id", pagoIds).eq("user_id", userId).is("factura_id", null);
    if (errLigar) {
      if (idsNuevos.length > 0) await admin.from("pagos").delete().in("id", idsNuevos);
      await admin.from("facturas").delete().eq("id", factura.id);
      return NextResponse.json({ error: "No se pudieron ligar los pagos a la factura" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id: factura.id, folio: factura.folio, total });
}
