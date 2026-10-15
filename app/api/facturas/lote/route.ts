import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { rolPuede } from "@/lib/permisosApi";
import { avisosDatosFiscales } from "@/lib/datosFiscales";

export const dynamic = "force-dynamic";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente", "gerente_ventas"];
const TIPOS = ["Coworking", "Oficina Privada", "Working Desk"];

// Integrar por lote: los cobros de un centro y un mes que todavía no tienen factura (CFDI), con el tipo de
// espacio del cliente y si sus datos fiscales están completos. Se timbran después con /api/facturas/facturar.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: miProfile } = await supabase.from("profiles").select("rol, centro").eq("id", session.user.id).single();
  if (!rolPuede(miProfile?.rol, "facturaDescargar")) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const esGlobal = ROLES_GLOBALES.includes(miProfile!.rol);
  const centro = esGlobal ? q.get("centro") || miProfile!.centro : miProfile!.centro;
  if (!centro) return NextResponse.json({ error: "Falta el centro" }, { status: 400 });
  const mes = Number(q.get("mes"));
  const anio = Number(q.get("anio"));
  if (!(mes >= 1 && mes <= 12) || !(anio >= 2020 && anio <= 2100)) return NextResponse.json({ error: "Mes o año no válidos" }, { status: 400 });
  const tipo = q.get("tipo") || "";
  if (tipo && !TIPOS.includes(tipo)) return NextResponse.json({ error: "Tipo de espacio no válido" }, { status: 400 });

  const mm = String(mes).padStart(2, "0");
  const inicio = `${anio}-${mm}-01`;
  const fin = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, "0")}`;

  const admin = createAdminClient();
  const { data: cobros, error } = await admin
    .from("facturas")
    .select("id, user_id, folio, concepto, monto, estado, fecha_emision, fecha_vencimiento")
    .eq("centro", centro)
    .is("uuid_cfdi", null)
    .not("user_id", "is", null)
    .neq("estado", "cancelada")
    .gte("fecha_emision", inicio)
    .lte("fecha_emision", fin)
    .order("fecha_emision", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((cobros || []).map((c) => c.user_id as string)));
  const tiposPorUsuario = new Map<string, Set<string>>();
  let perfiles: { id: string; nombre: string | null; email: string | null; empresa: string | null; rfc: string | null; nombre_fiscal: string | null; regimen_fiscal: string | null; cp_fiscal: string | null }[] = [];
  if (userIds.length > 0) {
    const [{ data: p }, { data: contratos }] = await Promise.all([
      admin.from("profiles").select("id, nombre, email, empresa, rfc, nombre_fiscal, regimen_fiscal, cp_fiscal").in("id", userIds),
      admin.from("contratos").select("user_id, oficina_id, paquete_id").eq("estatus", "vigente").in("user_id", userIds),
    ]);
    perfiles = p || [];
    const oficinaIds = Array.from(new Set((contratos || []).map((c) => c.oficina_id).filter(Boolean))) as string[];
    const paqueteIds = Array.from(new Set((contratos || []).map((c) => c.paquete_id).filter(Boolean))) as string[];
    const [{ data: oficinas }, { data: paquetes }] = await Promise.all([
      oficinaIds.length ? admin.from("oficinas").select("id, tipo").in("id", oficinaIds) : Promise.resolve({ data: [] as { id: string; tipo: string | null }[] }),
      paqueteIds.length ? admin.from("paquetes").select("id, tipo_espacio").in("id", paqueteIds) : Promise.resolve({ data: [] as { id: string; tipo_espacio: string | null }[] }),
    ]);
    const tipoOficina = new Map((oficinas || []).map((o) => [o.id, o.tipo]));
    const tipoPaquete = new Map((paquetes || []).map((x) => [x.id, x.tipo_espacio]));
    for (const c of contratos || []) {
      const t = (c.oficina_id && tipoOficina.get(c.oficina_id)) || (c.paquete_id && tipoPaquete.get(c.paquete_id)) || null;
      if (!t || !c.user_id) continue;
      if (!tiposPorUsuario.has(c.user_id)) tiposPorUsuario.set(c.user_id, new Set());
      tiposPorUsuario.get(c.user_id)!.add(t);
    }
  }
  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));

  const filas = (cobros || [])
    .map((c) => {
      const p = perfilPorId.get(c.user_id as string);
      const tipos = Array.from(tiposPorUsuario.get(c.user_id as string) || []);
      const avisos = avisosDatosFiscales(p || {});
      const completo = !!(p?.rfc && p?.nombre_fiscal && p?.regimen_fiscal && p?.cp_fiscal);
      return {
        id: c.id,
        folio: c.folio,
        concepto: c.concepto,
        monto: Number(c.monto),
        estado: c.estado,
        fechaEmision: c.fecha_emision,
        cliente: p?.nombre_fiscal || p?.empresa || p?.nombre || "Cliente",
        correo: p?.email || "",
        rfc: p?.rfc || "",
        tipos,
        completo,
        avisos,
      };
    })
    .filter((f) => !tipo || f.tipos.includes(tipo));

  return NextResponse.json({
    filas,
    puedeTimbrar: rolPuede(miProfile?.rol, "facturaEmitir"),
    esGlobal,
    centro,
  });
}
