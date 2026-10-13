// Catálogo de servicios y adicionales con su precio y su clave del SAT. Vive en la tabla
// `catalogo_servicios` (migracion_catalogo_servicios.sql) para que se pueda cambiar sin tocar el
// código. Mientras la tabla no exista (o esté vacía) se usa la lista fija de lib/adicionales.ts.

import type { createAdminClient } from "@/lib/supabaseAdmin";
import { TIPOS_COBRO_ADICIONAL, tipoServicioFactura } from "@/lib/adicionales";
import { esSuperadmin } from "@/lib/roles";

type Admin = ReturnType<typeof createAdminClient>;

export type ServicioCatalogo = {
  clave: string;
  etiqueta: string;
  concepto: string;
  satProdServ: string;
  satUnidad: string;
  precio: number | null;
  activo: boolean;
  orden: number;
};

// Quién puede cambiar precios y agregar o quitar servicios (además del superadmin). Las demás
// personas solo eligen servicios.
export const EDITORES_CATALOGO = ["ventasit@nodusbc.mx", "finanzas@nodusbc.mx"];

export function puedeEditarCatalogo(email: string | null | undefined, rol: string | null | undefined): boolean {
  return esSuperadmin(rol) || (!!email && EDITORES_CATALOGO.includes(email.trim().toLowerCase()));
}

export const CATALOGO_ESTATICO: ServicioCatalogo[] = TIPOS_COBRO_ADICIONAL.map((t, i) => ({
  clave: t.clave,
  etiqueta: t.etiqueta,
  concepto: t.concepto,
  satProdServ: t.satProdServ,
  satUnidad: t.satUnidad,
  precio: null,
  activo: true,
  orden: t.clave === "otro" ? 999 : (i + 1) * 10,
}));

export function desdeFila(r: any): ServicioCatalogo {
  return {
    clave: r.clave,
    etiqueta: r.etiqueta,
    concepto: r.concepto || "",
    satProdServ: r.sat_prod_serv,
    satUnidad: r.sat_unidad,
    precio: r.precio == null ? null : Number(r.precio),
    activo: r.activo !== false,
    orden: Number(r.orden ?? 100),
  };
}

// Los servicios (los activos, o todos si se piden). Sin tabla o vacía: la lista fija.
export async function cargarCatalogo(admin: Admin, opts: { todos?: boolean } = {}): Promise<{ servicios: ServicioCatalogo[]; deBase: boolean }> {
  try {
    let q = admin.from("catalogo_servicios").select("*").order("orden", { ascending: true }).order("etiqueta", { ascending: true });
    if (!opts.todos) q = q.eq("activo", true);
    const { data, error } = await q;
    if (!error && data && data.length > 0) return { servicios: data.map(desdeFila), deBase: true };
  } catch {
    // sin tabla todavía
  }
  return { servicios: CATALOGO_ESTATICO, deBase: false };
}

// La clave y unidad del SAT con las que se timbra un servicio (activo o ya quitado: un cobro viejo
// debe poder timbrarse). Si no está en la tabla, se usa la lista fija y las claves anteriores.
export async function servicioPorClave(admin: Admin, clave: string | null | undefined): Promise<{ satProdServ: string; satUnidad: string; etiqueta: string } | null> {
  if (!clave) return null;
  try {
    const { data } = await admin.from("catalogo_servicios").select("etiqueta, sat_prod_serv, sat_unidad").eq("clave", clave).maybeSingle();
    if (data) return { satProdServ: data.sat_prod_serv, satUnidad: data.sat_unidad, etiqueta: data.etiqueta };
  } catch {
    // sin tabla todavía
  }
  const e = tipoServicioFactura(clave);
  return e ? { satProdServ: e.satProdServ, satUnidad: e.satUnidad, etiqueta: e.etiqueta } : null;
}

// Un servicio que se puede ofrecer ahora (activo), para crear un cobro nuevo.
export async function servicioActivoPorClave(admin: Admin, clave: string | null | undefined): Promise<ServicioCatalogo | null> {
  if (!clave) return null;
  const { servicios } = await cargarCatalogo(admin);
  return servicios.find((s) => s.clave === clave) || null;
}

// "Duplicado de llaves" → "duplicado_de_llaves"
export function claveDesdeEtiqueta(etiqueta: string): string {
  return etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Revisa lo que captura quien edita el catálogo. Devuelve el error, o "" si todo está bien.
export function validarCamposServicio(c: { etiqueta?: string; concepto?: string; satProdServ?: string; satUnidad?: string; precio?: number | null }): string {
  if (c.etiqueta !== undefined && (c.etiqueta.trim().length < 2 || c.etiqueta.trim().length > 80)) return "El nombre debe tener entre 2 y 80 letras";
  if (c.concepto !== undefined && c.concepto.length > 120) return "El concepto admite máximo 120 letras";
  if (c.satProdServ !== undefined && !/^[0-9]{8}$/.test(c.satProdServ)) return "La clave del SAT son 8 números";
  if (c.satUnidad !== undefined && !/^[A-Z0-9]{2,3}$/.test(c.satUnidad)) return "La unidad del SAT son 2 o 3 letras o números en mayúsculas (E48, H87…)";
  if (c.precio !== undefined && c.precio !== null && (!Number.isFinite(c.precio) || c.precio < 0 || c.precio > 1000000)) return "El precio no es válido";
  return "";
}
