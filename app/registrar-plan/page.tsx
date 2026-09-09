"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CotizarForm from "@/app/centro/CotizarForm";

const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

function RegistrarPlanInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const clienteIdPreseleccionado = searchParams.get("clienteId") || undefined;
  const centroDesdeUrl = searchParams.get("centro") || "";
  // Handoff desde /mapa-oficinas tras verificar disponibilidad — precarga
  // el tipo de espacio, oficina, paquete y fecha ya elegidos allá.
  const tipoEspacioDesdeUrl = searchParams.get("tipoEspacio") || undefined;
  const oficinaIdDesdeUrl = searchParams.get("oficinaId") || undefined;
  const paqueteIdDesdeUrl = searchParams.get("paqueteId") || undefined;
  const fechaInicioDesdeUrl = searchParams.get("fechaInicio") || undefined;
  const modalidadDesdeUrl = searchParams.get("modalidad") || undefined;
  const cantidadDesdeUrl = searchParams.get("cantidad") || undefined;
  // Handoff desde la pestaña Prospectos de Centro (botón "🧾 Cotizar" en
  // cada tarjeta) — sin cliente todavía, solo precarga el contexto del lead.
  const prospectoNombreDesdeUrl = searchParams.get("prospectoNombre") || undefined;
  const prospectoTelefonoDesdeUrl = searchParams.get("prospectoTelefono") || undefined;
  const prospectoEmailDesdeUrl = searchParams.get("prospectoEmail") || undefined;
  const prospectoInteresDesdeUrl = searchParams.get("prospectoInteres") || undefined;

  const [loading, setLoading] = useState(true);
  const [centro, setCentro] = useState<string | null>(null);
  const [centrosDisponibles, setCentrosDisponibles] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const esGlobal = centrosDisponibles.length > 1;

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const rol = profile?.rol || "";
    if (ROLES_GLOBALES.includes(rol)) {
      setCentrosDisponibles(CENTROS_SUGERIDOS);
      setCentro(centroDesdeUrl || profile?.centro || CENTROS_SUGERIDOS[0]);
    } else {
      setCentro(profile?.centro || null);
    }
    setLoading(false);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Cotizar</p>
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
        {!centro ? (
          <div className="empty-card">Tu cuenta no tiene un centro asignado</div>
        ) : loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : (
          <CotizarForm
            key={refreshKey}
            centro={centro}
            clientePreseleccionadoId={clienteIdPreseleccionado}
            onRegistrado={() => setRefreshKey((k) => k + 1)}
            tipoEspacioPreseleccionado={tipoEspacioDesdeUrl}
            oficinaPreseleccionadaId={oficinaIdDesdeUrl}
            paquetePreseleccionadoId={paqueteIdDesdeUrl}
            fechaInicioPreseleccionada={fechaInicioDesdeUrl}
            modalidadPreseleccionada={modalidadDesdeUrl}
            cantidadPreseleccionada={cantidadDesdeUrl}
            prospectoNombrePreseleccionado={prospectoNombreDesdeUrl}
            prospectoTelefonoPreseleccionado={prospectoTelefonoDesdeUrl}
            prospectoEmailPreseleccionado={prospectoEmailDesdeUrl}
            prospectoInteresPreseleccionado={prospectoInteresDesdeUrl}
          />
        )}
      </div>
    </div>
  );
}

export default function RegistrarPlanPage() {
  return (
    <Suspense fallback={null}>
      <RegistrarPlanInner />
    </Suspense>
  );
}
