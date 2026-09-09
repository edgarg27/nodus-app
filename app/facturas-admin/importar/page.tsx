"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";
import { parsearCfdi, normalizarRfc, nombreBase } from "@/lib/cfdi";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const CONCURRENCIA = 5;

type FilaReporte = {
  archivo: string;
  problema: string;
  accion: string;
};

type Resumen = {
  totalArchivos: number;
  facturasEncontradas: number;
  importadas: number;
  duplicadas: number;
  conErrores: number;
  sinCliente: number;
};

export default function ImportarCfdiPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const esGlobal = ROLES_GLOBALES.includes(miRol);

  const [archivos, setArchivos] = useState<File[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [reporte, setReporte] = useState<FilaReporte[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rol = profile?.rol || "";
    setMiRol(rol);
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
  }

  async function onSeleccionarArchivos(files: FileList | null) {
    if (!files) return;
    const lote: File[] = [];
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
            lote.push(new File([blob], nombre.split("/").pop() || nombre, { type: ext === "xml" ? "text/xml" : "application/pdf" }));
          }
        } catch {
          // zip corrupto: se ignora, no rompe la selección del resto
        }
      } else {
        lote.push(f);
      }
    }
    setArchivos(lote);
    setResumen(null);
    setReporte([]);
  }

  async function subirArchivo(bucket: string, nombreBaseArchivo: string, blob: Blob, tipo: string, ext: string) {
    const fileName = `${nombreBaseArchivo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(fileName, blob, { contentType: tipo, upsert: true });
    if (uploadError) return null;
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  async function procesar() {
    if (!centro) return;
    const xmls = archivos.filter((f) => f.name.toLowerCase().endsWith(".xml"));
    const pdfs = archivos.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const pdfPorNombreBase = new Map<string, File>();
    pdfs.forEach((p) => pdfPorNombreBase.set(nombreBase(p.name), p));

    // Precarga única de clientes por RFC, en vez de una consulta por archivo.
    const { data: perfiles } = await supabase.from("profiles").select("id, centro, rfc").eq("rol", "cliente").not("rfc", "is", null);
    const clientePorRfc = new Map<string, { id: string; centro: string | null }>();
    (perfiles || []).forEach((p: any) => {
      if (p.rfc) clientePorRfc.set(normalizarRfc(p.rfc), { id: p.id, centro: p.centro });
    });

    setProcesando(true);
    setProgreso({ hecho: 0, total: xmls.length });
    const filas: FilaReporte[] = [];
    let importadas = 0;
    let duplicadas = 0;
    let conErrores = 0;
    let sinCliente = 0;
    let hecho = 0;

    async function procesarUnPar(xml: File) {
      const texto = await xml.text();
      const { data, error } = parsearCfdi(texto);
      if (!data) {
        filas.push({ archivo: xml.name, problema: error || "CFDI inválido", accion: "Revisar" });
        conErrores++;
        return;
      }

      const pdf = pdfPorNombreBase.get(nombreBase(xml.name));
      const xmlUrl = await subirArchivo("facturas", `cfdi-${data.uuidCfdi.slice(0, 8)}`, xml, "text/xml", "xml");
      let archivoUrl: string | null = null;
      if (pdf) {
        archivoUrl = await subirArchivo("facturas", `cfdi-${data.uuidCfdi.slice(0, 8)}`, pdf, "application/pdf", "pdf");
      }

      const cliente = clientePorRfc.get(normalizarRfc(data.rfcReceptor));
      const conceptoTexto = data.conceptos.map((c) => c.descripcion).join(" · ").slice(0, 200);
      const folio = data.serie || data.folioFiscal ? `${data.serie} ${data.folioFiscal}`.trim() : data.uuidCfdi.slice(0, 8);
      const fecha = data.fecha ? data.fecha.slice(0, 10) : new Date().toISOString().split("T")[0];

      const { error: insertError } = await supabase.from("facturas").insert({
        user_id: cliente?.id || null,
        folio,
        concepto: conceptoTexto || "CFDI importado",
        monto: data.total,
        fecha_emision: fecha,
        fecha_vencimiento: fecha,
        estado: "pendiente",
        centro: cliente?.centro || centro,
        archivo_url: archivoUrl,
        uuid_cfdi: data.uuidCfdi,
        serie: data.serie || null,
        folio_fiscal: data.folioFiscal || null,
        rfc_emisor: data.rfcEmisor || null,
        nombre_emisor: data.nombreEmisor || null,
        rfc_receptor: data.rfcReceptor || null,
        nombre_receptor: data.nombreReceptor || null,
        subtotal: data.subtotal || null,
        iva: data.iva || null,
        retenciones: data.retenciones || null,
        moneda: data.moneda || null,
        tipo_comprobante: data.tipoComprobante || null,
        forma_pago: data.formaPago || null,
        metodo_pago: data.metodoPago || null,
        uso_cfdi: data.usoCfdi || null,
        conceptos: data.conceptos,
        impuestos: data.impuestos,
        xml_url: xmlUrl,
        fuente: "cfdi_import",
      });

      if (insertError) {
        if ((insertError as any).code === "23505") {
          filas.push({ archivo: xml.name, problema: "UUID duplicado", accion: "No importar" });
          duplicadas++;
        } else {
          filas.push({ archivo: xml.name, problema: insertError.message, accion: "Revisar" });
          conErrores++;
        }
        return;
      }

      importadas++;
      const notas: string[] = [];
      if (!cliente) {
        notas.push("Cliente no encontrado");
        sinCliente++;
      }
      if (!pdf) notas.push("Falta PDF");
      if (notas.length > 0) {
        filas.push({
          archivo: xml.name,
          problema: notas.join(" · "),
          accion: !cliente ? "Asignar cliente" : "Importar XML",
        });
      }
    }

    let indice = 0;
    async function worker() {
      while (indice < xmls.length) {
        const miIndice = indice++;
        await procesarUnPar(xmls[miIndice]);
        hecho++;
        setProgreso({ hecho, total: xmls.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, xmls.length) }, () => worker()));

    setResumen({
      totalArchivos: xmls.length + pdfs.length,
      facturasEncontradas: xmls.length,
      importadas,
      duplicadas,
      conErrores,
      sinCliente,
    });
    setReporte(filas);
    setProcesando(false);
    setArchivos([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/facturas-admin">
          ← Regresar
        </a>
        <p className="rep-title">Importar CFDI</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
        {esGlobal && centrosDisponibles.length > 1 && (
          <div className="centro-selector">
            <select value={centro || ""} onChange={(e) => setCentro(e.target.value)}>
              {centrosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rep-content">
        <div className="form-card">
          <p className="sub-label">Archivos (XML, PDF o ZIP con ambos)</p>
          <input ref={inputRef} type="file" multiple accept=".xml,.pdf,.zip" onChange={(e) => onSeleccionarArchivos(e.target.files)} />
          {archivos.length > 0 && (
            <p style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
              {archivos.length} archivo(s) listos ({archivos.filter((a) => a.name.toLowerCase().endsWith(".xml")).length} XML,{" "}
              {archivos.filter((a) => a.name.toLowerCase().endsWith(".pdf")).length} PDF)
            </p>
          )}

          <button
            className="tel-borrar-btn"
            style={{ color: "#0d1b3e", fontWeight: 600, marginTop: 12 }}
            disabled={archivos.length === 0 || procesando || !centro}
            onClick={procesar}
          >
            {procesando ? `Procesando ${progreso.hecho}/${progreso.total}...` : "Procesar"}
          </button>

          {procesando && (
            <div style={{ marginTop: 8, height: 6, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progreso.total > 0 ? (progreso.hecho / progreso.total) * 100 : 0}%`,
                  background: "#254B8C",
                  transition: "width .2s",
                }}
              />
            </div>
          )}
        </div>

        {resumen && (
          <>
            <div className="resumen-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
              <div className="stat-card">
                <p className="stat-val">{resumen.totalArchivos}</p>
                <p className="stat-lbl">Total archivos</p>
              </div>
              <div className="stat-card">
                <p className="stat-val">{resumen.facturasEncontradas}</p>
                <p className="stat-lbl">Facturas encontradas</p>
              </div>
              <div className="stat-card">
                <p className="stat-val">{resumen.importadas}</p>
                <p className="stat-lbl">Importadas</p>
              </div>
              <div className="stat-card">
                <p className="stat-val">{resumen.duplicadas}</p>
                <p className="stat-lbl">Duplicadas</p>
              </div>
              <div className="stat-card">
                <p className="stat-val">{resumen.conErrores}</p>
                <p className="stat-lbl">Con errores</p>
              </div>
              <div className="stat-card">
                <p className="stat-val">{resumen.sinCliente}</p>
                <p className="stat-lbl">Sin cliente</p>
              </div>
            </div>

            {reporte.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p className="panel-section-label" style={{ margin: 0 }}>
                    Reporte ({reporte.length})
                  </p>
                  <button
                    className="btn-exportar"
                    onClick={() =>
                      exportarExcel(
                        `importacion-cfdi-${centro}`,
                        reporte.map((r) => ({ Archivo: r.archivo, Problema: r.problema, Accion: r.accion }))
                      )
                    }
                  >
                    📥 Excel
                  </button>
                </div>
                {reporte.map((r, i) => (
                  <div className="contrato-card-admin" key={i}>
                    <p className="contrato-cliente-nombre">{r.archivo}</p>
                    <p className="contrato-detalle">{r.problema}</p>
                    <p className="contrato-detalle">Acción sugerida: {r.accion}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
