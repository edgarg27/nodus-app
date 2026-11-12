"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../soporte/FileDropzone";
import { hoyMexicoISO } from "@/lib/fechaMexico";
import { URGENCIAS, type Urgencia } from "@/lib/gastos";

// Sube la factura o el comprobante de un gasto al bucket "comprobantes". El nombre original
// (sin acentos ni símbolos) va después de "__" para descargarlo con ese mismo nombre.
// También lo usan los pagos a proveedores de Operaciones (app/centro/PagosProveedores.tsx).
export async function subirArchivoGasto(supabase: ReturnType<typeof createClient>, archivo: File, prefijo: string) {
  const ext = archivo.name.includes(".") ? archivo.name.split(".").pop() : "pdf";
  const original = archivo.name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, "-")
    .trim()
    .slice(0, 80);
  const fileName = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${original ? `__${original}` : ""}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("comprobantes")
    .upload(fileName, archivo, { contentType: archivo.type || undefined, upsert: true });
  if (uploadError) return null;
  return supabase.storage.from("comprobantes").getPublicUrl(fileName).data.publicUrl;
}

// Formulario para registrar un gasto (app/gastos/page.tsx). La factura y el comprobante de pago son
// opcionales; contabilidad también puede subir el comprobante al marcarlo como pagado
// (/api/gastos/revisar).
export default function FormGasto({
  centro,
  tipo,
  proveedores,
  registradoPorNombre,
  onGuardado,
}: {
  centro: string | null;
  // Área del gasto (sistemas, operaciones, admin). Sin área, cuenta como de Administración.
  tipo: string | null;
  proveedores: { id: string; nombre: string }[];
  // Si no se pasa, se toma del perfil al guardar.
  registradoPorNombre?: string;
  onGuardado: () => void;
}) {
  const supabase = createClient();
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyMexicoISO());
  const [notas, setNotas] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [urgencia, setUrgencia] = useState<Urgencia>("verde");
  const [fechaLimite, setFechaLimite] = useState("");
  const [factura, setFactura] = useState<File[]>([]);
  const [comprobante, setComprobante] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const subirArchivo = (archivo: File, prefijo: string) => subirArchivoGasto(supabase, archivo, prefijo);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!centro) {
      setError("Elige el centro del gasto (o pide que le pongan un centro a tu cuenta).");
      return;
    }
    if (!concepto.trim() || !monto || !fecha) {
      setError("Completa concepto, monto y fecha.");
      return;
    }
    setGuardando(true);
    setError("");

    const facturaUrl = factura[0] ? await subirArchivo(factura[0], "factura") : null;
    const comprobanteUrl = comprobante[0] ? await subirArchivo(comprobante[0], "pago") : null;
    if ((factura[0] && !facturaUrl) || (comprobante[0] && !comprobanteUrl)) {
      setError("No se pudo subir el archivo. Intenta de nuevo.");
      setGuardando(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    let nombre = registradoPorNombre || "";
    if (!nombre && user) {
      const { data: perfil } = await supabase.from("profiles").select("nombre").eq("id", user.id).maybeSingle();
      nombre = perfil?.nombre || "";
    }
    const { error: insertError } = await supabase.from("gastos").insert({
      concepto: concepto.trim(),
      categoria: categoria.trim() || null,
      monto: Number(monto),
      fecha,
      notas: notas.trim() || null,
      tipo,
      centro,
      proveedor_id: proveedorId || null,
      factura_url: facturaUrl,
      comprobante_pago_url: comprobanteUrl,
      urgencia,
      fecha_limite_pago: fechaLimite || null,
      registrado_por: user?.id,
      registrado_por_nombre: nombre || null,
    });
    if (insertError) {
      setError(
        /urgencia|fecha_limite_pago/i.test(insertError.message || "")
          ? "Falta correr la migración de gastos (migracion_rol_gastos.sql)."
          : "No se pudo registrar el gasto. Intenta de nuevo."
      );
      setGuardando(false);
      return;
    }

    const u = URGENCIAS.find((x) => x.id === urgencia)!;
    await supabase.from("notificaciones").insert({
      centro,
      tipo: "nuevo_gasto",
      mensaje: `💸 Gasto ${u.label.toLowerCase()} en ${centro}: ${concepto.trim()} — $${Number(monto).toLocaleString("es-MX")}${
        fechaLimite ? ` · pagar antes del ${fechaLimite}` : ""
      }`,
    });

    setConcepto("");
    setCategoria("");
    setMonto("");
    setFecha(hoyMexicoISO());
    setNotas("");
    setProveedorId("");
    setUrgencia("verde");
    setFechaLimite("");
    setFactura([]);
    setComprobante([]);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    onGuardado();
  }

  return (
    <form className="form-card" onSubmit={guardar}>
      <div className="tel-form-grid">
        <input placeholder="Concepto (ej. Papelería, reparación...)" value={concepto} onChange={(e) => setConcepto(e.target.value)} required />
        <input type="number" step="0.01" min="0" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} required />
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required title="Fecha del gasto" />
        <input placeholder="Categoría (opcional)" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
      </div>
      <input type="text" placeholder="Notas para contabilidad (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />

      <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
        <option value="">Sin proveedor (opcional)</option>
        {proveedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>

      <p className="sub-label">¿Qué tan urgente es pagarlo?</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {URGENCIAS.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setUrgencia(u.id)}
            style={{
              flex: "1 1 0",
              minWidth: 110,
              padding: "10px 8px",
              borderRadius: 10,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
              border: `2px solid ${urgencia === u.id ? u.color : "#e3e6ee"}`,
              background: urgencia === u.id ? u.fondo : "#fff",
              color: "#0d1b3e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: u.color, display: "inline-block" }} />
            {u.label}
          </button>
        ))}
      </div>

      <p className="sub-label">Fecha límite de pago (opcional)</p>
      <input type="date" value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} />
      <p style={{ fontSize: 11, color: "#888", margin: 0 }}>Si faltan 3 días o menos para esa fecha, el gasto se pone en rojo solo.</p>

      <div className="gasto-archivos">
        <div>
          <p className="sub-label">Factura · opcional</p>
          <FileDropzone files={factura} onChange={setFactura} maxFiles={1} accept="image/*,.pdf" compacto />
        </div>
        <div>
          <p className="sub-label">Comprobante de pago · opcional</p>
          <FileDropzone files={comprobante} onChange={setComprobante} maxFiles={1} accept="image/*,.pdf" compacto />
        </div>
      </div>

      {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: 0 }}>{error}</p>}

      <button className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")} type="submit" disabled={guardando}>
        <span className="btn-enviar-icon-wrapper">
          <svg className="btn-enviar-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path fill="none" d="M0 0h24v24H0z"></path>
            <path fill="currentColor" d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path>
          </svg>
        </span>
        <span className="btn-enviar-check-wrapper">
          <svg className="btn-enviar-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>¡Listo!</span>
        </span>
        <span className="btn-enviar-text">Guardar gasto</span>
      </button>
    </form>
  );
}
