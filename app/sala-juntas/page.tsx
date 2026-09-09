"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const SALA_DEFAULT: Record<string, string> = {
  Bosques: "Sala de 10 personas",
};

type Registro = {
  id: string;
  nombre: string;
  curp: string | null;
  tipo_sala: string | null;
  fecha: string;
  hora: string | null;
  archivo_url: string | null;
  encargado_nombre: string | null;
};

type EquipoState = {
  television: boolean;
  televisionCant: string;
  controlTv: boolean;
  controlTvCant: string;
  controlAc: boolean;
  plumones: boolean;
  plumonesCant: string;
  borrador: boolean;
  borradorCant: string;
  hdmiInalambrico: boolean;
  cableHdmi: boolean;
  adaptadorTipoC: boolean;
  otros: boolean;
  otrosTexto: string;
};

const equipoInicial: EquipoState = {
  television: false,
  televisionCant: "",
  controlTv: false,
  controlTvCant: "",
  controlAc: false,
  plumones: false,
  plumonesCant: "",
  borrador: false,
  borradorCant: "",
  hdmiInalambrico: false,
  cableHdmi: false,
  adaptadorTipoC: false,
  otros: false,
  otrosTexto: "",
};

type CondicionesState = {
  pisos: boolean;
  puertas: boolean;
  iluminacion: boolean;
  paredes: boolean;
  mobiliario: boolean;
  limpieza: boolean;
};

const condicionesInicial: CondicionesState = {
  pisos: false,
  puertas: false,
  iluminacion: false,
  paredes: false,
  mobiliario: false,
  limpieza: false,
};

function useFirma() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dibujando = useRef(false);
  // Guarda a qué elemento <canvas> del DOM ya le calculamos tamaño/contexto,
  // para detectar si se volvió a montar (ej. al salir y entrar de pestaña)
  // en vez de una bandera que nunca se reseteaba.
  const canvasListoRef = useRef<HTMLCanvasElement | null>(null);

  function asegurarTamano() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvasListoRef.current === canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ancho = Math.max(rect.width, 300);
    const alto = Math.max(rect.height, 100);
    canvas.width = ancho * 2;
    canvas.height = alto * 2;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(2, 2);
      ctx.strokeStyle = "#001a3d";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctxRef.current = ctx;
    }
    canvasListoRef.current = canvas;
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    asegurarTamano();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // en navegadores raros esto puede tronar; no debe impedir dibujar
    }
    dibujando.current = true;
    const p = pos(e);
    ctxRef.current?.beginPath();
    ctxRef.current?.moveTo(p.x, p.y);
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || !ctxRef.current) return;
    const p = pos(e);
    ctxRef.current.lineTo(p.x, p.y);
    ctxRef.current.stroke();
  }

  function handleUp() {
    dibujando.current = false;
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { canvasRef, limpiar, handleDown, handleMove, handleUp };
}

