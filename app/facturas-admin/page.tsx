"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Inicio de Facturación (diseño que pidió contabilidad): buscador, los cuatro módulos, "Otros" (Importar CFDI,
// Catálogo de conceptos y Configuración fiscal).

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IconoDoc = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Svg>
);
const IconoEdificio = () => (
  <Svg>
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M11 21v-3h2v3" />
  </Svg>
);
const IconoLista = () => (
  <Svg>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
);
const IconoSello = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <circle cx="12" cy="15" r="2.5" />
  </Svg>
);
const IconoSubir = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M12 18v-6M9.5 14.5 12 12l2.5 2.5" />
  </Svg>
);
const IconoCatalogo = () => (
  <Svg>
    <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
    <path d="M8 7h6M8 11h6M8 15h4" />
  </Svg>
);
const IconoFiscal = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="11" r="2.5" />
    <path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8M15 9h3M15 13h3" />
  </Svg>
);
const IconoBuscar = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
const Flecha = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

type Tarjeta = { href: string; titulo: string; texto: string; icono: ReactNode; color: string };

const MODULOS: Tarjeta[] = [
  { href: "/facturas-admin/integrar-cliente", titulo: "Integrar por cliente", texto: "Selecciona un cliente y genera su factura.", icono: <IconoDoc />, color: "azul" },
  { href: "/facturas-admin/integrar-lote", titulo: "Integrar por lote", texto: "Facturación masiva de un centro o servicio.", icono: <IconoEdificio />, color: "azul" },
  { href: "/facturas-admin/estados-de-cuenta", titulo: "Estados de cuenta", texto: "Consulta y descarga el historial de facturas.", icono: <IconoLista />, color: "azul" },
  { href: "/facturas-admin/timbradas", titulo: "Facturas timbradas", texto: "Descarga tus CFDI, XML y complementos.", icono: <IconoSello />, color: "azul" },
];
const OTROS: Tarjeta[] = [
  { href: "/facturas-admin/importar", titulo: "Importar CFDI", texto: "Sube archivos XML o PDF de facturas emitidas por ZORA, Contpaq, el Portal del SAT, etc.", icono: <IconoSubir />, color: "verde" },
  { href: "/catalogo-servicios", titulo: "Catálogo de conceptos", texto: "Los servicios adicionales que se facturan, con su clave del SAT y descripción.", icono: <IconoCatalogo />, color: "morado" },
  { href: "/facturas-admin/configuracion-fiscal", titulo: "Configuración fiscal", texto: "Datos fiscales de los clientes: razón social, RFC, régimen y código postal.", icono: <IconoFiscal />, color: "verde" },
];


function TarjetaModulo({ m }: { m: Tarjeta }) {
  return (
    <a className="fi-tarjeta" href={m.href}>
      <span className={"fi-icono fi-icono-" + m.color}>{m.icono}</span>
      <span className="fi-tarjeta-texto">
        <span className="fi-tarjeta-titulo">{m.titulo}</span>
        <span className="fi-tarjeta-desc">{m.texto}</span>
      </span>
      <span className="fi-flecha">
        <Flecha />
      </span>
    </a>
  );
}

export default function FacturacionPage() {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");


  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = busqueda.trim();
    router.push("/facturas-admin/timbradas" + (q ? "?q=" + encodeURIComponent(q) : ""));
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/dashboard">
          ← Regresar
        </Link>
        <p className="rep-title">Facturación</p>
        <p className="rep-sub">Gestiona tus facturas y comprobantes de forma rápida y segura</p>
      </div>

      <div className="rep-content rep-content-completo">
        <form className="fi-buscador" onSubmit={buscar}>
          <IconoBuscar />
          <input placeholder="Buscar cliente, factura, RFC..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar facturas timbradas" />
        </form>

        <h1 className="fi-titulo">Todo lo que necesitas para facturar</h1>

        <div className="fi-modulos">
          {MODULOS.map((m) => (
            <TarjetaModulo key={m.href} m={m} />
          ))}
        </div>

        <div className="fi-abajo fi-abajo-solo">
          <div>
            <p className="fi-seccion">Otros</p>
            <div className="fi-otros">
              {OTROS.map((m) => (
                <TarjetaModulo key={m.href} m={m} />
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
