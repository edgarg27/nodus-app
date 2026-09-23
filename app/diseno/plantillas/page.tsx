"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import FileDropzone from "../../soporte/FileDropzone";

const BUCKET = "plantillas-documentos";

type Plantilla = {
  id: string;
  nombre_archivo: string;
  tipo: "contrato" | "cotizacion";
  storage_path: string | null;
  actualizado_por_nombre: string | null;
  updated_at: string;
};

// Nombre amigable de cada archivo — mismo catálogo que trae la semilla de
// migracion_plantillas_documentos.sql (que a su vez refleja lo que ya
// arman lib/contratoDocx.ts y lib/cotizacionEspacioPptx.ts /
// lib/cotizacionSalaPptx.ts). Si algún día se agrega una plantilla nueva,
// se suma aquí y en esa migración.
const ETIQUETAS: Record<string, string> = {
  "BosquesCoworking30hrsFisica.docx": "Coworking · Paquete 30 horas · Persona física",
  "BosquesCoworking30hrsMoral.docx": "Coworking · Paquete 30 horas · Persona moral",
  "BosquesCoworkingFisicaConDeposito.docx": "Coworking · Con depósito en garantía · Persona física",
  "BosquesCoworkingFisicaSinDeposito.docx": "Coworking · Sin depósito en garantía · Persona física",
  "BosquesCoworkingMoralConDeposito.docx": "Coworking · Con depósito en garantía · Persona moral",
  "BosquesCoworkingMoralSinDeposito.docx": "Coworking · Sin depósito en garantía · Persona moral",
  "BosquesOficinaPrivadaFisica.docx": "Oficina Privada / Working Desk · Persona física",
  "BosquesOficinaPrivadaMoral.docx": "Oficina Privada / Working Desk · Persona moral",
  "Bosques.pptx": "Cotización · Sala de Juntas",
  "BosquesCoworking.pptx": "Cotización · Coworking",
  "BosquesOficinaPrivada.pptx": "Cotización · Oficina Privada / Working Desk",
};

const CARPETA: Record<Plantilla["tipo"], string> = {
  contrato: "plantillas-contrato",
  cotizacion: "plantillas-cotizacion",
};

const ACCEPT: Record<Plantilla["tipo"], string> = {
  contrato: ".docx",
  cotizacion: ".pptx",
};

