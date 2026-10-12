/** @type {import('next').NextConfig} */
const nextConfig = {
  // Salida "standalone": el contenedor de producción solo lleva lo necesario para correr
  // (ver Dockerfile). No cambia nada en desarrollo (npm run dev).
  output: "standalone",
  async headers() {
    return [
      {
        // El service worker no se debe guardar en caché, para que las actualizaciones lleguen al instante.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
