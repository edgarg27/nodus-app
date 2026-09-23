"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ImagenPrivada from "@/app/components/ImagenPrivada";
import FileDropzone from "../soporte/FileDropzone";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

type Paquete = {
  id: string;
  centro: string;
  cliente_id: string;
  cliente_nombre: string | null;
  empresa: string | null;
  descripcion: string | null;
  foto_url: string | null;
  estado: string; // "en_espera" | "entregado"
  fecha_llegada: string;
  fecha_entrega: string | null;
  registrado_por: string | null;
};

type ClienteOpcion = { id: string; nombre: string; empresa: string | null };

const ESTADO_INFO: Record<string, { label: string; bg: string }> = {
  en_espera: { bg: "#FAEEDA", label: "📦 En espera" },
  entregado: { bg: "#E1F5EE", label: "✓ Entregado" },
};

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaqueteriaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rol, setRol] = useState("");
  const [centro, setCentro] = useState<string | null>(null);
  const [nombre, setNombre] = useState("Cliente");
  const [userId, setUserId] = useState("");

  const esStaff = rol !== "" && rol !== "cliente";
  const rutaRegresar = esStaff ? "/dashboard" : "/dashboard-cliente";

  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [cargandoPaquetes, setCargandoPaquetes] = useState(true);

  // Solo para staff: catálogo de clientes del centro para el selector, y
  // el formulario de registro de un paquete nuevo.
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [foto, setFoto] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [tab, setTab] = useState<"en_espera" | "entregado">("en_espera");

  const [lightbox, setLightbox] = useState<string | null>(null);

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
    setUserId(user.id);
    const { data: profile } = await supabase
      .from("profiles")
      .select("rol, centro, nombre, empresa")
      .eq("id", user.id)
      .single();
    const rolActual = profile?.rol || "";
    setRol(rolActual);
    setNombre(profile?.nombre || "Cliente");
    setCentro(profile?.centro || null);

    if (rolActual !== "cliente") {
      // Staff: carga clientes del/los centro(s) para poder registrar paquetes
      const centros = ROLES_GLOBALES.includes(rolActual)
        ? ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"]
        : profile?.centro
        ? [profile.centro]
        : [];
      if (centros.length > 0) {
        const { data: listaClientes } = await supabase
          .from("profiles")
          .select("id, nombre, empresa")
          .eq("rol", "cliente")
          .in("centro", centros);
        setClientes((listaClientes || []).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "")));
      }
      await cargarPaquetesStaff(rolActual, profile?.centro || null);
    } else {
      await cargarPaquetesCliente(user.id);
    }
    setLoading(false);
  }

  async function cargarPaquetesStaff(rolActual: string, centroActual: string | null) {
    setCargandoPaquetes(true);
    let query = supabase.from("paqueteria").select("*").order("fecha_llegada", { ascending: false });
    if (!ROLES_GLOBALES.includes(rolActual) && centroActual) query = query.eq("centro", centroActual);
    const { data } = await query;
    setPaquetes(data || []);
    setCargandoPaquetes(false);
  }

  async function cargarPaquetesCliente(uid: string) {
    setCargandoPaquetes(true);
    const { data } = await supabase
      .from("paqueteria")
      .select("*")
      .eq("cliente_id", uid)
      .order("fecha_llegada", { ascending: false });
    setPaquetes(data || []);
    setCargandoPaquetes(false);
  }

  async function registrarPaquete(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clienteId) {
      setError("Selecciona el cliente al que le llegó el paquete");
      return;
    }
    setGuardando(true);

    const clienteSel = clientes.find((c) => c.id === clienteId);
    let fotoUrl: string | null = null;
    if (foto[0]) {
      const archivo = foto[0];
      const fileName = `paquete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
        archivo.name.split(".").pop() || "jpg"
      }`;
      const { error: uploadError } = await supabase.storage
        .from("tickets")
        .upload(fileName, archivo, { contentType: archivo.type, upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("tickets").getPublicUrl(fileName);
        fotoUrl = urlData.publicUrl;
      }
    }

    const { error: insertError } = await supabase.from("paqueteria").insert({
      centro,
      cliente_id: clienteId,
      cliente_nombre: clienteSel?.nombre || null,
      empresa: clienteSel?.empresa || null,
      descripcion: descripcion.trim() || null,
      foto_url: fotoUrl,
      estado: "en_espera",
      registrado_por: nombre,
    });

    if (insertError) {
      setError("No se pudo registrar el paquete. Intenta de nuevo.");
      setGuardando(false);
      return;
    }

    await supabase.from("notificaciones").insert({
      centro,
      user_id: clienteId,
      tipo: "nuevo_paquete",
      mensaje: `📦 Te llegó un paquete${clienteSel?.empresa ? ` (${clienteSel.empresa})` : ""}. Pasa a recogerlo cuando puedas.`,
    });

    setClienteId("");
    setDescripcion("");
    setFoto([]);
    setGuardando(false);
    setEnviado(true);
    setTimeout(() => setEnviado(false), 1800);
    cargarPaquetesStaff(rol, centro);
  }

  async function marcarEntregado(id: string) {
    await supabase
      .from("paqueteria")
      .update({ estado: "entregado", fecha_entrega: new Date().toISOString() })
      .eq("id", id);
    setPaquetes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado: "entregado", fecha_entrega: new Date().toISOString() } : p))
    );
  }

  const enEspera = paquetes.filter((p) => p.estado === "en_espera");
  const entregados = paquetes.filter((p) => p.estado === "entregado");
  const listaMostrada = esStaff ? (tab === "en_espera" ? enEspera : entregados) : paquetes;

  if (loading) {
    return (
      <div className="panel">
        <div className="rep-header">
          <a className="rep-back" href="/dashboard">
            ← Regresar
          </a>
          <p className="rep-title">Paquetería y Mensajería</p>
          <p className="rep-sub">Cargando...</p>
        </div>
        <div className="sub-content">
          <div className="nodus-inline-loading" style={{ marginTop: 20 }}>
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href={rutaRegresar}>
          ← Regresar
        </a>
        <p className="rep-title">Paquetería y Mensajería</p>
        <p className="rep-sub">{esStaff ? centro || nombre : nombre}</p>
      </div>

      <div className="sub-content">
        {esStaff && (
          <>
            <p className="panel-section-label">Registrar paquete</p>
            <form className="form-card" onSubmit={registrarPaquete}>
              <p className="sub-label">Cliente</p>
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="" hidden>
                  Selecciona el cliente
                </option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.empresa ? ` (${c.empresa})` : ""}
                  </option>
                ))}
              </select>

              <p className="sub-label" style={{ marginTop: 8 }}>
                Descripción (opcional)
              </p>
              <textarea
                placeholder="Ej. Caja mediana de Amazon, sobre de mensajería..."
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />

              <p className="sub-label" style={{ marginTop: 8 }}>
                Foto del paquete (opcional)
              </p>
              <FileDropzone files={foto} onChange={setFoto} maxFiles={1} accept="image/*" />

              {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

              <button
                className={"btn-enviar" + (guardando ? " sending" : "") + (enviado ? " sent" : "")}
                type="submit"
                disabled={guardando}
                style={{ marginTop: 10 }}
              >
                <span className="btn-enviar-text">{guardando ? "Registrando..." : "Registrar y avisar al cliente"}</span>
              </button>
            </form>

            <div className="centro-tabs" style={{ marginTop: 16 }}>
              <button
                type="button"
                className={"centro-tab" + (tab === "en_espera" ? " active" : "")}
                onClick={() => setTab("en_espera")}
              >
                📦 En espera ({enEspera.length})
              </button>
              <button
                type="button"
                className={"centro-tab" + (tab === "entregado" ? " active" : "")}
                onClick={() => setTab("entregado")}
              >
                ✓ Entregados ({entregados.length})
              </button>
            </div>
          </>
        )}

        <p className="panel-section-label" style={{ marginTop: esStaff ? 12 : 0 }}>
          {esStaff ? "" : "Mis paquetes"}
        </p>

        {cargandoPaquetes ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : listaMostrada.length === 0 ? (
          <div className="empty-card">
            <p style={{ fontSize: 40, margin: 0 }}>📦</p>
            <p style={{ fontWeight: 700, color: "#1a1a1a", margin: "8px 0 4px" }}>
              {esStaff ? "Sin paquetes en esta categoría" : "Aún no tienes paquetes"}
            </p>
          </div>
        ) : (
          listaMostrada.map((p) => (
            <div className="reserva-admin-card" key={p.id}>
              <div className="reserva-admin-top">
                <div>
                  <p className="reserva-admin-cliente">{esStaff ? p.cliente_nombre || "Cliente" : "Paquete"}</p>
                  <p className="reserva-admin-detalle">
                    {p.estado === "entregado" && p.fecha_entrega
                      ? `Entregado el ${formatearFecha(p.fecha_entrega)}`
                      : `Llegó el ${formatearFecha(p.fecha_llegada)}`}
                  </p>
                  {p.descripcion && <p className="reserva-admin-detalle">📝 {p.descripcion}</p>}
                  <span className="factura-badge" style={{ background: ESTADO_INFO[p.estado]?.bg, marginTop: 4 }}>
                    <span className="factura-badge-text">{ESTADO_INFO[p.estado]?.label || p.estado}</span>
                  </span>
                </div>
              </div>
              {p.foto_url && (
                <ImagenPrivada
                  src={p.foto_url}
                  alt="Foto del paquete"
                  className="ticket-admin-foto-mini"
                  onClick={() => setLightbox(p.foto_url)}
                />
              )}
              {esStaff && p.estado === "en_espera" && (
                <div className="reserva-admin-acciones">
                  <button type="button" className="btn-aceptar" onClick={() => marcarEntregado(p.id)}>
                    ✓ Marcar como entregado
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <ImagenPrivada src={lightbox} className="lightbox-img" alt="Foto ampliada" />
        </div>
      )}
    </div>
  );
}
