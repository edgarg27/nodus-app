"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportarExcel } from "@/lib/exportExcel";

const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];
const TIPOS_EQUIPO = ["Laptop", "Computadora de escritorio", "Celular", "Tablet", "Monitor", "Impresora", "Otro"];

const ESTADOS: Record<string, { label: string; bg: string; color: string }> = {
  asignado: { label: "Asignado", bg: "#E6F1FB", color: "#185FA5" },
  devuelto: { label: "Devuelto", bg: "#F0F0F0", color: "#666" },
};

type Equipo = {
  id: string;
  tipo_equipo: string;
  marca_modelo: string | null;
  numero_serie: string | null;
  asignado_a: string;
  puesto: string | null;
  centro: string | null;
  fecha_asignacion: string;
  estado: string;
  notas: string | null;
  responsiva_url: string | null;
};

type Responsiva = {
  id: string;
  equipo_id: string | null;
  tipo: string;
  origen: string | null;
  asignado_a: string;
  tipo_equipo: string;
  marca_modelo: string | null;
  numero_serie: string | null;
  centro: string | null;
  entregado_por: string;
  fecha: string;
  notas: string | null;
  archivo_url: string | null;
};

function useFirma() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dibujando = useRef(false);
  // Guarda a qué elemento <canvas> del DOM ya le calculamos tamaño/contexto.
  // Antes usábamos nada más un booleano que nunca se reseteaba, así que si
  // el canvas se volvía a montar (por ejemplo al salir y volver a entrar a
  // la pestaña "Nueva responsiva"), el código seguía dibujando sobre el
  // <canvas> viejo (ya desaparecido de la pantalla) en vez del nuevo — por
  // eso a veces "no dejaba firmar": sí dibujaba, pero en un lienzo invisible.
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

