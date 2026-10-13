"use client";

import { useEffect, useState } from "react";
import { CATALOGO_ESTATICO, type ServicioCatalogo } from "@/lib/catalogoServicios";

// Los servicios que se pueden elegir (Adicionales y Nueva factura), con su precio. Mientras
// carga, o si algo falla, se usa la lista fija.
export function useCatalogoServicios() {
  const [servicios, setServicios] = useState<ServicioCatalogo[]>(CATALOGO_ESTATICO);
  const [puedeEditar, setPuedeEditar] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/catalogo-servicios")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d) return;
        if (Array.isArray(d.servicios) && d.servicios.length > 0) setServicios(d.servicios);
        setPuedeEditar(!!d.puedeEditar);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return { servicios, puedeEditar };
}