export default function SalaJuntasPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"nuevo" | "registros">("nuevo");
  const [centro, setCentro] = useState<string | null>(null);
  const [miRol, setMiRol] = useState("");
  const [loading, setLoading] = useState(true);
  const [registros, setRegistros] = useState<Registro[]>([]);

  const [nombre, setNombre] = useState("");
  const [curp, setCurp] = useState("");
  const [encargadoNombre, setEncargadoNombre] = useState("");
  const [tipoSala, setTipoSala] = useState("");
  const [equipo, setEquipo] = useState<EquipoState>(equipoInicial);
  const [condiciones, setCondiciones] = useState<CondicionesState>(condicionesInicial);
  const [notas, setNotas] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [hora, setHora] = useState(
    new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);

  const firma1 = useFirma();
  const firma2 = useFirma();
  const printRef = useRef<HTMLDivElement>(null);
  const [firmaImg1, setFirmaImg1] = useState<string | null>(null);
  const [firmaImg2, setFirmaImg2] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    setMiRol(profile?.rol || "");
    const c = profile?.centro || null;
    setCentro(c);
    if (c) {
      setTipoSala(SALA_DEFAULT[c] || "");
      await fetchRegistros(c, profile?.rol || "");
    }
    setLoading(false);
  }

  async function fetchRegistros(c: string, rol: string) {
    let query = supabase
      .from("registros_sala_juntas")
      .select("id, nombre, curp, tipo_sala, fecha, hora, archivo_url, encargado_nombre")
      .order("created_at", { ascending: false });
    if (!ROLES_GLOBALES.includes(rol)) query = query.eq("centro", c);
    const { data } = await query;
    setRegistros(data || []);
  }

  function limpiarFormulario() {
    setNombre("");
    setCurp("");
    setEncargadoNombre("");
    setTipoSala(centro ? SALA_DEFAULT[centro] || "" : "");
    setEquipo(equipoInicial);
    setCondiciones(condicionesInicial);
    setNotas("");
    firma1.limpiar();
    firma2.limpiar();
  }

  async function guardarYGenerarPDF() {
    setError("");
    if (!nombre.trim() || !curp.trim() || !tipoSala.trim() || !encargadoNombre.trim()) {
      setError("Faltan por llenar: Nombre, CURP, Sala y/o Encargado de Nodus que entrega");
      return;
    }
    if (!centro) return;
    setGuardando(true);

    try {
      // @ts-ignore — html2pdf.js no trae tipos, se usa dinámico porque
      // depende del navegador (canvas) y no puede correr en el servidor.
      const html2pdf = (await import("html2pdf.js")).default;
      const nombreArchivo = `Responsiva_${nombre.replace(/\s+/g, "_")}_${Date.now()}.pdf`;

      // Las firmas se pasan como imagen (no como el <canvas> vivo) y los
      // campos de texto se renderizan en una versión oculta de solo texto
      // (no <input>) — html2canvas a veces corta el texto dentro de campos
      // de formulario, pero con texto plano siempre sale bien.
      setFirmaImg1(firma1.canvasRef.current?.toDataURL() || null);
      setFirmaImg2(firma2.canvasRef.current?.toDataURL() || null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const blob: Blob = await html2pdf()
        .set({
          margin: [6, 8, 6, 8],
          filename: nombreArchivo,
          image: { type: "jpeg", quality: 1 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "letter", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(printRef.current)
        .outputPdf("blob");

      const { error: uploadError } = await supabase.storage
        .from("sala-juntas")
        .upload(nombreArchivo, blob, { contentType: "application/pdf", upsert: true });

      let archivoUrl: string | null = null;
      if (uploadError) {
        setError(
          "El PDF se generó pero no se pudo subir al servidor: " +
            uploadError.message +
            ". Revisa que el bucket 'sala-juntas' exista en Supabase Storage."
        );
      } else {
        const { data: urlData } = supabase.storage.from("sala-juntas").getPublicUrl(nombreArchivo);
        archivoUrl = urlData.publicUrl;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await supabase.from("registros_sala_juntas").insert({
        centro,
        nombre,
        curp,
        tipo_sala: tipoSala,
        equipo,
        condiciones,
        notas: notas || null,
        fecha,
        hora,
        archivo_url: archivoUrl,
        encargado_nombre: encargadoNombre,
        registrado_por: user?.id,
      });

      if (insertError) {
        setError("El PDF se generó pero no se pudo guardar el registro.");
      } else {
        // Descarga el PDF al equipo de una vez, además de guardarlo
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = nombreArchivo;
        link.click();

        setExito(true);
        limpiarFormulario();
        fetchRegistros(centro, miRol);
      }
    } catch (err) {
      console.error(err);
      setError("Ocurrió un error generando el PDF. Intenta de nuevo.");
    }
    setGuardando(false);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Sala de Juntas</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
      </div>

      <div className="centro-tabs">
        <button
          className={"centro-tab" + (tab === "nuevo" ? " active" : "")}
          onClick={() => setTab("nuevo")}
        >
          📝 Nueva carta responsiva
        </button>
        <button
          className={"centro-tab" + (tab === "registros" ? " active" : "")}
          onClick={() => setTab("registros")}
        >
          📁 Registros ({registros.length})
        </button>
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
        ) : !centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : tab === "registros" ? (
          <>
            {registros.length === 0 ? (
              <div className="empty-card">Sin registros guardados todavía</div>
            ) : (
              registros.map((r) => (
                <div className="item-card" key={r.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">{r.nombre}</p>
                    <p className="item-card-sub">
                      {r.tipo_sala} · {r.fecha} {r.hora ? `· ${r.hora}` : ""}
                    </p>
                    {r.encargado_nombre && (
                      <p className="item-card-extra">Entregó: {r.encargado_nombre}</p>
                    )}
                  </div>
                  {r.archivo_url ? (
                    <a
                      className="ver-pdf-btn"
                      href={r.archivo_url}
                      target="_blank"
                      download
                      title="Se abre en una pestaña nueva; usa el ícono de imprimir de tu navegador ahí para imprimirlo"
                    >
                      📥 Ver / descargar / imprimir
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: "#aaa" }}>Sin PDF</span>
                  )}
                </div>
              ))
            )}
          </>
        ) : (
          <>
            {exito && (
              <div className="cli-al-corriente" style={{ marginBottom: 4 }}>
                <p className="cli-al-corriente-icon">✅</p>
                <p className="cli-al-corriente-text">Carta responsiva guardada</p>
                <p className="cli-al-corriente-sub">
                  Se descargó el PDF y quedó guardada en "Registros".
                </p>
              </div>
            )}

            {/* ---------- Documento (esto es lo que se convierte a PDF) ---------- */}
            <div className="responsiva-doc">
              <div className="responsiva-header">
                <img
                  src="https://i.postimg.cc/nrct8ZXn/LOGO-NODUS-03.png"
                  alt="Nodus Flex Center"
                  crossOrigin="anonymous"
                  style={{ height: 48, width: "auto", objectFit: "contain" }}
                />
                <div className="responsiva-meta">
                  <div className="responsiva-meta-field">
                    <label>Fecha</label>
                    <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                  </div>
                  <div className="responsiva-meta-field">
                    <label>Hora</label>
                    <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
                  </div>
                  <div className="responsiva-meta-field">
                    <label>Centro</label>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{centro}</span>
                  </div>
                </div>
              </div>

              <h1 className="responsiva-title">Carta responsiva de Sala de Juntas</h1>

              <p className="responsiva-section-title">Sala</p>
              <input
                className="responsiva-sala-input"
                value={tipoSala}
                onChange={(e) => setTipoSala(e.target.value)}
                placeholder="Ej. Sala de 10 personas"
                disabled={!!(centro && SALA_DEFAULT[centro])}
                style={
                  centro && SALA_DEFAULT[centro]
                    ? { background: "#f5f5f5", color: "#555", cursor: "not-allowed" }
                    : undefined
                }
              />

              <p className="responsiva-section-title">Encargado de Nodus que entrega la sala</p>
              <input
                className="responsiva-sala-input"
                value={encargadoNombre}
                onChange={(e) => setEncargadoNombre(e.target.value)}
                placeholder="Nombre completo (obligatorio)"
              />

              <p className="responsiva-parrafo">
                Por medio de la presente, yo,{" "}
                <input
                  className="responsiva-inline-input"
                  style={{ width: 220 }}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre completo"
                />
                , con identificación oficial con CURP{" "}
                <input
                  className="responsiva-inline-input"
                  style={{ width: 180, textTransform: "uppercase" }}
                  value={curp}
                  onChange={(e) => setCurp(e.target.value.toUpperCase())}
                  placeholder="Clave CURP"
                />
                , hago constar que he recibido en calidad de uso temporal, el siguiente equipo:
              </p>

              <p className="responsiva-section-title">Equipamiento</p>
              <div className="responsiva-equipo-grid">
                <div>
                  <div className="responsiva-check-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={equipo.television}
                        onChange={(e) => setEquipo({ ...equipo, television: e.target.checked })}
                      />
                      Televisión
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={equipo.televisionCant}
                      onChange={(e) => setEquipo({ ...equipo, televisionCant: e.target.value })}
                    />
                  </div>
                  <div className="responsiva-check-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={equipo.controlTv}
                        onChange={(e) => setEquipo({ ...equipo, controlTv: e.target.checked })}
                      />
                      Control de TV
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={equipo.controlTvCant}
                      onChange={(e) => setEquipo({ ...equipo, controlTvCant: e.target.value })}
                    />
                  </div>
                  <label style={{ display: "flex", gap: 6, fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={equipo.controlAc}
                      onChange={(e) => setEquipo({ ...equipo, controlAc: e.target.checked })}
                    />
                    Control de AC
                  </label>
                </div>
                <div>
                  <div className="responsiva-check-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={equipo.plumones}
                        onChange={(e) => setEquipo({ ...equipo, plumones: e.target.checked })}
                      />
                      Plumones
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={equipo.plumonesCant}
                      onChange={(e) => setEquipo({ ...equipo, plumonesCant: e.target.value })}
                    />
                  </div>
                  <div className="responsiva-check-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={equipo.borrador}
                        onChange={(e) => setEquipo({ ...equipo, borrador: e.target.checked })}
                      />
                      Borrador
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={equipo.borradorCant}
                      onChange={(e) => setEquipo({ ...equipo, borradorCant: e.target.value })}
                    />
                  </div>
                  <label style={{ display: "flex", gap: 6, fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={equipo.hdmiInalambrico}
                      onChange={(e) => setEquipo({ ...equipo, hdmiInalambrico: e.target.checked })}
                    />
                    HDMI inalámbrico
                  </label>
                </div>
                <div>
                  <label style={{ display: "flex", gap: 6, fontWeight: 600, cursor: "pointer", marginBottom: 5 }}>
                    <input
                      type="checkbox"
                      checked={equipo.cableHdmi}
                      onChange={(e) => setEquipo({ ...equipo, cableHdmi: e.target.checked })}
                    />
                    Cable HDMI
                  </label>
                  <label style={{ display: "flex", gap: 6, fontWeight: 600, cursor: "pointer", marginBottom: 5 }}>
                    <input
                      type="checkbox"
                      checked={equipo.adaptadorTipoC}
                      onChange={(e) => setEquipo({ ...equipo, adaptadorTipoC: e.target.checked })}
                    />
                    Adaptador Tipo C
                  </label>
                  <label style={{ display: "flex", gap: 6, fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={equipo.otros}
                      onChange={(e) => setEquipo({ ...equipo, otros: e.target.checked })}
                    />
                    Otros:
                  </label>
                  <input
                    style={{ width: "100%", borderBottom: "1px solid #ccc", outline: "none", fontWeight: 700, marginTop: 4 }}
                    value={equipo.otrosTexto}
                    onChange={(e) => setEquipo({ ...equipo, otrosTexto: e.target.value })}
                  />
                </div>
              </div>

              <p style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 10 }}>
                El cliente declara que ha revisado físicamente la sala de juntas al momento de
                recibirla y confirma que se encuentra en buen estado de uso y conservación,
                incluyendo:
              </p>
              <div className="responsiva-condiciones-grid">
                {(
                  [
                    ["pisos", "Pisos y/o alfombras"],
                    ["puertas", "Puertas y cristales"],
                    ["iluminacion", "Iluminación"],
                    ["paredes", "Paredes"],
                    ["mobiliario", "Mobiliario"],
                    ["limpieza", "Limpieza general"],
                  ] as [keyof CondicionesState, string][]
                ).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={condiciones[key]}
                      onChange={(e) => setCondiciones({ ...condiciones, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="responsiva-legal-box">
                Me comprometo a hacer buen uso del equipo mencionado, así como a devolverlo en
                las mismas condiciones en las que me fue entregado. Acepto que soy responsable de
                cualquier daño o pérdida, y en caso de presentarse, me comprometo a cubrir el
                costo correspondiente.
              </div>

              <p className="responsiva-section-title">Notas / observaciones</p>
              <textarea className="responsiva-notas" value={notas} onChange={(e) => setNotas(e.target.value)} />

              <div className="responsiva-firmas">
                <div>
                  <div className="responsiva-firma-box">
                    <canvas
                      ref={firma1.canvasRef}
                      onPointerDown={firma1.handleDown}
                      onPointerMove={firma1.handleMove}
                      onPointerUp={firma1.handleUp}
                      onPointerLeave={firma1.handleUp}
                    />
                    <button
                      type="button"
                      className="responsiva-firma-limpiar"
                      onClick={firma1.limpiar}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="responsiva-firma-label">Firma Cliente / Responsable</p>
                </div>
                <div>
                  <div className="responsiva-firma-box">
                    <canvas
                      ref={firma2.canvasRef}
                      onPointerDown={firma2.handleDown}
                      onPointerMove={firma2.handleMove}
                      onPointerUp={firma2.handleUp}
                      onPointerLeave={firma2.handleUp}
                    />
                    <button
                      type="button"
                      className="responsiva-firma-limpiar"
                      onClick={firma2.limpiar}
                    >
                      ✕
                    </button>
                  </div>
                  <p className="responsiva-firma-label">Firma Encargado Nodus</p>
                </div>
              </div>
            </div>

            {/* ---------- Versión oculta de solo texto (esto es lo que se convierte a PDF) ---------- */}
            <div style={{ position: "fixed", left: -9999, top: 0, width: 800 }}>
              <div className="responsiva-doc" ref={printRef}>
                <div className="responsiva-header">
                  <img
                    src="https://i.postimg.cc/nrct8ZXn/LOGO-NODUS-03.png"
                    alt="Nodus Flex Center"
                    crossOrigin="anonymous"
                    style={{ height: 48, width: "auto", objectFit: "contain" }}
                  />
                  <div className="responsiva-meta">
                    <div className="responsiva-meta-field">
                      <label>Fecha</label>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{fecha}</span>
                    </div>
                    <div className="responsiva-meta-field">
                      <label>Hora</label>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{hora}</span>
                    </div>
                    <div className="responsiva-meta-field">
                      <label>Centro</label>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{centro}</span>
                    </div>
                  </div>
                </div>

                <h1 className="responsiva-title">Carta responsiva de Sala de Juntas</h1>

                <p className="responsiva-section-title">Sala</p>
                <div className="responsiva-sala-input">{tipoSala}</div>

                <p className="responsiva-section-title">Encargado de Nodus que entrega la sala</p>
                <div className="responsiva-sala-input">{encargadoNombre}</div>

                <p className="responsiva-parrafo">
                  Por medio de la presente, yo,{" "}
                  <span className="responsiva-inline-input">{nombre}</span>, con identificación
                  oficial con CURP <span className="responsiva-inline-input">{curp}</span>, hago
                  constar que he recibido en calidad de uso temporal, el siguiente equipo:
                </p>

                <p className="responsiva-section-title">Equipamiento</p>
                <div className="responsiva-equipo-grid">
                  <div>
                    <div className="responsiva-check-row">
                      <span>{equipo.television ? "☑" : "☐"} Televisión</span>
                      <span>{equipo.televisionCant}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>{equipo.controlTv ? "☑" : "☐"} Control de TV</span>
                      <span>{equipo.controlTvCant}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>{equipo.controlAc ? "☑" : "☐"} Control de AC</span>
                    </div>
                  </div>
                  <div>
                    <div className="responsiva-check-row">
                      <span>{equipo.plumones ? "☑" : "☐"} Plumones</span>
                      <span>{equipo.plumonesCant}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>{equipo.borrador ? "☑" : "☐"} Borrador</span>
                      <span>{equipo.borradorCant}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>{equipo.hdmiInalambrico ? "☑" : "☐"} HDMI inalámbrico</span>
                    </div>
                  </div>
                  <div>
                    <div className="responsiva-check-row">
                      <span>{equipo.cableHdmi ? "☑" : "☐"} Cable HDMI</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>{equipo.adaptadorTipoC ? "☑" : "☐"} Adaptador Tipo C</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>
                        {equipo.otros ? "☑" : "☐"} Otros: {equipo.otrosTexto}
                      </span>
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 10 }}>
                  El cliente declara que ha revisado físicamente la sala de juntas al momento de
                  recibirla y confirma que se encuentra en buen estado de uso y conservación,
                  incluyendo:
                </p>
                <div className="responsiva-condiciones-grid">
                  {(
                    [
                      ["pisos", "Pisos y/o alfombras"],
                      ["puertas", "Puertas y cristales"],
                      ["iluminacion", "Iluminación"],
                      ["paredes", "Paredes"],
                      ["mobiliario", "Mobiliario"],
                      ["limpieza", "Limpieza general"],
                    ] as [keyof CondicionesState, string][]
                  ).map(([key, label]) => (
                    <span key={key}>
                      {condiciones[key] ? "☑" : "☐"} {label}
                    </span>
                  ))}
                </div>

                <div className="responsiva-legal-box">
                  Me comprometo a hacer buen uso del equipo mencionado, así como a devolverlo en
                  las mismas condiciones en las que me fue entregado. Acepto que soy responsable de
                  cualquier daño o pérdida, y en caso de presentarse, me comprometo a cubrir el
                  costo correspondiente.
                </div>

                <p className="responsiva-section-title">Notas / observaciones</p>
                <div className="responsiva-notas" style={{ whiteSpace: "pre-wrap" }}>
                  {notas}
                </div>

                <div className="responsiva-firmas">
                  <div>
                    <div className="responsiva-firma-box">
                      {firmaImg1 && (
                        <img src={firmaImg1} alt="Firma cliente" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
                    </div>
                    <p className="responsiva-firma-label">Firma Cliente / Responsable</p>
                  </div>
                  <div>
                    <div className="responsiva-firma-box">
                      {firmaImg2 && (
                        <img src={firmaImg2} alt="Firma encargado" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
                    </div>
                    <p className="responsiva-firma-label">Firma Encargado Nodus</p>
                  </div>
                </div>
              </div>
            </div>

            {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{error}</p>}

            <button className="reservar-btn" onClick={guardarYGenerarPDF} disabled={guardando}>
              {guardando ? "Generando..." : "💾 Guardar y descargar PDF"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