// Aparte del componente de la página (no anidado adentro) para que React
// no la vuelva a montar cada vez que el padre cambia de estado — si vive
// adentro, cada re-render del padre crea una función "Fila" nueva y React
// la trata como un componente distinto, perdiendo el estado local
// (el "abierto" del formulario se cerraba solo al usarlo).
function Fila({
  p,
  subiendo,
  onDescargar,
  onSubir,
  onPedirRestaurar,
}: {
  p: Plantilla;
  subiendo: boolean;
  onDescargar: (p: Plantilla) => void;
  onSubir: (p: Plantilla, archivo: File) => Promise<string | null>;
  onPedirRestaurar: (p: Plantilla) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!archivo[0]) {
      setError("Sube un archivo primero");
      return;
    }
    setError(null);
    const errorMsg = await onSubir(p, archivo[0]);
    if (errorMsg) {
      setError(errorMsg);
      return;
    }
    setArchivo([]);
    setAbierto(false);
  }

  return (
    <div className="item-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div className="item-card-info">
          <p className="item-card-titulo">{ETIQUETAS[p.nombre_archivo] || p.nombre_archivo}</p>
          <p className="item-card-sub">
            {p.storage_path
              ? `Personalizada · actualizada por ${p.actualizado_por_nombre || "alguien del equipo"}`
              : "Original del sistema"}
          </p>
        </div>
        <span className="estado-badge" style={{ background: p.storage_path ? "#E1F5EE" : "#E6F1FB" }}>
          {p.storage_path ? "🎨 Personalizada" : "⚙️ Original"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="tel-borrar-btn" style={{ color: "#0d1b3e", fontWeight: 600 }} onClick={() => onDescargar(p)}>
          ⬇ Descargar actual
        </button>
        <button
          type="button"
          className="tel-borrar-btn"
          style={{ color: "#0d1b3e", fontWeight: 600 }}
          onClick={() => {
            setAbierto((v) => !v);
            setArchivo([]);
            setError(null);
          }}
        >
          {abierto ? "Cancelar" : "✎ Subir nueva versión"}
        </button>
        {p.storage_path && (
          <button type="button" className="tel-borrar-btn" style={{ color: "#A32D2D" }} onClick={() => onPedirRestaurar(p)}>
            ↺ Restaurar original
          </button>
        )}
      </div>

      {abierto && (
        <div className="form-card" style={{ marginTop: 8 }}>
          <p className="sub-label">Archivo nuevo ({ACCEPT[p.tipo]})</p>
          <FileDropzone files={archivo} onChange={setArchivo} maxFiles={1} accept={ACCEPT[p.tipo]} etiquetaTipos={ACCEPT[p.tipo]} />
          {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
          <button
            className={"btn-enviar" + (subiendo ? " sending" : "")}
            type="button"
            disabled={subiendo}
            onClick={guardar}
            style={{ marginTop: 8 }}
          >
            <span className="btn-enviar-text">{subiendo ? "Subiendo..." : "Guardar"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function PlantillasPage() {
  const supabase = createClient();
  const [miRol, setMiRol] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [subiendoId, setSubiendoId] = useState<string | null>(null);
  const [confirmandoRestaurarId, setConfirmandoRestaurarId] = useState<string | null>(null);
  const [tab, setTab] = useState<"contrato" | "cotizacion">("contrato");

  useEffect(() => {
    fetchTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTodo() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: perfil } = await supabase.from("profiles").select("rol, nombre").eq("id", user.id).single();
    setMiRol(perfil?.rol || "");
    setMiNombre(perfil?.nombre || "");

    const { data } = await supabase.from("plantillas_documentos").select("*").order("tipo").order("nombre_archivo");
    setPlantillas(data || []);
    setLoading(false);
  }

  async function descargarActual(p: Plantilla) {
    if (p.storage_path) {
      const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(p.storage_path, 300);
      if (signError || !data?.signedUrl) {
        alert("No se pudo generar el link de descarga: " + (signError?.message || "intenta de nuevo"));
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    } else {
      window.open(`/${CARPETA[p.tipo]}/${p.nombre_archivo}`, "_blank", "noopener");
    }
  }

  // Devuelve un mensaje de error para mostrar en la fila, o null si salió bien.
  async function subirNueva(p: Plantilla, archivo: File): Promise<string | null> {
    const extensionOk = p.tipo === "contrato" ? archivo.name.endsWith(".docx") : archivo.name.endsWith(".pptx");
    if (!extensionOk) return `Este archivo debe ser ${ACCEPT[p.tipo]}`;

    setSubiendoId(p.id);
    try {
      const rutaNueva = `${p.nombre_archivo}-${Date.now()}${p.tipo === "contrato" ? ".docx" : ".pptx"}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(rutaNueva, archivo, { contentType: archivo.type });
      if (uploadError) throw uploadError;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: updateError } = await supabase
        .from("plantillas_documentos")
        .update({
          storage_path: rutaNueva,
          actualizado_por: user?.id,
          actualizado_por_nombre: miNombre,
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      if (updateError) throw updateError;

      // Borra la versión anterior del bucket, si había una (no la
      // original del repo, esa nunca se sube a Storage).
      if (p.storage_path) await supabase.storage.from(BUCKET).remove([p.storage_path]);

      await fetchTodo();
      setSubiendoId(null);
      return null;
    } catch (e: any) {
      setSubiendoId(null);
      return "No se pudo subir: " + (e?.message || "intenta de nuevo");
    }
  }

  async function restaurarOriginal(p: Plantilla) {
    setConfirmandoRestaurarId(null);
    setSubiendoId(p.id);
    const { error: updateError } = await supabase
      .from("plantillas_documentos")
      .update({ storage_path: null, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!updateError && p.storage_path) {
      await supabase.storage.from(BUCKET).remove([p.storage_path]);
    }
    setSubiendoId(null);
    if (updateError) {
      alert("No se pudo restaurar: " + updateError.message);
      return;
    }
    await fetchTodo();
  }

  const sinPermiso = !loading && miRol !== "diseno" && miRol !== "superadmin" && miRol !== "gerente";
  const contratos = plantillas.filter((p) => p.tipo === "contrato");
  const cotizaciones = plantillas.filter((p) => p.tipo === "cotizacion");

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Plantillas</p>
        <p className="rep-sub">Machotes de contrato y presentaciones de cotización</p>
      </div>

      <div className="rep-content">
        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : sinPermiso ? (
          <div className="empty-card">No tienes permiso para ver esta sección.</div>
        ) : (
          <>
            <div className="centro-tabs" style={{ marginBottom: 12 }}>
              <button type="button" className={"centro-tab" + (tab === "contrato" ? " active" : "")} onClick={() => setTab("contrato")}>
                📝 Machote
              </button>
              <button type="button" className={"centro-tab" + (tab === "cotizacion" ? " active" : "")} onClick={() => setTab("cotizacion")}>
                📽️ Cotizaciones
              </button>
            </div>

            {tab === "contrato" ? (
              contratos.length === 0 ? (
                <div className="empty-card">Sin machotes registrados.</div>
              ) : (
                contratos.map((p) => (
                  <Fila
                    key={p.id}
                    p={p}
                    subiendo={subiendoId === p.id}
                    onDescargar={descargarActual}
                    onSubir={subirNueva}
                    onPedirRestaurar={(x) => setConfirmandoRestaurarId(x.id)}
                  />
                ))
              )
            ) : cotizaciones.length === 0 ? (
              <div className="empty-card">Sin plantillas de cotización registradas.</div>
            ) : (
              cotizaciones.map((p) => (
                <Fila
                  key={p.id}
                  p={p}
                  subiendo={subiendoId === p.id}
                  onDescargar={descargarActual}
                  onSubir={subirNueva}
                  onPedirRestaurar={(x) => setConfirmandoRestaurarId(x.id)}
                />
              ))
            )}
          </>
        )}
      </div>

      {confirmandoRestaurarId && (
        <div className="modal-overlay" onClick={() => setConfirmandoRestaurarId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Restaurar plantilla original</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Restaurar la plantilla original del sistema? Se deja de usar la versión que subiste.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoRestaurarId(null)}>
                Cancelar
              </button>
              <button
                className="btn-aceptar"
                onClick={() => {
                  const p = plantillas.find((x) => x.id === confirmandoRestaurarId);
                  if (p) restaurarOriginal(p);
                }}
              >
                ↺ Restaurar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
