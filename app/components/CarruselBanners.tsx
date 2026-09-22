"use client";

import { useEffect, useRef, useState } from "react";

export type BannerDestacado = { src: string; alt: string };

// Banners promocionales del carrusel de arriba del dashboard del cliente
// (estilo "Rappi"): hoy solo llevamos el banner de Nodus Flex Center, pero
// para sumar más (p.ej. empresas de éxito / testimoniales) basta con:
//   1. Poner la imagen en /public/images
//   2. Agregar un objeto { src, alt } a este arreglo
// El carrusel se ajusta solo — muestra los puntos y hace autoplay
// automáticamente en cuanto hay más de un banner.
export const BANNERS_DESTACADOS: BannerDestacado[] = [
  {
    src: "/images/nodus-flex-center-banner.jpg",
    alt: "Nodus Flex Center · Aguascalientes, León, San Luis Potosí y Querétaro",
  },
  {
    src: "/images/nodus-flex-center-capacitacion.jpg",
    alt: "Capacitación en vivo en las salas de Nodus Flex Center",
  },
  {
    src: "/images/nodus-san-telmo.jpg",
    alt: "Nodus Flex Center · Sucursal San Telmo",
  },
];

// Mismo carrusel que ve el cliente en su dashboard — se reutiliza en
// Diseño (app/diseno/page.tsx) como vista previa de cómo se ve con los
// banners de Logros ya publicados, sin duplicar la lógica del carrusel.
export function CarruselDestacados({ banners }: { banners: BannerDestacado[] }) {
  const [activo, setActivo] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autoplay — solo tiene sentido si hay más de un banner.
  useEffect(() => {
    if (banners.length < 2) return;
    const id = setInterval(() => {
      setActivo((prev) => (prev + 1) % banners.length);
    }, 5000);
    return () => clearInterval(id);
  }, [banners.length]);

  useEffect(() => {
    const track = trackRef.current;
    const slide = track?.children[activo] as HTMLElement | undefined;
    if (!track || !slide) return;
    // Antes usábamos slide.scrollIntoView(), pero si el carrusel queda
    // fuera de la pantalla (ej. el cliente está hasta abajo del
    // dashboard cuando cambia el banner), scrollIntoView jala TODA la
    // página hacia arriba para volver a mostrarlo — no solo desliza el
    // carrusel. Moviendo el scrollLeft del track directamente, solo se
    // desliza el carrusel y la página se queda donde el cliente estaba.
    track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
  }, [activo]);

  useEffect(() => {
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, []);

  // El scroll (tanto el que desliza el usuario a mano como el que anima
  // el autoplay) dispara un montón de eventos intermedios mientras la
  // animación todavía va a medio camino. Si sincronizamos los puntos con
  // cada uno de esos eventos, agarramos una posición a medias que
  // redondea de vuelta al slide anterior y "pelea" con el autoplay —
  // se ve como que la imagen se mueve tantito y nunca cambia. Por eso
  // esperamos a que el scroll se asiente (deja de moverse ~120ms) antes
  // de leer la posición final y sincronizar.
  function handleScroll() {
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const index = Math.round(track.scrollLeft / track.clientWidth);
      setActivo((prev) => (index !== prev && index >= 0 && index < banners.length ? index : prev));
    }, 120);
  }

  if (banners.length === 0) return null;

  return (
    <div className="cli-carrusel">
      <div className="cli-carrusel-track" ref={trackRef} onScroll={handleScroll}>
        {banners.map((b, i) => (
          <div className="cli-carrusel-slide" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.src} alt={b.alt} className="cli-carrusel-img" />
          </div>
        ))}
      </div>
      {banners.length > 1 && (
        <div className="cli-carrusel-dots">
          {banners.map((_, i) => (
            <span key={i} className={"cli-carrusel-dot" + (i === activo ? " active" : "")} />
          ))}
        </div>
      )}
    </div>
  );
}
