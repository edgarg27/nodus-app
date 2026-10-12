// Service worker de la app instalable de Nodus.
//
// A propósito hace lo mínimo: NO guarda páginas ni datos de la cuenta (estados de cuenta,
// facturas, datos fiscales) en el teléfono. Solo sirve una pantalla de "Sin conexión" cuando
// no hay internet al abrir o navegar. Todo lo demás va directo a la red, como en el navegador.
const VERSION = "nodus-pwa-v2";
const SIN_CONEXION = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(SIN_CONEXION))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(SIN_CONEXION)));
});
