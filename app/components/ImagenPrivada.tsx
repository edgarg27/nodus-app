"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { pedirLinkFirmado, parseStorageUrl } from "@/lib/storage";

// Imagen guardada en Supabase Storage que se muestra con un link firmado y
// temporal en vez de la URL pública fija guardada en la base de datos. Sirve
// igual si el bucket es público (hoy) o privado (después). Los links firmados
// se guardan en memoria para no volver a pedirlos cada vez que se repinta.
const CACHE = new Map<string, { url: string; vence: number }>();
const VIGENCIA_SEG = 3600;

function firmadaEnCache(src: string) {
  const c = CACHE.get(src);
  return c && c.vence > Date.now() ? c.url : null;
}

export default function ImagenPrivada({
  src,
  bucket = "",
  alt,
  className,
  style,
  onClick,
}: {
  src: string;
  bucket?: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const [firmada, setFirmada] = useState<string | null>(() => firmadaEnCache(src));
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setFallo(false);
    const guardada = firmadaEnCache(src);
    if (guardada) {
      setFirmada(guardada);
      return;
    }
    // Si no es una URL de nuestro Storage (y no se indicó bucket), se muestra tal cual.
    if (!parseStorageUrl(src) && !bucket) {
      setFirmada(src);
      return;
    }
    setFirmada(null);
    pedirLinkFirmado(src, { expiresIn: VIGENCIA_SEG }).then(({ url }) => {
      if (cancelado) return;
      if (!url) {
        setFallo(true);
        return;
      }
      CACHE.set(src, { url, vence: Date.now() + (VIGENCIA_SEG - 300) * 1000 });
      setFirmada(url);
    });
    return () => {
      cancelado = true;
    };
  }, [src, bucket]);

  if (fallo) {
    return (
      <span className={className} style={{ ...style, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#f0f0f0", color: "#999" }} title="No se pudo cargar la imagen">
        🖼️
      </span>
    );
  }
  if (!firmada) {
    return <span className={className} style={{ ...style, display: "inline-block", background: "#eee" }} aria-busy="true" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={firmada} alt={alt} className={className} style={style} onClick={onClick} />;
}
