"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";
import { MENSAJE_VENTAS_DEFAULT } from "@/lib/contratoPasos";
import { labelRol } from "@/lib/roles";

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
  mensaje_ventas: string | null;
  archivo_firmado_url: string | null;
  archivo_firmado_at: string | null;
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

// Panel del rol Ventas: los contratos que la administradora ya mandó a firma
// (paso 3 del flujo por pasos, ver app/contratos/PasosContrato.tsx). Ventas
// baja la última versión, la sube a Cincel y deja un mensaje para la
// administradora; cuando llega el contrato firmado, aquí también aparece.
export default function PanelVentas({ nombre, rol, centro }: { nombre: string; rol: string; centro: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [contratos, setContratos] = useState<ContratoVentas[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [ultimaVersion, setUltimaVersion] = useState<Record<string, string>>({});
  const [mensajes, setMensajes] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    const columnas =
      "id, centro, user_id, cliente_nombre_historico, cliente_email_historico, cliente_empresa_historico, renta_mensual, archivo_url, archivo_machote_url, enviado_a_ventas_at, enviado_a_firma_at, mensaje_ventas, archivo_firmado_url, archivo_firmado_at";
    const [{ data: porFirmar }, { data: firmados }] = await Promise.all([
      supabase
        .from("contratos")
        .select(columnas)
        .eq("estatus", "pre_aprobado")
        .not("enviado_a_ventas_at", "is", null)
        .is("archivo_firmado_url", null)
        .order("enviado_a_ventas_at", { ascending: false }),
      supabase
        .from("contratos")
        .select(columnas)
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
        .select("contrato_id, archivo_url, created_at")
        .in(
          "contrato_id",
          lista.map((c) => c.id)
        )
        .order("created_at", { ascending: false });
      const mapa: Record<string, string> = {};
      (versiones || []).forEach((v) => {
        if (!mapa[v.contrato_id]) mapa[v.contrato_id] = v.archivo_url;
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

  async function marcarEnCincel(c: ContratoVentas) {
    setOcupado(c.id);
    setError("");
    const mensaje = (mensajes[c.id] ?? MENSAJE_VENTAS_DEFAULT).trim() || MENSAJE_VENTAS_DEFAULT;
    const { error: updErr } = await supabase
      .from("contratos")
      .update({ enviado_a_firma_at: new Date().toISOString(), mensaje_ventas: mensaje })
      .eq("id", c.id);
    setOcupado(null);
    if (updErr) {
      setError("No se pudo guardar: " + updErr.message);
      return;
    }
    cargar();
  }

  async function deshacer(c: ContratoVentas) {
    setOcupado(c.id);
    setError("");
    const { error: updErr } = await supabase
      .from("contratos")
      .update({ enviado_a_firma_at: null, mensaje_ventas: null })
      .eq("id", c.id);
    setOcupado(null);
    if (updErr) {
      setError("No se pudo deshacer: " + updErr.message);
      return;
    }
    cargar();
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const porSubir = contratos.filter((c) => !c.archivo_firmado_url && !c.enviado_a_firma_at);
  const enCincel = contratos.filter((c) => !c.archivo_firmado_url && c.enviado_a_firma_at);
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
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-header-title">Panel de Ventas</p>
          <p className="panel-header-sub">Nodus Flex Center</p>
        </div>
        <div style={{ position: "relative" }}>
          <button className="panel-avatar" onClick={() => setMenuAbierto((v) => !v)} title="Opciones de cuenta">
            {nombre.charAt(0).toUpperCase()}
          </button>
          {menuAbierto && (
            <>
              <div className="menu-overlay-click" onClick={() => setMenuAbierto(false)} />
              <div className="avatar-dropdown">
                <p className="avatar-dropdown-nombre">{nombre}</p>
                <p className="avatar-dropdown-rol">
                  {labelRol(rol)}
                  {centro ? ` · ${centro}` : ""}
                </p>
                <button className="avatar-dropdown-item" onClick={cerrarSesion}>
                  🚪 Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel-content">
        <p className="panel-section-label">Herramientas de venta</p>
        <div className="modulos-grid">
          <a className="modulo-card" href="/prospectos">
            <span className="modulo-icon">🎯</span>
            <span className="modulo-name">Prospectos</span>
          </a>
          <a className="modulo-card" href="/registrar-plan">
            <span className="modulo-icon">📝</span>
            <span className="modulo-name">Cotizar</span>
          </a>
          <a className="modulo-card" href="/cotizaciones">
            <span className="modulo-icon">🧾</span>
            <span className="modulo-name">Cotizaciones</span>
          </a>
        </div>

        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}

        <p className="panel-section-label">✍ Contratos por subir a Cincel ({porSubir.length})</p>
        {cargando ? (
          <div className="empty-card">Cargando…</div>
        ) : porSubir.length === 0 ? (
          <div className="empty-card">No hay contratos esperando: cuando la administradora suba uno a firma, aparece aquí.</div>
        ) : (
          porSubir.map((c) => {
            const archivo = ultimaVersion[c.id] || c.archivo_machote_url || c.archivo_url;
            return tarjeta(
              c,
              <>
                <p className="contrato-detalle">Enviado por la administradora el {fecha(c.enviado_a_ventas_at!)}</p>
                {archivo && (
                  <button type="button" className="ver-pdf-btn" onClick={() => abrir(archivo)} disabled={abriendo === archivo}>
                    {abriendo === archivo ? "Abriendo…" : "📥 Descargar la última versión"}
                  </button>
                )}
                <p className="sub-label" style={{ marginTop: 10 }}>
                  Mensaje para la administradora
                </p>
                <textarea
                  value={mensajes[c.id] ?? MENSAJE_VENTAS_DEFAULT}
                  onChange={(e) => setMensajes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  rows={3}
                  style={{ width: "100%", border: "1px solid #eee", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-aceptar" onClick={() => marcarEnCincel(c)} disabled={ocupado === c.id}>
                    {ocupado === c.id ? "Guardando…" : "📨 Ya lo subí a Cincel"}
                  </button>
                </div>
              </>
            );
          })
        )}

        {enCincel.length > 0 && (
          <>
            <p className="panel-section-label">📨 En Cincel · esperando firmas ({enCincel.length})</p>
            {enCincel.map((c) =>
              tarjeta(
                c,
                <>
                  <p className="contrato-detalle">Subido a Cincel el {fecha(c.enviado_a_firma_at!)}</p>
                  {c.mensaje_ventas && <p className="paso-mensaje">💬 {c.mensaje_ventas}</p>}
                  <p className="contrato-detalle">
                    Cuando llegue al correo de la administradora el contrato firmado, lo sube ella y aparece abajo.
                  </p>
                  <div style={{ marginTop: 6 }}>
                    <button className="tel-borrar-btn" onClick={() => deshacer(c)} disabled={ocupado === c.id}>
                      ↩ Deshacer (no lo había subido)
                    </button>
                  </div>
                </>
              )
            )}
          </>
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
      </div>
    </div>
  );
}
