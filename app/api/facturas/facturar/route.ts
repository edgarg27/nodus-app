import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { registrarBitacora } from "@/lib/bitacora";
import { facturarCobro, facturarPagoSuelto } from "@/lib/facturarCobro";
import { FORMAS_PAGO_SAT, PERIODICIDADES, REGEX_UUID, TIPOS_RELACION } from "@/lib/formasPagoSat";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas", "cobranza"];
const MAXIMO_POR_LLAMADA = 50;

// Emite la factura (CFDI, pago diferido) de uno o varios cobros pendientes.
// Es lo equivalente al "Facturar electrónicamente masiva" de ZORA.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaEmitir")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const cuerpo = await req.json();
  const facturaIds: string[] = Array.isArray(cuerpo.facturaIds) ? cuerpo.facturaIds : [];
  // Cobros sueltos (adicionales, depósitos…): registros de pago que aún no tienen factura.
  const pagoIds: string[] = Array.isArray(cuerpo.pagoIds) ? cuerpo.pagoIds : [];
  if (facturaIds.length + pagoIds.length === 0 || [...facturaIds, ...pagoIds].some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "Falta elegir los cobros" }, { status: 400 });
  }
  if (facturaIds.length + pagoIds.length > MAXIMO_POR_LLAMADA) {
    return NextResponse.json({ error: `Máximo ${MAXIMO_POR_LLAMADA} cobros por vez` }, { status: 400 });
  }

  // Por omisión se factura a pago diferido (PPD). En PUE (pago en una sola exhibición) hay que decir cómo se pagó.
  const metodo: "PUE" | "PPD" = cuerpo.metodo === "PUE" ? "PUE" : "PPD";
  const formaPago: string | undefined = typeof cuerpo.formaPago === "string" ? cuerpo.formaPago : undefined;
  if (metodo === "PUE" && !FORMAS_PAGO_SAT.some((f) => f.clave === formaPago)) {
    return NextResponse.json({ error: "Elige la forma de pago" }, { status: 400 });
  }
  const condiciones: string | undefined = typeof cuerpo.condicionesPago === "string" && cuerpo.condicionesPago.trim() ? cuerpo.condicionesPago.trim().slice(0, 100) : undefined;
  const cuentaPago: string | undefined = typeof cuerpo.cuentaPago === "string" && /^[0-9A-Za-z\- ]{4,30}$/.test(cuerpo.cuentaPago.trim()) ? cuerpo.cuentaPago.trim() : undefined;
  if (typeof cuerpo.cuentaPago === "string" && cuerpo.cuentaPago.trim() && !cuentaPago) {
    return NextResponse.json({ error: "El número de cuenta solo admite letras, números y guiones (4 a 30 caracteres)" }, { status: 400 });
  }
  const periodicidad: string | undefined = PERIODICIDADES.some((p) => p.clave === cuerpo.periodicidad) ? cuerpo.periodicidad : undefined;
  let relacion: { tipo: string; uuids: string[] } | undefined;
  if (cuerpo.relacion && cuerpo.relacion.tipo) {
    const uuids: string[] = Array.isArray(cuerpo.relacion.uuids) ? cuerpo.relacion.uuids.map((u: unknown) => String(u).trim().toLowerCase()) : [];
    if (!TIPOS_RELACION.some((t) => t.clave === cuerpo.relacion.tipo)) return NextResponse.json({ error: "Tipo de relación no válido" }, { status: 400 });
    if (uuids.length === 0 || uuids.length > 20 || uuids.some((u) => !REGEX_UUID.test(u))) {
      return NextResponse.json({ error: "Escribe el UUID de cada CFDI relacionado (uno por renglón o separados por coma)" }, { status: 400 });
    }
    relacion = { tipo: cuerpo.relacion.tipo, uuids };
  }

  const admin = createAdminClient();

  if (!ROLES_GLOBALES.includes(miProfile!.rol)) {
    const { data: filas } = facturaIds.length ? await admin.from("facturas").select("id, centro").in("id", facturaIds) : { data: [] as { id: string; centro: string | null }[] };
    const { data: pagos } = pagoIds.length ? await admin.from("pagos").select("id, centro").in("id", pagoIds) : { data: [] as { id: string; centro: string | null }[] };
    const todasDelCentro =
      (filas || []).length === facturaIds.length &&
      (pagos || []).length === pagoIds.length &&
      [...(filas || []), ...(pagos || [])].every((f) => f.centro === miProfile!.centro);
    if (!todasDelCentro) {
      return NextResponse.json({ error: "No puedes facturar cobros de otro centro" }, { status: 403 });
    }
  }

  // Uno por uno: Facturapi y el SAT limitan el ritmo, y un error en uno no frena los demás.
  const resultados = [];
  for (const id of facturaIds) {
    resultados.push(await facturarCobro(admin, id, { metodo, formaPago, condiciones, relacion, periodicidad, cuentaPago }));
  }
  for (const id of pagoIds) {
    resultados.push(await facturarPagoSuelto(admin, id));
  }

  // Bitácora: deja constancia de quién timbró cada factura y cuándo. Los primeros resultados corresponden a
  // facturaIds y los siguientes a pagoIds, en el mismo orden en que se recorrieron.
  const okFacturaIds = resultados.slice(0, facturaIds.length).filter((r) => r.ok).map((r) => r.id);
  const okPagoIds = resultados.slice(facturaIds.length).filter((r) => r.ok).map((r) => r.id);
  if (okFacturaIds.length) {
    const { data: fs } = await admin.from("facturas").select("id, folio, user_id, centro, monto").in("id", okFacturaIds);
    for (const f of fs || []) {
      await registrarBitacora(admin, {
        actorId: session.user.id,
        accion: "factura_timbrada",
        entidad: "factura",
        entidadId: f.id,
        folio: f.folio,
        clienteId: f.user_id,
        centro: f.centro,
        monto: f.monto,
      });
    }
  }
  if (okPagoIds.length) {
    const { data: ps } = await admin.from("pagos").select("id, user_id, centro, monto, factura_id").in("id", okPagoIds);
    for (const p of ps || []) {
      await registrarBitacora(admin, {
        actorId: session.user.id,
        accion: "factura_timbrada",
        entidad: "factura",
        entidadId: p.factura_id || p.id,
        clienteId: p.user_id,
        centro: p.centro,
        monto: p.monto,
      });
    }
  }

  const fallidas = resultados.filter((r) => !r.ok);
  return NextResponse.json({ ok: fallidas.length === 0, resultados }, { status: fallidas.length === resultados.length ? 400 : 200 });
}
