"use client";

import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsearCfdi, nombreBase, normalizarRfc, type CfdiParseado } from "@/lib/cfdi";

// "Anexar contrato, pagos y facturas": para migrar clientes de ZORA (o dar de alta a alguien que ya tiene
// historial) sin pasar por Cotizar. El contrato entra vigente y no genera cobros; los pagos se capturan como
// pagados o pendientes (los pendientes aparecen en Cobranza); las facturas son los CFDI ya timbrados (XML/PDF).

export type PagoFila = {
  key: string;
  concepto: string;
  monto: string;
  fecha: string;
  estado: "pagado" | "pendiente";
  forma: string;
  archivo: File | null;
};

export type FacturaArchivo = {
  key: string;
  nombre: string;
  xml: File;
  pdf: File | null;
  cfdi: CfdiParseado | null;
  error?: string;
};

export type ContratoZora = {
  folio: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  renta_mensual: string;
  deposito_garantia: string;
  horas_sala_juntas: string;
  oficina_id: string;
  archivo: File | null;
};

export type Anexos = {
  contrato: ContratoZora;
  pagos: PagoFila[];
  facturas: FacturaArchivo[];
  estadoFacturas: "" | "pagada" | "pendiente";
};

export type Oficina = { id: string; numero: string | null; tipo: string | null; estado: string | null };

export const ANEXOS_VACIOS: Anexos = {
  contrato: {
    folio: "",
    fecha_inicio: "",
    fecha_vencimiento: "",
    renta_mensual: "",
    deposito_garantia: "",
    horas_sala_juntas: "",
    oficina_id: "",
    archivo: null,
  },
  pagos: [],
  facturas: [],
  estadoFacturas: "",
};

const FORMAS_PAGO = [
  { valor: "03", label: "Transferencia" },
  { valor: "01", label: "Efectivo" },
  { valor: "04", label: "Tarjeta de crédito" },
  { valor: "28", label: "Tarjeta de débito" },
  { valor: "02", label: "Cheque" },
];

const nuevaClave = () => Math.random().toString(36).slice(2, 10);
const moneda = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function hayAnexos(a: Anexos) {
  return a.pagos.length > 0 || a.facturas.length > 0;
}

// Revisa lo capturado antes de crear la cuenta (así no queda una cuenta a medias por un dato que falta).
export function validarAnexos(a: Anexos, conContrato: boolean): string | null {
  if (conContrato) {
    const c = a.contrato;
    if (!c.fecha_inicio || !c.fecha_vencimiento) return "El contrato necesita fecha de inicio y de vencimiento.";
    if (c.fecha_vencimiento < c.fecha_inicio) return "La fecha de vencimiento del contrato es antes del inicio.";
    if (!(Number(c.renta_mensual) > 0)) return "El contrato necesita la renta mensual.";
  }
  for (const p of a.pagos) {
    if (!p.concepto.trim() || !(Number(p.monto) > 0) || !p.fecha) return "A cada pago le falta concepto, monto o fecha.";
    if (p.estado === "pagado" && !p.forma) return `Elige la forma de pago de "${p.concepto}".`;
  }
  if (a.facturas.some((f) => !f.cfdi)) return "Quita las facturas cuyo XML no se pudo leer.";
  if (a.facturas.length > 0 && !a.estadoFacturas) return "Elige si las facturas anexadas ya están pagadas o pendientes.";
  return null;
}

async function subir(supabase: SupabaseClient, bucket: string, prefijo: string, archivo: File) {
  const ext = (archivo.name.split(".").pop() || "pdf").toLowerCase();
  const ruta = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: true });
  if (error) return null;
  return supabase.storage.from(bucket).getPublicUrl(ruta).data.publicUrl;
}

export type ResultadoAnexos = { folioContrato: string | null; pagos: number; facturas: number; avisos: string[] };

