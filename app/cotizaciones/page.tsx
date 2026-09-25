"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BotonArchivo from "@/app/components/BotonArchivo";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

type Cotizacion = {
  id: string;
  nombre: string;
  notas: string | null;
  archivo_url: string | null;
  created_at: string;
  estatus: string | null;
  cotizacion_comercial_id: string | null;
};

export default function CotizacionesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [centro, setCentro] = useState<string | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);

  const [aceptandoId, setAceptandoId] = useState<string | null>(null);
  const [aceptadoOkId, setAceptadoOkId] = useState<string | null>(null);
  const [confirmandoAceptarId, setConfirmandoAceptarId] = useState<string | null>(null);
  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

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
    const c = profile?.centro || null;
    setCentro(c);
    if (c) await fetchCotizaciones(c, profile?.rol || "");
    setLoading(false);
  }

  async function fetchCotizaciones(c: string, rol: string) {
    let query = supabase.from("cotizaciones").select("*").order("created_at", { ascending: false });
    if (!ROLES_GLOBALES.includes(rol)) query = query.eq("centro", c);
    const { data } = await query;
    setCotizaciones(data || []);
  }

  async function borrarCotizacion(id: string) {
    setConfirmandoBorrarId(null);
    await supabase.from("cotizaciones").delete().eq("id", id);
    if (centro) fetchCotizaciones(centro, "");
  }

  // Búsqueda por nombre (ahí vive el nombre del cliente/prospecto, ver
  // guardarCotizacion y las plantillas .pptx) o notas — mismo patrón que
  // /contratos.
  const cotizacionesFiltradas = cotizaciones.filter((c) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || (c.notas || "").toLowerCase().includes(q);
  });

  async function aceptarCotizacion(id: string) {
    setConfirmandoAceptarId(null);
    setAceptandoId(id);
    try {
      const res = await fetch("/api/cotizacion-aceptar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudo aceptar la cotización");
        return;
      }
      setAceptadoOkId(id);
      // Se deja ver un momento la palomita de "¡Listo!" antes de saltar a
      // Contratos, donde el contrato recién creado ya abre solo (ver
      // contratoIdDesdeUrl en app/contratos/page.tsx) — el staff no tiene
      // que volver a buscar al cliente.
      const contratoId = data.contrato?.id as string | undefined;
      setTimeout(() => {
        setAceptadoOkId(null);
        if (contratoId) {
          router.push(`/contratos?contratoId=${contratoId}&centro=${encodeURIComponent(centro || "")}`);
        }
      }, 900);
      if (centro) fetchCotizaciones(centro, "");
    } finally {
      setAceptandoId(null);
    }
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Cotizaciones</p>
        <p className="rep-sub">{centro || "Selecciona un centro"}</p>
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
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="panel-section-label" style={{ margin: 0 }}>
                Cotizaciones ({cotizacionesFiltradas.length})
              </p>
              <a
                href="/registrar-plan"
                className="tel-borrar-btn"
                style={{ color: "#0d1b3e", fontWeight: 600, textDecoration: "none" }}
              >
                + Crear Cotización
              </a>
            </div>

            <input
              placeholder="Buscar por nombre del cliente o notas..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px", width: "100%" }}
            />

            {cotizacionesFiltradas.length === 0 ? (
              <div className="empty-card">
                {busqueda ? "Sin cotizaciones que coincidan con la búsqueda" : "Sin cotizaciones registradas"}
              </div>
            ) : (
              cotizacionesFiltradas.map((c) => (
                <div className="cotizacion-card" key={c.id}>
                  <div>
                    <p className="item-card-titulo">{c.nombre}</p>
                    <p className="item-card-sub">
                      {new Date(c.created_at).toLocaleDateString("es-MX")}
                      {c.notas ? ` · ${c.notas}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {c.archivo_url && (
                      <BotonArchivo url={c.archivo_url} bucket="cotizaciones" descargar>
                        📥 Descargar
                      </BotonArchivo>
                    )}
                    <button
                      className={
                        "btn-enviar" +
                        (aceptandoId === c.id ? " sending" : "") +
                        (aceptadoOkId === c.id ? " sent" : "")
                      }
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      disabled={c.estatus === "aceptada" || !c.cotizacion_comercial_id || aceptandoId === c.id}
                      title={!c.cotizacion_comercial_id ? "Esta cotización todavía no está ligada a una venta" : undefined}
                      onClick={() => setConfirmandoAceptarId(c.id)}
                    >
                      <span className="btn-enviar-icon-wrapper">
                        <svg
                          className="btn-enviar-icon"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path fill="none" d="M0 0h24v24H0z"></path>
                          <path
                            fill="currentColor"
                            d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"
                          ></path>
                        </svg>
                      </span>
                      <span className="btn-enviar-check-wrapper">
                        <svg
                          className="btn-enviar-check"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>¡Listo!</span>
                      </span>
                      <span className="btn-enviar-text">{c.estatus === "aceptada" ? "✓ Aceptada" : "✓ Aceptar"}</span>
                    </button>
                    <button className="tel-borrar-btn" onClick={() => setConfirmandoBorrarId(c.id)}>
                      🗑
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {confirmandoAceptarId && (
        <div className="modal-overlay" onClick={() => setConfirmandoAceptarId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Aceptar cotización</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              {cotizaciones.find((c) => c.id === confirmandoAceptarId)?.nombre.includes("Sala de Juntas")
                ? "¿Aceptar esta cotización de Sala de Juntas? Se reserva el horario en el calendario; las salas no generan contrato."
                : "¿Aceptar esta cotización y generar el contrato como pre-aprobado?"}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoAceptarId(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => aceptarCotizacion(confirmandoAceptarId)}>
                ✓ Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoBorrarId && (
        <div className="modal-overlay" onClick={() => setConfirmandoBorrarId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">Borrar cotización</p>
            <p className="sub-label" style={{ marginTop: 8 }}>
              ¿Borrar esta cotización? Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tel-borrar-btn" onClick={() => setConfirmandoBorrarId(null)}>
                Cancelar
              </button>
              <button className="btn-aceptar" onClick={() => borrarCotizacion(confirmandoBorrarId)}>
                🗑 Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
