import type { MetadataRoute } from "next";

// App instalable (PWA): el personal y los clientes pueden instalar Nodus en la pantalla de
// inicio del celular. Abre a pantalla completa, con el azul de la marca.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Nodus Flex Center",
    short_name: "Nodus",
    description: "Tu centro de trabajo Nodus: pagos, reservas, tickets y más.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1b3e",
    theme_color: "#0d1b3e",
    lang: "es-MX",
    icons: [
      { src: "/icons/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