// Sube los archivos y manda todo a /api/clientes/anexar.
export async function guardarAnexos(
  supabase: SupabaseClient,
  userId: string,
  a: Anexos,
  conContrato: boolean,
  diaPago: string
): Promise<{ ok: true; resultado: ResultadoAnexos } | { ok: false; error: string }> {
  const avisos: string[] = [];
  let contrato: Record<string, unknown> | null = null;
  if (conContrato) {
    const c = a.contrato;
    let archivoUrl: string | null = null;
    if (c.archivo) {
      archivoUrl = await subir(supabase, "contratos", `zora-${userId}`, c.archivo);
      if (!archivoUrl) avisos.push("No se pudo subir el PDF del contrato; súbelo después desde Contratos.");
    }
    contrato = {
      folio: c.folio,
      fecha_inicio: c.fecha_inicio,
      fecha_vencimiento: c.fecha_vencimiento,
      renta_mensual: Number(c.renta_mensual),
      deposito_garantia: Number(c.deposito_garantia) || 0,
      horas_sala_juntas: Number(c.horas_sala_juntas) || 0,
      dia_pago: diaPago ? Number(diaPago) : null,
      oficina_id: c.oficina_id || null,
      archivo_url: archivoUrl,
    };
  }

  const pagos = [];
  for (const p of a.pagos) {
    let comprobanteUrl: string | null = null;
    if (p.archivo) {
      comprobanteUrl = await subir(supabase, "comprobantes", `zora/${userId}`, p.archivo);
      if (!comprobanteUrl) avisos.push(`No se pudo subir el comprobante de "${p.concepto}".`);
    }
    pagos.push({ concepto: p.concepto.trim(), monto: Number(p.monto), fecha: p.fecha, estado: p.estado, formaPago: p.forma, comprobanteUrl });
  }

  const facturas = [];
  for (const f of a.facturas) {
    if (!f.cfdi) continue;
    const base = `cfdi-${f.cfdi.uuidCfdi.slice(0, 8)}`;
    const xmlUrl = await subir(supabase, "facturas", base, f.xml);
    const archivoUrl = f.pdf ? await subir(supabase, "facturas", base, f.pdf) : null;
    facturas.push({ cfdi: f.cfdi, xmlUrl, archivoUrl, estado: a.estadoFacturas || "pendiente" });
  }

  try {
    const res = await fetch("/api/clientes/anexar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, contrato, pagos, facturas }),
    });
    const d = await res.json();
    if (!res.ok) return { ok: false, error: d.error || "No se pudo anexar el historial" };
    return { ok: true, resultado: { folioContrato: d.folioContrato || null, pagos: d.pagos || 0, facturas: d.facturas || 0, avisos: [...avisos, ...(d.avisos || [])] } };
  } catch {
    return { ok: false, error: "No se pudo conectar para anexar el historial" };
  }
}

// Lee los XML (sueltos o en .zip) y empareja cada uno con su PDF por nombre.
async function leerFacturas(files: FileList): Promise<FacturaArchivo[]> {
  const sueltos: File[] = [];
  for (const f of Array.from(files)) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      try {
        const zip = await JSZip.loadAsync(f);
        for (const nombre of Object.keys(zip.files)) {
          const entrada = zip.files[nombre];
          if (entrada.dir) continue;
          const ext = nombre.toLowerCase().split(".").pop();
          if (ext !== "xml" && ext !== "pdf") continue;
          const blob = await entrada.async("blob");
          sueltos.push(new File([blob], nombre.split("/").pop() || nombre, { type: ext === "xml" ? "text/xml" : "application/pdf" }));
        }
      } catch {
        // zip dañado: se ignora
      }
    } else sueltos.push(f);
  }
  const pdfs = new Map<string, File>();
  sueltos.filter((f) => f.name.toLowerCase().endsWith(".pdf")).forEach((p) => pdfs.set(nombreBase(p.name), p));
  const res: FacturaArchivo[] = [];
  for (const xml of sueltos.filter((f) => f.name.toLowerCase().endsWith(".xml"))) {
    const { data, error } = parsearCfdi(await xml.text());
    res.push({ key: nuevaClave(), nombre: xml.name, xml, pdf: pdfs.get(nombreBase(xml.name)) || null, cfdi: data, error: data ? undefined : error || "XML no válido" });
  }
  return res;
}

