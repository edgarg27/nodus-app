/** @type {import('next').NextConfig} */
const nextConfig = {
  // Salida "standalone": el contenedor de producción solo lleva lo necesario para correr
  // (ver Dockerfile). No cambia nada en desarrollo (npm run dev).
  output: "standalone",
};

module.exports = nextConfig;
