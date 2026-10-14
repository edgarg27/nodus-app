"use client";

import { useCatalogoServicios } from "@/app/components/useCatalogoServicios";

const MODULOS = [
  {
    href: "/facturas-admin/integrar-cliente",
    titulo: "Integrar por cliente",
    texto: "Elige al cliente, marca sus pagos y deja integrada o timbra una factura.",
  },
  {
    href: "/facturas-admin/integrar-lote",
    titulo: "Integrar por lote",
    texto: "Los cobros del mes de un centro, por tipo de servicio, para timbrarlos todos juntos.",
  },
  {
    href: "/facturas-admin/estados-de-cuenta",
    titulo: "Estados de cuenta",
    texto: "Lo integrado que todavía falta por timbrar: facturar, ver pagos y vincular.",
  },
  {
    href: "/facturas-admin/timbradas",
    titulo: "Facturas timbradas",
    texto: "Los CFDI emitidos y sus complementos de pago: PDF, XML, cancelación y saldos.",
  },
];

export default function FacturacionPage() {
  const { puedeEditar } = useCatalogoServicios();
  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Facturación</p>
        <p className="rep-sub">Elige qué quieres hacer</p>
      </div>

      <div className="rep-content rep-content-completo">
        <div className="fac-menu">
          {MODULOS.map((m) => (
            <a key={m.href} className="fac-menu-card" href={m.href}>
              <span className="fac-menu-titulo">{m.titulo}</span>
              <span className="fac-menu-texto">{m.texto}</span>
            </a>
          ))}
        </div>

        <p className="panel-section-label" style={{ marginTop: 20 }}>
          Otros
        </p>
        <div className="fac-menu fac-menu-chico">
          <a className="fac-menu-card" href="/facturas-admin/por-cliente">
            <span className="fac-menu-titulo">Historial por cliente</span>
            <span className="fac-menu-texto">Las facturas de un cliente mes por mes.</span>
          </a>
          <a className="fac-menu-card" href="/facturas-admin/importar">
            <span className="fac-menu-titulo">Importar CFDI</span>
            <span className="fac-menu-texto">Sube facturas ya timbradas (por ejemplo, las de ZORA) a Nodus.</span>
          </a>
          {puedeEditar && (
            <a className="fac-menu-card" href="/catalogo-servicios">
              <span className="fac-menu-titulo">+ Servicios y precios</span>
              <span className="fac-menu-texto">Agrega o edita los servicios que se cobran y su precio.</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
