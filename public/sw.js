// Service worker de la app instalable de Nodus.
//
// A propósito hace lo mínimo: NO guarda páginas ni datos de la cuenta (estados de cuenta,
// facturas, datos fiscales) en el teléfono. Solo sirve una pantalla de "Sin conexión" cuando
// no hay internet al abrir o navegar. Todo lo demás va directo a la red, como en el navegador.
const VERSION = "nodus-pwa-v3";
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

// Avisos al celular (notificaciones push). Los manda el servidor (lib/push.ts).
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Nodus", {
      body: d.body || "Tienes un aviso nuevo",
      icon: "/icons/pwa/icon-192.png",
      badge: "/icons/pwa/icon-192.png",
      tag: d.tag,
      data: { url: d.url || "/" },
    })
  );
});

// Al tocar el aviso se abre la pantalla correspondiente (solo rutas de esta misma app).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let destino = new URL("/", self.location.origin).href;
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (u.origin === self.location.origin) destino = u.href;
  } catch (e) {}
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) return v.focus().then((w) => (w && "navigate" in w ? w.navigate(destino) : undefined));
      }
      return self.clients.openWindow(destino);
    })
  );
});