export default function EquiposPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"equipos" | "nueva" | "responsivas">("equipos");
  const [loading, setLoading] = useState(true);
  const [miRol, setMiRol] = useState("");
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [responsivas, setResponsivas] = useState<Responsiva[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "asignado" | "devuelto">("todos");

  // ---------- Responsiva ----------
  const [tipoResponsiva, setTipoResponsiva] = useState<"entrega" | "devolucion">("entrega");
  // Generar una devolución desde la lista de equipos abre este formulario
  // en un modal en vez de cambiar de pestaña (ver abrirModalDevolucion).
  const [modalDevolucionAbierto, setModalDevolucionAbierto] = useState(false);
  const [condicionesDevolucion, setCondicionesDevolucion] = useState({
    funciona: false,
    sinDanos: false,
    accesoriosCompletos: false,
    pantallaBuenEstado: false,
  });
  const [filtroTipoResponsiva, setFiltroTipoResponsiva] = useState<"todas" | "entrega" | "devolucion">("todas");
  const [equipoIdSeleccionado, setEquipoIdSeleccionado] = useState("");
  const [respAsignadoA, setRespAsignadoA] = useState("");
  const [respTipoEquipo, setRespTipoEquipo] = useState("");
  const [respMarcaModelo, setRespMarcaModelo] = useState("");
  const [respNumeroSerie, setRespNumeroSerie] = useState("");
  const [respCentro, setRespCentro] = useState("");
  const [entregadoPor, setEntregadoPor] = useState("");
  const [respFecha, setRespFecha] = useState(new Date().toISOString().split("T")[0]);
  const [respNotas, setRespNotas] = useState("");
  const [guardandoResp, setGuardandoResp] = useState(false);
  const [errorResp, setErrorResp] = useState("");
  const [exitoResp, setExitoResp] = useState(false);

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
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("rol").eq("id", user.id).single();
    setMiRol(profile?.rol || "");
    await Promise.all([fetchEquipos(), fetchResponsivas()]);
    setLoading(false);
  }

  async function fetchEquipos() {
    const { data } = await supabase.from("equipos_asignados").select("*").order("estado").order("asignado_a");
    setEquipos(data || []);
  }

  async function fetchResponsivas() {
    const { data } = await supabase
      .from("responsivas_equipo")
      .select("*")
      .order("created_at", { ascending: false });
    setResponsivas(data || []);
  }

  const equiposFiltrados = equipos.filter((e) => {
    if (filtroEstado !== "todos" && e.estado !== filtroEstado) return false;
    const q = busqueda.toLowerCase();
    if (!q) return true;
    return (
      e.asignado_a.toLowerCase().includes(q) ||
      e.tipo_equipo.toLowerCase().includes(q) ||
      e.marca_modelo?.toLowerCase().includes(q) ||
      e.numero_serie?.toLowerCase().includes(q) ||
      e.centro?.toLowerCase().includes(q)
    );
  });

  const conteo = {
    asignado: equipos.filter((e) => e.estado === "asignado").length,
    devuelto: equipos.filter((e) => e.estado === "devuelto").length,
  };



  async function cambiarEstado(id: string, estado: string) {
    await supabase.from("equipos_asignados").update({ estado }).eq("id", id);
    setEquipos((prev) => prev.map((e) => (e.id === id ? { ...e, estado } : e)));
  }

  async function borrarEquipo(id: string) {
    if (
      !confirm(
        "¿Borrar este registro de equipo? Esto es solo para errores de captura — si el equipo ya no está asignado, mejor cambia su estatus a 'Devuelto'."
      )
    )
      return;
    await supabase.from("equipos_asignados").delete().eq("id", id);
    fetchEquipos();
  }

  function irAGenerarResponsiva(eq: Equipo, tipo: "entrega" | "devolucion") {
    setTipoResponsiva(tipo);
    setEquipoIdSeleccionado(eq.id);
    setRespAsignadoA(eq.asignado_a);
    setRespTipoEquipo(eq.tipo_equipo);
    setRespMarcaModelo(eq.marca_modelo || "");
    setRespNumeroSerie(eq.numero_serie || "");
    setRespCentro(eq.centro || "");
    setCondicionesDevolucion({ funciona: false, sinDanos: false, accesoriosCompletos: false, pantallaBuenEstado: false });
    setTab("nueva");
  }

  function limpiarFormularioResponsiva() {
    setEquipoIdSeleccionado("");
    setRespAsignadoA("");
    setRespTipoEquipo("");
    setRespMarcaModelo("");
    setRespNumeroSerie("");
    setRespCentro("");
    setEntregadoPor("");
    setRespNotas("");
    setCondicionesDevolucion({ funciona: false, sinDanos: false, accesoriosCompletos: false, pantallaBuenEstado: false });
    firma1.limpiar();
    firma2.limpiar();
  }

  // Generar una devolución desde la lista de equipos ya NO cambia de
  // pestaña — abre el mismo formulario dentro de un modal, encima de
  // "Equipos", para que buscar -> generar devolución no te saque de la
  // lista (ni pierdas la búsqueda/filtro que tenías puestos).
  function abrirModalDevolucion(eq: Equipo) {
    setExitoResp(false);
    setErrorResp("");
    setTipoResponsiva("devolucion");
    setEquipoIdSeleccionado(eq.id);
    setRespAsignadoA(eq.asignado_a);
    setRespTipoEquipo(eq.tipo_equipo);
    setRespMarcaModelo(eq.marca_modelo || "");
    setRespNumeroSerie(eq.numero_serie || "");
    setRespCentro(eq.centro || "");
    setCondicionesDevolucion({ funciona: false, sinDanos: false, accesoriosCompletos: false, pantallaBuenEstado: false });
    setModalDevolucionAbierto(true);
  }

  function cerrarModalDevolucion() {
    setModalDevolucionAbierto(false);
    limpiarFormularioResponsiva();
  }

  // Tras guardar una devolución, cierra el modal (o si se generó desde la
  // pestaña "Nueva responsiva" manualmente, regresa a "Equipos") en vez de
  // dejar al usuario ahí. Una entrega sí se queda en el formulario, porque
  // ahí es común capturar varios equipos nuevos seguidos.
  function finalizarGuardadoResponsiva() {
    setExitoResp(true);
    limpiarFormularioResponsiva();
    fetchEquipos();
    fetchResponsivas();
    if (modalDevolucionAbierto) {
      setModalDevolucionAbierto(false);
      setTimeout(() => setExitoResp(false), 3000);
    } else if (tipoResponsiva === "devolucion") {
      setTab("equipos");
      setTimeout(() => setExitoResp(false), 3000);
    }
  }

  function seleccionarEquipoParaResponsiva(id: string) {
    setEquipoIdSeleccionado(id);
    const eq = equipos.find((e) => e.id === id);
    if (eq) {
      setRespAsignadoA(eq.asignado_a);
      setRespTipoEquipo(eq.tipo_equipo);
      setRespMarcaModelo(eq.marca_modelo || "");
      setRespNumeroSerie(eq.numero_serie || "");
      setRespCentro(eq.centro || "");
    }
  }

  // Genera el PDF con los datos que ya llenaste (con o sin firma digital) y
  // lo abre en una pestaña nueva para que lo imprimas y lo firmen a mano —
  // no guarda nada en la base de datos, es solo para tener el papel físico.
  async function imprimirFormato() {
    setErrorResp("");
    if (!respAsignadoA.trim() || !respTipoEquipo.trim() || !entregadoPor.trim()) {
      setErrorResp("Faltan por llenar: a quién se asigna, tipo de equipo y quién entrega");
      return;
    }
    try {
      // @ts-ignore
      const html2pdf = (await import("html2pdf.js")).default;
      // A propósito NO capturamos lo que haya en los lienzos de firma —
      // aunque ya hayan garabateado algo ahí, el impreso debe salir con el
      // espacio en blanco listo para firmarse a mano.
      setFirmaImg1(null);
      setFirmaImg2(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const blob: Blob = await html2pdf()
        .set({
          margin: [6, 8, 6, 8],
          image: { type: "jpeg", quality: 1 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "letter", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(printRef.current)
        .outputPdf("blob");

      const url = URL.createObjectURL(blob);
      const ventana = window.open(url, "_blank");
      // La mayoría de los navegadores abren el PDF con su propio visor,
      // desde ahí el usuario le da Ctrl+P / el ícono de imprimir. Intentamos
      // disparar el diálogo de impresión directo también, por si acaso.
      if (ventana) {
        ventana.onload = () => {
          try {
            ventana.print();
          } catch {
            // algunos navegadores no dejan, no pasa nada, ya lo tiene abierto
          }
        };
      }
    } catch (err) {
      console.error(err);
      setErrorResp("No se pudo generar el PDF para imprimir. Intenta de nuevo.");
    }
  }

  // Sube un documento ya escaneado/firmado a mano, en vez de generar el PDF
  // con firma digital — para cuando prefieren imprimir y firmar en papel.
  async function subirDocumentoEscaneado(archivo: File) {
    setErrorResp("");
    if (!respAsignadoA.trim() || !respCentro.trim()) {
      setErrorResp("Faltan por llenar: nombre y centro");
      return;
    }
    setGuardandoResp(true);

    try {
      const idEquipo = await asegurarEquipo();

      const nombreArchivo = `${tipoResponsiva === "entrega" ? "Responsiva" : "Devolucion"}_${respAsignadoA.replace(
        /\s+/g,
        "_"
      )}_${Date.now()}_${archivo.name.replace(/\s+/g, "_")}`;

      const { error: uploadError } = await supabase.storage
        .from("responsivas-equipo")
        .upload(nombreArchivo, archivo, { contentType: archivo.type, upsert: true });

      if (uploadError) {
        setErrorResp(
          "No se pudo subir el archivo: " + uploadError.message + ". Revisa que el bucket 'responsivas-equipo' exista."
        );
        setGuardandoResp(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("responsivas-equipo").getPublicUrl(nombreArchivo);
      const archivoUrl = urlData.publicUrl;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await supabase.from("responsivas_equipo").insert({
        equipo_id: idEquipo,
        tipo: tipoResponsiva,
        origen: "escaneada",
        asignado_a: respAsignadoA,
        tipo_equipo: respTipoEquipo || "Otro",
        marca_modelo: respMarcaModelo || null,
        numero_serie: respNumeroSerie || null,
        centro: respCentro || null,
        entregado_por: entregadoPor || null,
        fecha: respFecha,
        notas: respNotas || null,
        archivo_url: archivoUrl,
        registrado_por: user?.id,
      });

      if (idEquipo && tipoResponsiva === "entrega") {
        await supabase.from("equipos_asignados").update({ responsiva_url: archivoUrl }).eq("id", idEquipo);
      }

      if (insertError) {
        setErrorResp("El archivo se subió pero no se pudo guardar el registro.");
      } else {
        finalizarGuardadoResponsiva();
      }
    } catch (err) {
      console.error(err);
      setErrorResp("Ocurrió un error subiendo el archivo. Intenta de nuevo.");
    }
    setGuardandoResp(false);
  }

  // Si es una ENTREGA nueva (no una devolución) y no se vinculó a un equipo
  // ya existente, la responsiva misma da de alta el equipo — ya no hay
  // formulario aparte para eso. Regresa el id del equipo a usar (el ya
  // existente si se vinculó, o el recién creado).
  async function asegurarEquipo(): Promise<string | null> {
    if (equipoIdSeleccionado) return equipoIdSeleccionado;
    if (tipoResponsiva !== "entrega") return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error: insertError } = await supabase
      .from("equipos_asignados")
      .insert({
        tipo_equipo: respTipoEquipo || "Otro",
        marca_modelo: respMarcaModelo || null,
        numero_serie: respNumeroSerie || null,
        asignado_a: respAsignadoA,
        centro: respCentro || null,
        fecha_asignacion: respFecha,
        estado: "asignado",
        notas: respNotas || null,
        registrado_por: user?.id,
      })
      .select("id")
      .single();

    if (insertError || !data) return null;
    return data.id as string;
  }

  async function guardarYGenerarPDF() {
    setErrorResp("");
    if (!respAsignadoA.trim() || !respTipoEquipo.trim() || !entregadoPor.trim()) {
      setErrorResp("Faltan por llenar: a quién se asigna, tipo de equipo y quién entrega");
      return;
    }
    setGuardandoResp(true);

    try {
      const idEquipo = await asegurarEquipo();

      // @ts-ignore — html2pdf.js no trae tipos, se usa dinámico porque
      // depende del navegador (canvas) y no puede correr en el servidor.
      const html2pdf = (await import("html2pdf.js")).default;
      const nombreArchivo = `${tipoResponsiva === "entrega" ? "Responsiva" : "Devolucion"}_${respAsignadoA.replace(/\s+/g, "_")}_${Date.now()}.pdf`;

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
        .from("responsivas-equipo")
        .upload(nombreArchivo, blob, { contentType: "application/pdf", upsert: true });

      let archivoUrl: string | null = null;
      if (uploadError) {
        setErrorResp(
          "El PDF se generó pero no se pudo subir al servidor: " +
            uploadError.message +
            ". Revisa que el bucket 'responsivas-equipo' exista en Supabase Storage."
        );
      } else {
        const { data: urlData } = supabase.storage.from("responsivas-equipo").getPublicUrl(nombreArchivo);
        archivoUrl = urlData.publicUrl;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await supabase.from("responsivas_equipo").insert({
        equipo_id: idEquipo,
        tipo: tipoResponsiva,
        origen: "digital",
        asignado_a: respAsignadoA,
        tipo_equipo: respTipoEquipo,
        marca_modelo: respMarcaModelo || null,
        numero_serie: respNumeroSerie || null,
        centro: respCentro || null,
        entregado_por: entregadoPor,
        fecha: respFecha,
        notas: respNotas || null,
        archivo_url: archivoUrl,
        registrado_por: user?.id,
      });

      // El link "Ver responsiva" en la tarjeta de equipo solo aplica a la
      // responsiva de entrega original — una devolución no lo debe pisar.
      if (idEquipo && archivoUrl && tipoResponsiva === "entrega") {
        await supabase.from("equipos_asignados").update({ responsiva_url: archivoUrl }).eq("id", idEquipo);
      }

      if (insertError) {
        setErrorResp("El PDF se generó pero no se pudo guardar el registro.");
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = nombreArchivo;
        link.click();

        finalizarGuardadoResponsiva();
      }
    } catch (err) {
      console.error(err);
      setErrorResp("Ocurrió un error generando el PDF. Intenta de nuevo.");
    }
    setGuardandoResp(false);
  }

  const formularioResponsiva = (
    <>
            {exitoResp && (
              <div className="cli-al-corriente" style={{ marginBottom: 4 }}>
                <p className="cli-al-corriente-icon">✅</p>
                <p>Responsiva guardada y descargada.</p>
              </div>
            )}

            {/* El toggle Entrega/Devolución solo se muestra en la pestaña "Nueva
               responsiva" — dentro del modal de devolución rápida siempre es
               devolución, no tiene caso ofrecer cambiarlo. */}
            {!modalDevolucionAbierto && (
              <div className="tickets-filtros" style={{ marginBottom: 12 }}>
                <button
                  className={"filtro-chip" + (tipoResponsiva === "entrega" ? " active" : "")}
                  onClick={() => setTipoResponsiva("entrega")}
                >
                  📝 Entrega
                </button>
                <button
                  className={"filtro-chip" + (tipoResponsiva === "devolucion" ? " active" : "")}
                  onClick={() => setTipoResponsiva("devolucion")}
                >
                  ↩️ Devolución
                </button>
              </div>
            )}

            <p className="panel-section-label">Vincular a un equipo ya registrado (opcional)</p>
            <select
              className="ticket-admin-select"
              style={{ width: "100%", marginBottom: 12 }}
              value={equipoIdSeleccionado}
              onChange={(e) => seleccionarEquipoParaResponsiva(e.target.value)}
            >
              <option value="">— Llenar manualmente —</option>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.asignado_a} · {eq.tipo_equipo} {eq.marca_modelo ? `(${eq.marca_modelo})` : ""}
                </option>
              ))}
            </select>

            <div className="tel-form-grid" style={{ marginBottom: 8 }}>
              <input
                placeholder="Asignado a (nombre completo)"
                value={respAsignadoA}
                onChange={(e) => setRespAsignadoA(e.target.value)}
              />
              <select value={respTipoEquipo} onChange={(e) => setRespTipoEquipo(e.target.value)}>
                <option value="">Tipo de equipo</option>
                {TIPOS_EQUIPO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                placeholder="Marca / modelo"
                value={respMarcaModelo}
                onChange={(e) => setRespMarcaModelo(e.target.value)}
              />
              <input
                placeholder="Número de serie"
                value={respNumeroSerie}
                onChange={(e) => setRespNumeroSerie(e.target.value)}
              />
              <select value={respCentro} onChange={(e) => setRespCentro(e.target.value)}>
                <option value="">Centro</option>
                {CENTROS_SUGERIDOS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                placeholder={tipoResponsiva === "entrega" ? "Entregado por (encargado de Nodus)" : "Recibido por (encargado de Nodus)"}
                value={entregadoPor}
                onChange={(e) => setEntregadoPor(e.target.value)}
              />
              <input type="date" value={respFecha} onChange={(e) => setRespFecha(e.target.value)} />
            </div>

            {tipoResponsiva === "devolucion" && (
              <>
                <p className="responsiva-section-title">Condición en la que se recibe el equipo</p>
                <div className="responsiva-condiciones-grid">
                  {(
                    [
                      ["funciona", "Funciona correctamente"],
                      ["sinDanos", "Sin daños visibles"],
                      ["accesoriosCompletos", "Cargador/accesorios completos"],
                      ["pantallaBuenEstado", "Pantalla en buen estado"],
                    ] as [keyof typeof condicionesDevolucion, string][]
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={condicionesDevolucion[key]}
                        onChange={(e) => setCondicionesDevolucion({ ...condicionesDevolucion, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}

            <p className="responsiva-section-title">Notas / observaciones</p>
            <textarea className="responsiva-notas" value={respNotas} onChange={(e) => setRespNotas(e.target.value)} />

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
                  <button type="button" className="responsiva-firma-limpiar" onClick={firma1.limpiar}>
                    ✕
                  </button>
                </div>
                <p className="responsiva-firma-label">Firma quien recibe</p>
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
                  <button type="button" className="responsiva-firma-limpiar" onClick={firma2.limpiar}>
                    ✕
                  </button>
                </div>
                <p className="responsiva-firma-label">Firma Encargado Nodus</p>
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
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{respFecha}</span>
                    </div>
                    <div className="responsiva-meta-field">
                      <label>Centro</label>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{respCentro}</span>
                    </div>
                  </div>
                </div>

                <h1 className="responsiva-title">
                  {tipoResponsiva === "entrega" ? "Carta responsiva de equipo" : "Carta de devolución de equipo"}
                </h1>

                <p className="responsiva-section-title">
                  {tipoResponsiva === "entrega" ? "Entregado por (encargado de Nodus)" : "Recibido por (encargado de Nodus)"}
                </p>
                <div className="responsiva-sala-input">{entregadoPor}</div>

                <p className="responsiva-parrafo">
                  {tipoResponsiva === "entrega" ? (
                    <>
                      Por medio de la presente, yo, <span className="responsiva-inline-input">{respAsignadoA}</span>, hago
                      constar que he recibido en calidad de uso el siguiente equipo:
                    </>
                  ) : (
                    <>
                      Por medio de la presente, yo, <span className="responsiva-inline-input">{respAsignadoA}</span>, hago
                      constar que devuelvo a Nodus Flex Center el siguiente equipo:
                    </>
                  )}
                </p>

                <p className="responsiva-section-title">Equipo</p>
                <div className="responsiva-equipo-grid">
                  <div>
                    <div className="responsiva-check-row">
                      <span>Tipo</span>
                      <span>{respTipoEquipo}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>Marca / modelo</span>
                      <span>{respMarcaModelo}</span>
                    </div>
                    <div className="responsiva-check-row">
                      <span>Número de serie</span>
                      <span>{respNumeroSerie}</span>
                    </div>
                  </div>
                </div>

                {tipoResponsiva === "devolucion" && (
                  <>
                    <p className="responsiva-section-title">Condición en la que se recibe el equipo</p>
                    <div className="responsiva-condiciones-grid">
                      {(
                        [
                          ["funciona", "Funciona correctamente"],
                          ["sinDanos", "Sin daños visibles"],
                          ["accesoriosCompletos", "Cargador/accesorios completos"],
                          ["pantallaBuenEstado", "Pantalla en buen estado"],
                        ] as [keyof typeof condicionesDevolucion, string][]
                      ).map(([key, label]) => (
                        <span key={key}>
                          {condicionesDevolucion[key] ? "☑" : "☐"} {label}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                <div className="responsiva-legal-box">
                  {tipoResponsiva === "entrega"
                    ? "Me comprometo a hacer buen uso del equipo mencionado, así como a devolverlo en las mismas condiciones en las que me fue entregado. Acepto que soy responsable de cualquier daño o pérdida, y en caso de presentarse, me comprometo a cubrir el costo correspondiente."
                    : "Se hace constar que el equipo descrito fue devuelto a Nodus Flex Center en la fecha señalada, en las condiciones indicadas arriba. A partir de este momento, Nodus Flex Center recibe el equipo de conformidad y libera de responsabilidad a quien lo tenía asignado."}
                </div>

                <p className="responsiva-section-title">Notas / observaciones</p>
                <div className="responsiva-notas" style={{ whiteSpace: "pre-wrap" }}>
                  {respNotas}
                </div>

                <div className="responsiva-firmas">
                  <div>
                    <div className="responsiva-firma-box">
                      {firmaImg1 && (
                        <img src={firmaImg1} alt="Firma quien recibe" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      )}
                    </div>
                    <p className="responsiva-firma-label">Firma quien recibe</p>
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

            {errorResp && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{errorResp}</p>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="reservar-btn" style={{ flex: 1, minWidth: 200 }} onClick={guardarYGenerarPDF} disabled={guardandoResp}>
                {guardandoResp ? "Generando..." : "💾 Guardar y descargar PDF"}
              </button>
              <button
                className="btn-exportar"
                style={{ flex: 1, minWidth: 160 }}
                onClick={imprimirFormato}
                disabled={guardandoResp}
              >
                🖨️ Imprimir para firmar a mano
              </button>
            </div>

            <p className="panel-section-label" style={{ marginTop: 20 }}>
              ¿Ya lo firmaron en papel? Sube el documento escaneado
            </p>
            <label
              style={{
                display: "block",
                border: "1px dashed #ccc",
                borderRadius: 10,
                padding: "14px",
                textAlign: "center",
                fontSize: 13,
                color: "#666",
                cursor: "pointer",
              }}
            >
              📤 {guardandoResp ? "Subiendo..." : "Elegir archivo (PDF, JPG o PNG)"}
              <input
                type="file"
                accept="application/pdf,image/*"
                style={{ display: "none" }}
                disabled={guardandoResp}
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) subirDocumentoEscaneado(archivo);
                  e.target.value = "";
                }}
              />
            </label>
    </>
  );

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Equipos Asignados</p>
        <p className="rep-sub">Quién tiene qué equipo, en todos los centros</p>
      </div>

      <div className="centro-tabs">
        <button className={"centro-tab" + (tab === "equipos" ? " active" : "")} onClick={() => setTab("equipos")}>
          💻 Equipos
        </button>
        <button
          className={"centro-tab" + (tab === "nueva" ? " active" : "")}
          onClick={() => {
            setExitoResp(false);
            setTab("nueva");
          }}
        >
          📝 Nueva responsiva
        </button>
        <button className={"centro-tab" + (tab === "responsivas" ? " active" : "")} onClick={() => setTab("responsivas")}>
          📁 Responsivas ({responsivas.length})
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
        ) : tab === "equipos" ? (
          <>
            <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
              Para asignar un equipo nuevo, ve a la pestaña <b>📝 Nueva responsiva</b> — ahí se registra el equipo
              y se genera su responsiva de entrega al mismo tiempo.
            </p>

            <input
              type="text"
              placeholder="Buscar por persona, equipo, serie o centro..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{
                width: "100%",
                border: "1px solid #eee",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                marginBottom: 10,
              }}
            />

            <div className="tickets-filtros">
              <button className={"filtro-chip" + (filtroEstado === "todos" ? " active" : "")} onClick={() => setFiltroEstado("todos")}>
                Todos ({equipos.length})
              </button>
              <button
                className={"filtro-chip" + (filtroEstado === "asignado" ? " active" : "")}
                onClick={() => setFiltroEstado("asignado")}
              >
                📦 Asignados ({conteo.asignado})
              </button>
              <button
                className={"filtro-chip" + (filtroEstado === "devuelto" ? " active" : "")}
                onClick={() => setFiltroEstado("devuelto")}
              >
                ↩️ Devueltos ({conteo.devuelto})
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Equipos ({equiposFiltrados.length})
              </p>
              <button
                className="btn-exportar"
                onClick={() =>
                  exportarExcel(
                    "equipos-asignados",
                    equiposFiltrados.map((e) => ({
                      "Asignado a": e.asignado_a,
                      Puesto: e.puesto || "",
                      Tipo: e.tipo_equipo,
                      "Marca/Modelo": e.marca_modelo || "",
                      "Número de serie": e.numero_serie || "",
                      Centro: e.centro || "",
                      "Fecha de asignación": e.fecha_asignacion,
                      Estado: ESTADOS[e.estado]?.label || e.estado,
                      Notas: e.notas || "",
                    }))
                  )
                }
              >
                📥 Excel
              </button>
            </div>

            {equiposFiltrados.length === 0 ? (
              <div className="empty-card">Sin equipos que coincidan</div>
            ) : (
              equiposFiltrados.map((e) => (
                <div className="item-card" key={e.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">
                      👤 {e.asignado_a} {e.puesto ? `· ${e.puesto}` : ""}
                    </p>
                    <p className="item-card-sub">
                      {e.tipo_equipo}
                      {e.marca_modelo ? ` · ${e.marca_modelo}` : ""}
                      {e.numero_serie ? ` · N/S: ${e.numero_serie}` : ""}
                    </p>
                    <p className="item-card-extra">
                      🏢 {e.centro || "—"} · Asignado el {new Date(e.fecha_asignacion + "T00:00:00").toLocaleDateString("es-MX")}
                    </p>
                    {e.notas && <p className="item-card-extra">{e.notas}</p>}
                    {e.responsiva_url ? (
                      <a href={e.responsiva_url} target="_blank" className="ver-pdf-btn" style={{ marginTop: 6, display: "inline-block" }}>
                        📄 Ver responsiva
                      </a>
                    ) : (
                      <button
                        className="tel-borrar-btn"
                        style={{ color: "#0d1b3e", marginTop: 6 }}
                        onClick={() => irAGenerarResponsiva(e, "entrega")}
                      >
                        📝 Generar responsiva de entrega
                      </button>
                    )}
                    <button
                      className="tel-borrar-btn"
                      style={{ color: "#185FA5", marginTop: 6, marginLeft: 8 }}
                      onClick={() => abrirModalDevolucion(e)}
                    >
                      ↩️ Generar devolución
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <select
                      className="ticket-admin-select"
                      value={e.estado}
                      onChange={(ev) => cambiarEstado(e.id, ev.target.value)}
                      style={{ background: ESTADOS[e.estado]?.bg }}
                    >
                      <option value="asignado">📦 Asignado</option>
                      <option value="devuelto">↩️ Devuelto</option>
                    </select>
                    <button className="tel-borrar-btn" onClick={() => borrarEquipo(e.id)}>
                      🗑 Borrar
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        ) : tab === "responsivas" ? (
          <>
            <div className="tickets-filtros">
              <button
                className={"filtro-chip" + (filtroTipoResponsiva === "todas" ? " active" : "")}
                onClick={() => setFiltroTipoResponsiva("todas")}
              >
                Todas ({responsivas.length})
              </button>
              <button
                className={"filtro-chip" + (filtroTipoResponsiva === "entrega" ? " active" : "")}
                onClick={() => setFiltroTipoResponsiva("entrega")}
              >
                📝 Entregas ({responsivas.filter((r) => r.tipo === "entrega").length})
              </button>
              <button
                className={"filtro-chip" + (filtroTipoResponsiva === "devolucion" ? " active" : "")}
                onClick={() => setFiltroTipoResponsiva("devolucion")}
              >
                ↩️ Devoluciones ({responsivas.filter((r) => r.tipo === "devolucion").length})
              </button>
            </div>

            {(() => {
              const listaFiltrada = responsivas.filter(
                (r) => filtroTipoResponsiva === "todas" || r.tipo === filtroTipoResponsiva
              );
              if (listaFiltrada.length === 0) {
                return <div className="empty-card">Sin responsivas en esta categoría</div>;
              }
              return listaFiltrada.map((r) => (
                <div className="item-card" key={r.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">
                      {r.tipo === "devolucion" ? "↩️" : "📝"} {r.asignado_a}
                      {r.origen === "escaneada" && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "#FEF6D8",
                            color: "#8A6D00",
                          }}
                        >
                          📎 Escaneada
                        </span>
                      )}
                    </p>
                    <p className="item-card-sub">
                      {r.tipo_equipo}
                      {r.marca_modelo ? ` · ${r.marca_modelo}` : ""} · {r.fecha}
                    </p>
                    <p className="item-card-extra">
                      🏢 {r.centro || "—"}
                      {r.entregado_por ? ` · ${r.tipo === "devolucion" ? "Recibió" : "Entregó"}: ${r.entregado_por}` : ""}
                    </p>
                  </div>
                  {r.archivo_url ? (
                    <a
                      className="ver-pdf-btn"
                      href={r.archivo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ver o descargar el documento"
                    >
                      📥 Ver / descargar
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: "#aaa" }}>Sin PDF</span>
                  )}
                </div>
              ));
            })()}
          </>
        ) : (
          formularioResponsiva
        )}
      </div>

      {/* Modal de devolución rápida, fuera del <div className="rep-content">
         pero dentro del contenedor raíz del componente */}
      {modalDevolucionAbierto && (
        <div className="modal-overlay" onClick={cerrarModalDevolucion}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div style={{ flex: 1 }}>
                <p className="modal-nombre">↩️ Generar devolución</p>
                <p className="modal-email">
                  {respAsignadoA} · {respTipoEquipo}
                </p>
              </div>
              <button className="modal-cerrar" onClick={cerrarModalDevolucion} disabled={guardandoResp}>
                ✕
              </button>
            </div>
            {formularioResponsiva}
          </div>
        </div>
      )}
    </div>
  );
}