const estiloInput = { border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" } as const;

export default function AnexosZora({
  valor,
  onChange,
  conContrato,
  oficinas,
  rfcCliente,
}: {
  valor: Anexos;
  onChange: (a: Anexos) => void;
  conContrato: boolean;
  oficinas: Oficina[];
  rfcCliente: string;
}) {
  const c = valor.contrato;
  const setContrato = (cambios: Partial<ContratoZora>) => onChange({ ...valor, contrato: { ...c, ...cambios } });
  const setPago = (key: string, cambios: Partial<PagoFila>) =>
    onChange({ ...valor, pagos: valor.pagos.map((p) => (p.key === key ? { ...p, ...cambios } : p)) });
  const hoy = new Date().toLocaleDateString("en-CA");
  const totalPagado = valor.pagos.filter((p) => p.estado === "pagado").reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const totalPendiente = valor.pagos.filter((p) => p.estado === "pendiente").reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const rfc = rfcCliente ? normalizarRfc(rfcCliente) : "";

  return (
    <div className="zora-anexos">
      {/* Contrato */}
      <div className="zora-bloque">
        <p className="zora-titulo">1. Contrato</p>
        {!conContrato ? (
          <p className="zora-nota">Para anexar un contrato de ZORA, elige “Anexar contrato de ZORA” en la sección Contrato de arriba.</p>
        ) : (
          <>
            <p className="zora-nota">
              Entra como vigente y no genera cobros (los pagos se capturan abajo). Si dejas el folio vacío se le asigna el siguiente
              del centro.
            </p>
            <div className="tel-form-grid">
              <div>
                <p className="sub-label">Folio del contrato (opcional)</p>
                <input placeholder="Ej. C-A-0123" value={c.folio} onChange={(e) => setContrato({ folio: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Oficina (opcional)</p>
                <select value={c.oficina_id} onChange={(e) => setContrato({ oficina_id: e.target.value })} style={estiloInput}>
                  <option value="">Sin oficina (coworking, virtual…)</option>
                  {oficinas.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.estado === "ocupada"}>
                      {o.numero || "Oficina"} {o.tipo ? `· ${o.tipo}` : ""} {o.estado === "ocupada" ? "· ocupada" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="sub-label">Fecha de inicio</p>
                <input type="date" value={c.fecha_inicio} onChange={(e) => setContrato({ fecha_inicio: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Fecha de vencimiento</p>
                <input type="date" value={c.fecha_vencimiento} onChange={(e) => setContrato({ fecha_vencimiento: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Renta mensual</p>
                <input type="number" min="0" step="0.01" value={c.renta_mensual} onChange={(e) => setContrato({ renta_mensual: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Depósito en garantía</p>
                <input type="number" min="0" step="0.01" value={c.deposito_garantia} onChange={(e) => setContrato({ deposito_garantia: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Horas de sala de juntas al mes</p>
                <input type="number" min="0" value={c.horas_sala_juntas} onChange={(e) => setContrato({ horas_sala_juntas: e.target.value })} />
              </div>
              <div>
                <p className="sub-label">Contrato firmado (PDF)</p>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setContrato({ archivo: e.target.files?.[0] || null })} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pagos */}
      <div className="zora-bloque">
        <p className="zora-titulo">2. Pagos</p>
        <p className="zora-nota">Los pendientes aparecen en Cobranza como cargos por cobrar; los pagados quedan como historial.</p>
        {valor.pagos.map((p) => (
          <div className="zora-pago" key={p.key}>
            <input placeholder="Concepto (ej. Renta septiembre 2026)" value={p.concepto} onChange={(e) => setPago(p.key, { concepto: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Monto" value={p.monto} onChange={(e) => setPago(p.key, { monto: e.target.value })} />
            <input type="date" value={p.fecha} max={hoy} title="Fecha del cargo o del pago" onChange={(e) => setPago(p.key, { fecha: e.target.value })} />
            <select value={p.estado} onChange={(e) => setPago(p.key, { estado: e.target.value as PagoFila["estado"] })}>
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
            </select>
            {p.estado === "pagado" ? (
              <select value={p.forma} onChange={(e) => setPago(p.key, { forma: e.target.value })}>
                <option value="">Forma de pago…</option>
                {FORMAS_PAGO.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.label}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <label className="zora-archivo" title="Comprobante (opcional)">
              {p.archivo ? "📎 " + p.archivo.name : "+ Comprobante"}
              <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setPago(p.key, { archivo: e.target.files?.[0] || null })} />
            </label>
            <button type="button" className="zora-quitar" aria-label="Quitar pago" onClick={() => onChange({ ...valor, pagos: valor.pagos.filter((x) => x.key !== p.key) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="zora-pie">
          <button
            type="button"
            className="zora-agregar"
            onClick={() =>
              onChange({
                ...valor,
                pagos: [...valor.pagos, { key: nuevaClave(), concepto: "", monto: "", fecha: hoy, estado: "pagado", forma: "", archivo: null }],
              })
            }
          >
            + Agregar pago
          </button>
          {valor.pagos.length > 0 && (
            <span className="zora-nota" style={{ margin: 0 }}>
              Pagado {moneda(totalPagado)} · Pendiente {moneda(totalPendiente)}
            </span>
          )}
        </div>
      </div>

      {/* Facturas */}
      <div className="zora-bloque">
        <p className="zora-titulo">3. Facturas</p>
        <p className="zora-nota">Sube los XML de sus facturas ya timbradas (con su PDF del mismo nombre, o todo en un .zip).</p>
        <input
          type="file"
          multiple
          accept=".xml,.pdf,.zip,text/xml,application/pdf,application/zip"
          onChange={async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            const nuevas = await leerFacturas(files);
            onChange({ ...valor, facturas: [...valor.facturas, ...nuevas] });
            e.target.value = "";
          }}
        />
        {valor.facturas.length > 0 && (
          <>
            <div className="zora-facturas">
              {valor.facturas.map((f) => (
                <div key={f.key} className="zora-factura">
                  {f.cfdi ? (
                    <span>
                      <b>{[f.cfdi.serie, f.cfdi.folioFiscal].filter(Boolean).join("-") || f.cfdi.uuidCfdi.slice(0, 8)}</b> ·{" "}
                      {f.cfdi.fecha.slice(0, 10)} · {moneda(f.cfdi.total)} {f.pdf ? "· con PDF" : "· sin PDF"}
                      {rfc && normalizarRfc(f.cfdi.rfcReceptor) !== rfc && (
                        <em className="zora-alerta"> · RFC del XML ({f.cfdi.rfcReceptor}) distinto al del cliente</em>
                      )}
                    </span>
                  ) : (
                    <span className="zora-alerta">
                      {f.nombre}: {f.error}
                    </span>
                  )}
                  <button type="button" className="zora-quitar" aria-label="Quitar factura" onClick={() => onChange({ ...valor, facturas: valor.facturas.filter((x) => x.key !== f.key) })}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <p className="sub-label">Estas facturas están</p>
              <select value={valor.estadoFacturas} onChange={(e) => onChange({ ...valor, estadoFacturas: e.target.value as Anexos["estadoFacturas"] })} style={estiloInput}>
                <option value="">Elige…</option>
                <option value="pagada">Pagadas</option>
                <option value="pendiente">Pendientes de pago</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
