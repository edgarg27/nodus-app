"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchBannersPromocionales, type BannerDestacado } from "@/app/components/CarruselBanners";
import type { DatosDireccion } from "./datosDireccion";
import SeccionCartera from "./direccion/SeccionCartera";
import SeccionFinanzas from "./direccion/SeccionFinanzas";
import SeccionOcupacion from "./direccion/SeccionOcupacion";
import SeccionResumen, { type Seccion } from "./direccion/SeccionResumen";
import SeccionVentas from "./direccion/SeccionVentas";
import { etiquetaMes, ultimosMeses } from "./direccion/util";

// Panel de Dirección (roles "ceo" y "captive"): solo consulta, todos los centros. Los datos
// los arma datosDireccion.ts en el servidor; cada sección (direccion/*) los
// agrupa por centro y por mes.

const SECCIONES: { clave: Seccion; label: string }[] = [
  { clave: "resumen", label: "📊 Resumen" },
  { clave: "ocupacion", label: "🏢 Espacios y contratos" },
  { clave: "finanzas", label: "💰 Ingresos y gastos" },
  { clave: "cartera", label: "💳 Cuentas por cobrar" },
  { clave: "ventas", label: "🎯 Prospectos y ventas" },
];

export default function PanelDireccion({
  datos,
  nombre,
  rolLabel,
  mostrarPrecios = false,
}: {
  datos: DatosDireccion;
  nombre: string;
  rolLabel: string;
  // Captive: precios de los espacios disponibles en "Espacios y contratos".
  mostrarPrecios?: boolean;
}) {
  const router = useRouter();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [seccion, setSeccion] = useState<Seccion>("resumen");
  const [centro, setCentro] = useState("todos");
  const mesActual = datos.hoy.slice(0, 7);
  const [mes, setMes] = useState(mesActual);
  const meses = ultimosMeses(mesActual, 12).reverse();

  // Mismos banners que ve el resto del personal (AdminPanel.tsx): los
  // promocionales de Diseño y los logros publicados. Solo van en Resumen.
  const [banners, setBanners] = useState<BannerDestacado[]>([]);
  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      fetchBannersPromocionales(supabase),
      supabase
        .from("logros")
        .select("banner_url, titulo, empresa")
        .eq("estado", "publicado")
        .not("banner_url", "is", null)
        .order("updated_at", { ascending: false }),
    ]).then(([promo, { data: logros }]) => {
      setBanners([
        ...promo,
        ...(logros || [])
          .filter((l) => l.banner_url)
          .map((l) => ({ src: l.banner_url as string, alt: `Logro de ${l.empresa || "un cliente"}: ${l.titulo}` })),
      ]);
    });
  }, []);

  const nombresCentros = Array.from(
    new Set(
      [
        ...datos.centros.map((c) => c.centro),
        ...datos.pagos.map((p) => p.centro),
        ...datos.clientes.map((c) => c.centro),
        ...datos.prospectos.map((p) => p.centro),
      ].filter((c): c is string => !!c)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  async function cerrarSesion() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function ir(s: Seccion) {
    setSeccion(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-header-title">
            {nombre.trim() ? `Bienvenido, ${nombre.trim().split(/\s+/)[0]}` : "Bienvenido"}
          </p>
          <p className="panel-header-sub">
            Nodus Flex Center · {centro === "todos" ? "Todos los centros" : centro}
          </p>
        </div>
        <div style={{ position: "relative" }}>
          <button className="panel-avatar" onClick={() => setMenuAbierto((v) => !v)} title="Opciones de cuenta">
            {(nombre.trim()[0] || "?").toUpperCase()}
          </button>
          {menuAbierto && (
            <>
              <div className="menu-overlay-click" onClick={() => setMenuAbierto(false)} />
              <div className="avatar-dropdown">
                <p className="avatar-dropdown-nombre">{nombre}</p>
                <p className="avatar-dropdown-rol">{rolLabel}</p>
                <button className="avatar-dropdown-item" onClick={cerrarSesion}>
                  🚪 Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="dir-tabs-envoltura">
        <div className="dir-tabs" role="tablist">
          {SECCIONES.map((s) => (
            <button
              key={s.clave}
              type="button"
              role="tab"
              aria-selected={seccion === s.clave}
              className={`dir-tab${seccion === s.clave ? " dir-tab-on" : ""}`}
              onClick={() => setSeccion(s.clave)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dir-contenido">
        <div className="dir-barra">
          <p className="dir-seccion-titulo">{SECCIONES.find((s) => s.clave === seccion)?.label}</p>
          <div className="dir-filtros">
            {seccion !== "ocupacion" && (
              <select className="dir-filtro" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {etiquetaMes(m)}
                    {m === mesActual ? " (en curso)" : ""}
                  </option>
                ))}
              </select>
            )}
            <select className="dir-filtro" value={centro} onChange={(e) => setCentro(e.target.value)} aria-label="Centro">
              <option value="todos">Todos los centros</option>
              {nombresCentros.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {seccion === "resumen" && <SeccionResumen datos={datos} centro={centro} mes={mes} onIr={ir} banners={banners} />}
        {seccion === "ocupacion" && <SeccionOcupacion datos={datos} centro={centro} mostrarPrecios={mostrarPrecios} />}
        {seccion === "finanzas" && <SeccionFinanzas datos={datos} centro={centro} mes={mes} />}
        {seccion === "cartera" && <SeccionCartera datos={datos} centro={centro} mes={mes} />}
        {seccion === "ventas" && <SeccionVentas datos={datos} centro={centro} mes={mes} />}
      </div>
    </div>
  );
}
