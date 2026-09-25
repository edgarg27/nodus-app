"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import FileDropzone from "@/app/soporte/FileDropzone";
import type { Contrato } from "./page";

type Version = { id: string; archivo_url: string; nombre_archivo: string | null; created_at: string };

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

// Contrato pre-aprobado, explicado paso por paso (ver
// migracion_contratos_por_pasos.sql para el flujo completo). Los pasos 1 a 3 y
// el 5 los hace la administradora; el 4 lo hace ventas desde su panel. El
// paso 6 (aprobar / rechazar) lo pinta quien usa este componente en `children`.
export default function PasosContrato({
  contrato,
  onCambio,
  onFirmadoCambio,
  children,
}: {
  contrato: Contrato;
  onCambio: () => void;
  onFirmadoCambio: (url: string | null) => void;
  children?: ReactNode;
}) {
  const supabase = createClient();
  const [datos, setDatos] = useState({
    enviado_a_ventas_at: contrato.enviado_a_ventas_at ?? null,
    archivo_firmado_url: contrato.archivo_firmado_url ?? null,
  });
  const [versiones, setVersiones] = useState<Version[]>([]);
  const [archivoVersion, setArchivoVersion] = useState<File[]>([]);
  const [archivoFirmado, setArchivoFirmado] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [confirmandoFirma, setConfirmandoFirma] = useState(false);
  const [error, setError] = useState("");

  const urlMachote = contrato.archivo_machote_url || contrato.archivo_url;

  useEffect(() => {
    cargarVersiones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrato.id]);

  async function cargarVersiones() {
    const { data } = await supabase
      .from("contrato_versiones")
      .select("id, archivo_url, nombre_archivo, created_at")
      .eq("contrato_id", contrato.id)
      .order("created_at", { ascending: false });
    setVersiones(data || []);
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

  async function subirArchivo(file: File): Promise<string> {
    const ext = file.name.split(".").pop() || "pdf";
    const nombre = `${contrato.user_id || contrato.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("contratos")
      .upload(nombre, file, { contentType: file.type || undefined, upsert: true });
    if (upErr) throw new Error("No se pudo subir el archivo: " + upErr.message);
    return supabase.storage.from("contratos").getPublicUrl(nombre).data.publicUrl;
  }

  async function actualizarContrato(cambios: Record<string, unknown>) {
    const { error: updErr } = await supabase.from("contratos").update(cambios).eq("id", contrato.id);
    if (updErr) throw new Error(updErr.message);
  }

  // Paso 2
  async function subirVersion() {
    const file = archivoVersion[0];
    if (!file) return;
    setOcupado("version");
    setError("");
    try {
      const url = await subirArchivo(file);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: verErr } = await supabase.from("contrato_versiones").insert({
        contrato_id: contrato.id,
        archivo_url: url,
        nombre_archivo: file.name,
        subido_por: user?.id,
      });
      if (verErr) throw new Error("No se pudo registrar la versión: " + verErr.message);
      setArchivoVersion([]);
      await cargarVersiones();
      onCambio();
    } catch (e: any) {
      setError(e?.message || "No se pudo subir la versión");
    }
    setOcupado(null);
  }

  // Paso 3
  async function subirAFirma() {
    setOcupado("firma");
    setError("");
    try {
      const ahora = new Date().toISOString();
      await actualizarContrato({ enviado_a_ventas_at: ahora, enviado_a_firma_at: null, mensaje_ventas: null });
      setDatos((d) => ({ ...d, enviado_a_ventas_at: ahora }));
      setConfirmandoFirma(false);
      // Aviso para Ventas (solo lo ve ese rol, ver AdminPanel → fetchNotificaciones).
      await supabase.from("notificaciones").insert({
        centro: contrato.centro,
        tipo: "contrato_a_firma",
        mensaje: `La administradora subió a firma el contrato de ${contrato.cliente_nombre || contrato.cliente_nombre_historico || "un cliente"}: es la última versión que subió.`,
      });
      onCambio();
    } catch (e: any) {
      setError("No se pudo subir a firma: " + (e?.message || "intenta de nuevo"));
    }
    setOcupado(null);
  }

  async function deshacerEnvio() {
    setOcupado("deshacer");
    setError("");
    try {
      await actualizarContrato({ enviado_a_ventas_at: null });
      setDatos((d) => ({ ...d, enviado_a_ventas_at: null }));
      onCambio();
    } catch (e: any) {
      setError("No se pudo deshacer: " + (e?.message || "intenta de nuevo"));
    }
    setOcupado(null);
  }

  // Paso 5: la versión firmada también pasa a archivo_url, que es la que ven
  // el cliente, ventas y la administradora.
  async function subirFirmado() {
    const file = archivoFirmado[0];
    if (!file) return;
    setOcupado("firmado");
    setError("");
    try {
      const url = await subirArchivo(file);
      await actualizarContrato({
        archivo_firmado_url: url,
        archivo_firmado_at: new Date().toISOString(),
        archivo_url: url,
      });
      setDatos((d) => ({ ...d, archivo_firmado_url: url }));
      onFirmadoCambio(url);
      setArchivoFirmado([]);
      onCambio();
    } catch (e: any) {
      setError(e?.message || "No se pudo subir la versión firmada");
    }
    setOcupado(null);
  }

  const hayVersion = versiones.length > 0;
  // Contratos que ya estaban "en Cincel" antes de este flujo no tienen fecha de envío a ventas.
  const enviadoVentas = !!datos.enviado_a_ventas_at || !!contrato.enviado_a_firma_at;
  const fechaEnvioVentas = datos.enviado_a_ventas_at || contrato.enviado_a_firma_at;
  const firmado = !!datos.archivo_firmado_url;
  const clase = (hecho: boolean, actual: boolean) => "paso" + (hecho ? " paso-hecho" : actual ? " paso-actual" : "");

  return (
    <div className="pasos-contrato">
      <p className="pasos-titulo">Cómo firmar este contrato</p>

      {/* 1 */}
      <div className={clase(hayVersion, !hayVersion)}>
        <span className="paso-num">{hayVersion ? "✓" : "1"}</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Descarga el machote</p>
          <p className="paso-desc">Bájalo y modifícalo con los datos y las cláusulas que necesites.</p>
          {urlMachote ? (
            <button type="button" className="ver-pdf-btn" onClick={() => abrir(urlMachote)} disabled={abriendo === urlMachote}>
              {abriendo === urlMachote ? "Abriendo…" : "📥 Descargar machote"}
            </button>
          ) : (
            <p className="paso-aviso">Todavía no hay machote generado para este contrato.</p>
          )}
        </div>
      </div>

      {/* 2 */}
      <div className={clase(hayVersion, !hayVersion)}>
        <span className="paso-num">{hayVersion ? "✓" : "2"}</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Sube la versión modificada</p>
          <p className="paso-desc">
            La que ya le mandaste al cliente para que revise que las cláusulas y todo esté correcto. Si haces otra
            corrección, sube la nueva: la última es la que se manda a firma.
          </p>
          {versiones.map((v, i) => (
            <div key={v.id} className="paso-archivo">
              <span>
                {i === 0 ? "★ Última versión · " : ""}
                {v.nombre_archivo || "Contrato"} · {fecha(v.created_at)}
              </span>
              <button type="button" className="ver-pdf-btn" onClick={() => abrir(v.archivo_url)} disabled={abriendo === v.archivo_url}>
                {abriendo === v.archivo_url ? "Abriendo…" : "📥 Ver"}
              </button>
            </div>
          ))}
          {!enviadoVentas && (
            <>
              <FileDropzone
                files={archivoVersion}
                onChange={setArchivoVersion}
                maxFiles={1}
                accept="application/pdf,.pdf,.doc,.docx"
                etiquetaTipos="PDF o Word"
              />
              {archivoVersion.length > 0 && (
                <button type="button" className="btn-aceptar" onClick={subirVersion} disabled={ocupado === "version"} style={{ marginTop: 6 }}>
                  {ocupado === "version" ? "Subiendo…" : "⬆ Subir versión"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 3 */}
      <div className={clase(enviadoVentas, hayVersion && !enviadoVentas)}>
        <span className="paso-num">{enviadoVentas ? "✓" : "3"}</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Subir a firma</p>
          {enviadoVentas ? (
            <>
              <p className="paso-desc">
                Enviado a Ventas el {fecha(fechaEnvioVentas!)}. Le aparece la última versión que subiste.
              </p>
              {!firmado && (
                <button type="button" className="tel-borrar-btn" onClick={deshacerEnvio} disabled={ocupado === "deshacer"}>
                  ↩ Deshacer (quiero subir otra versión)
                </button>
              )}
            </>
          ) : !hayVersion ? (
            <p className="paso-desc">Se habilita cuando subas la versión modificada.</p>
          ) : confirmandoFirma ? (
            <>
              <p className="paso-desc">¿El cliente ya confirmó que todo está correcto? Se mandará a Ventas la última versión que subiste.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn-aceptar" onClick={subirAFirma} disabled={ocupado === "firma"}>
                  {ocupado === "firma" ? "Enviando…" : "Sí, subir a firma"}
                </button>
                <button type="button" className="tel-borrar-btn" onClick={() => setConfirmandoFirma(false)}>
                  Todavía no
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="paso-desc">Cuando el cliente confirme que todo está correcto, mándalo a Ventas para que lo suban a Cincel.</p>
              <button type="button" className="btn-aceptar" onClick={() => setConfirmandoFirma(true)}>
                ✍ Subir a firma
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4 */}
      <div className={clase(firmado, enviadoVentas && !firmado)}>
        <span className="paso-num">{firmado ? "✓" : "4"}</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Ventas hace la firma en Cincel</p>
          {enviadoVentas ? (
            <p className="paso-desc">
              💼 Ventas ya tiene la última versión que subiste y se encarga de la firma en Cincel. No tienes que hacer nada
              en este paso.
            </p>
          ) : (
            <p className="paso-desc">Se activa cuando subas a firma (paso 3): a Ventas le aparece la última versión.</p>
          )}
        </div>
      </div>

      {/* 5 */}
      <div className={clase(firmado, enviadoVentas && !firmado)}>
        <span className="paso-num">{firmado ? "✓" : "5"}</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Sube la versión firmada</p>
          <p className="paso-desc">
            El contrato firmado por ambas partes llega a tu correo, o Ventas lo sube cuando lo tiene. Si ya lo tienes,
            súbelo aquí; si Ventas ya lo subió, lo ves abajo. Es la versión que verán el cliente, Ventas y tú.
          </p>
          {firmado && (
            <div className="paso-archivo">
              <span>✅ Contrato firmado cargado</span>
              <button
                type="button"
                className="ver-pdf-btn"
                onClick={() => abrir(datos.archivo_firmado_url!)}
                disabled={abriendo === datos.archivo_firmado_url}
              >
                {abriendo === datos.archivo_firmado_url ? "Abriendo…" : "📥 Ver"}
              </button>
            </div>
          )}
          {!enviadoVentas ? (
            <p className="paso-aviso">Se habilita cuando subas a firma (paso 3).</p>
          ) : (
            <>
              <FileDropzone
                files={archivoFirmado}
                onChange={setArchivoFirmado}
                maxFiles={1}
                accept="application/pdf,.pdf"
                etiquetaTipos="PDF"
              />
              {archivoFirmado.length > 0 && (
                <button type="button" className="btn-aceptar" onClick={subirFirmado} disabled={ocupado === "firmado"} style={{ marginTop: 6 }}>
                  {ocupado === "firmado" ? "Subiendo…" : firmado ? "⬆ Reemplazar versión firmada" : "⬆ Subir versión firmada"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 6 */}
      <div className={clase(false, firmado)}>
        <span className="paso-num">6</span>
        <div className="paso-cuerpo">
          <p className="paso-nombre">Aprobar el contrato</p>
          {!firmado && <p className="paso-desc">Se habilita cuando subas la versión firmada.</p>}
          {children}
        </div>
      </div>

      {error && <p style={{ color: "#A32D2D", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
