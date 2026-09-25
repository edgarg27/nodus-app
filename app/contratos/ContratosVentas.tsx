"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import FileDropzone from "@/app/soporte/FileDropzone";

type ContratoVentas = {
  id: string;
  centro: string;
  user_id: string | null;
  cliente_nombre_historico: string | null;
  cliente_email_historico: string | null;
  cliente_empresa_historico: string | null;
  renta_mensual: number | null;
  archivo_url: string | null;
  archivo_machote_url: string | null;
  enviado_a_ventas_at: string | null;
  enviado_a_firma_at: string | null;
  archivo_firmado_url: string | null;
  archivo_firmado_at: string | null;
};

type UltimaVersion = { archivo_url: string; nombre_archivo: string | null; created_at: string };

const COLUMNAS =
  "id, centro, user_id, cliente_nombre_historico, cliente_email_historico, cliente_empresa_historico, renta_mensual, archivo_url, archivo_machote_url, enviado_a_ventas_at, enviado_a_firma_at, archivo_firmado_url, archivo_firmado_at";

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

// Lo que ve el rol Ventas al entrar a Contratos: la última versión que subió la
// administradora de cada contrato que le mandó a firma. La firma en sí la hace
// ella por su cuenta en Cincel; cuando tiene la versión firmada por ambas
// partes, la sube aquí (o llega al correo de la administradora y la sube ella).
export default function ContratosVentas() {
  const supabase = createClient();
  const [contratos, setContratos] = useState<ContratoVentas[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [ultimaVersion, setUltimaVersion] = useState<Record<string, UltimaVersion>>({});
  const [archivos, setArchivos] = useState<Record<string, File[]>>({});
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    const [{ data: porFirmar }, { data: firmados }] = await Promise.all([
      supabase
        .from("contratos")
        .select(COLUMNAS)
        .eq("estatus", "pre_aprobado")
        .or("enviado_a_ventas_at.not.is.null,enviado_a_firma_at.not.is.null")
        .is("archivo_firmado_url", null)
        .order("enviado_a_ventas_at", { ascending: false }),
      supabase
        .from("contratos")
        .select(COLUMNAS)
        .not("archivo_firmado_url", "is", null)
        .order("archivo_firmado_at", { ascending: false })
        .limit(15),
    ]);
    const lista = [...(porFirmar || []), ...(firmados || [])] as ContratoVentas[];
    setContratos(lista);

    // Nombre del cliente (los contratos con cuenta lo traen del perfil).
    const userIds = Array.from(new Set(lista.map((c) => c.user_id).filter((id): id is string => !!id)));
    if (userIds.length > 0) {
      const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", userIds);
      setNombres(Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre || ""])));
    }

    // Última versión que subió la administradora de cada contrato.
    if (lista.length > 0) {
      const { data: versiones } = await supabase
        .from("contrato_versiones")
        .select("contrato_id, archivo_url, nombre_archivo, created_at")
        .in(
          "contrato_id",
          lista.map((c) => c.id)
        )
        .order("created_at", { ascending: false });
      const mapa: Record<string, UltimaVersion> = {};
      (versiones || []).forEach((v) => {
        if (!mapa[v.contrato_id]) mapa[v.contrato_id] = v;
      });
      setUltimaVersion(mapa);
    }
    setCargando(false);
  }

  async function abrir(url: string) {
    setAbriendo(url);
    const { url: firmado, error: signErr } = await pedirLinkFirmado(url);
    setAbriendo(null);
    if (!firmado) {
      setError("No se pudo abrir el archivo: " + (signErr || "intenta de nuevo"));
      return;
    }
    setError("");
    window.open(firmado, "_blank");
  }

  // La versión firmada también pasa a archivo_url: es la que ven el cliente,
  // Ventas y la administradora.
  async function subirFirmado(c: ContratoVentas) {
    const file = archivos[c.id]?.[0];
    if (!file) return;
    setOcupado(c.id);
    setError("");
    const ext = file.name.split(".").pop() || "pdf";
    const nombre = `${c.user_id || c.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("contratos")
      .upload(nombre, file, { contentType: file.type || undefined, upsert: true });
    if (upErr) {
      setError("No se pudo subir el archivo: " + upErr.message);
      setOcupado(null);
      return;
    }
    const url = supabase.storage.from("contratos").getPublicUrl(nombre).data.publicUrl;
    const { error: updErr } = await supabase
      .from("contratos")
      .update({ archivo_firmado_url: url, archivo_firmado_at: new Date().toISOString(), archivo_url: url })
      .eq("id", c.id);
    setOcupado(null);
    if (updErr) {
      setError("No se pudo guardar la versión firmada: " + updErr.message);
      return;
    }
    setArchivos((prev) => ({ ...prev, [c.id]: [] }));
    cargar();
  }

  const porFirmar = contratos.filter((c) => !c.archivo_firmado_url);
  const firmados = contratos.filter((c) => !!c.archivo_firmado_url);

  const nombreDe = (c: ContratoVentas) =>
    c.cliente_nombre_historico || (c.user_id && nombres[c.user_id]) || c.cliente_email_historico || "Cliente";

  const tarjeta = (c: ContratoVentas, cuerpo: React.ReactNode) => (
    <div className="contrato-card-admin" key={c.id}>
      <div className="contrato-card-top">
        <div>
          <p className="contrato-cliente-nombre">
            {nombreDe(c)} {c.cliente_empresa_historico ? `· ${c.cliente_empresa_historico}` : ""}
          </p>
          <p className="contrato-detalle">
            {c.centro}
            {c.renta_mensual ? ` · $${Number(c.renta_mensual).toLocaleString("es-MX")}/mes` : ""}
          </p>
        </div>
      </div>
      {cuerpo}
    </div>
  );

  return (
    <>
      {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

      <p className="panel-section-label">✍ Contratos por firmar ({porFirmar.length})</p>
      {cargando ? (
        <div className="empty-card">Cargando…</div>
      ) : porFirmar.length === 0 ? (
        <div className="empty-card">No hay contratos por firmar: cuando la administradora suba uno a firma, aparece aquí.</div>
      ) : (
        porFirmar.map((c) => {
          const v = ultimaVersion[c.id];
          const archivo = v?.archivo_url || c.archivo_machote_url || c.archivo_url;
          const enviado = c.enviado_a_ventas_at || c.enviado_a_firma_at;
          return tarjeta(
            c,
            <>
              <p className="contrato-detalle">
                Última versión que subió la administradora{v ? ` · ${fecha(v.created_at)}` : ""}
                {enviado ? ` · enviada a firma el ${fecha(enviado)}` : ""}
              </p>
              {archivo && (
                <button
                  type="button"
                  className="ver-pdf-btn"
                  style={{ maxWidth: "100%", whiteSpace: "normal", wordBreak: "break-word", textAlign: "left" }}
                  onClick={() => abrir(archivo)}
                  disabled={abriendo === archivo}
                >
                  {abriendo === archivo ? "Abriendo…" : `📥 ${v?.nombre_archivo || "Ver la última versión"}`}
                </button>
              )}
              <p className="sub-label" style={{ marginTop: 10 }}>
                Cuando tengas la versión firmada por ambas partes, súbela aquí
              </p>
              <FileDropzone
                files={archivos[c.id] || []}
                onChange={(f) => setArchivos((prev) => ({ ...prev, [c.id]: f }))}
                maxFiles={1}
                accept="application/pdf,.pdf"
                etiquetaTipos="PDF"
              />
              {(archivos[c.id] || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn-aceptar" onClick={() => subirFirmado(c)} disabled={ocupado === c.id}>
                    {ocupado === c.id ? "Subiendo…" : "⬆ Subir versión firmada"}
                  </button>
                </div>
              )}
            </>
          );
        })
      )}

      {firmados.length > 0 && (
        <>
          <p className="panel-section-label">✅ Contratos firmados ({firmados.length})</p>
          {firmados.map((c) =>
            tarjeta(
              c,
              <>
                {c.archivo_firmado_at && <p className="contrato-detalle">Firmado y cargado el {fecha(c.archivo_firmado_at)}</p>}
                <button
                  type="button"
                  className="ver-pdf-btn"
                  onClick={() => abrir(c.archivo_firmado_url!)}
                  disabled={abriendo === c.archivo_firmado_url}
                >
                  {abriendo === c.archivo_firmado_url ? "Abriendo…" : "📥 Ver contrato firmado"}
                </button>
              </>
            )
          )}
        </>
      )}
    </>
  );
}
