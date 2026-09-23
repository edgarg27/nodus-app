"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { pedirLinkFirmado } from "@/lib/storage";

// Botón que abre (o descarga) un archivo guardado en Supabase Storage pidiendo
// un link firmado y temporal en el momento del clic, en vez de reusar una URL
// pública fija. `bucket` solo hace falta si `url` es una ruta suelta: cuando es
// la URL completa, el bucket sale de ella.
export default function BotonArchivo({
  url,
  bucket = "",
  descargar = false,
  className = "ver-pdf-btn",
  style,
  title,
  children,
}: {
  url: string;
  bucket?: string;
  descargar?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  const [abriendo, setAbriendo] = useState(false);

  async function abrir() {
    setAbriendo(true);
    const { url: firmada, error } = await pedirLinkFirmado(url, { descargar });
    setAbriendo(false);
    if (!firmada) {
      alert("No se pudo abrir el archivo: " + (error || "intenta de nuevo"));
      return;
    }
    window.open(firmada, "_blank", "noopener");
  }

  return (
    <button type="button" className={className} style={style} title={title} onClick={abrir} disabled={abriendo}>
      {abriendo ? "Abriendo…" : children}
    </button>
  );
}
