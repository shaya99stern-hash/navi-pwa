const VERSION = "navi-shell-v11";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline-shell.html";
const SHELL = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/pwa-icon-192-v5.png",
  "/pwa-icon-512-v5.png",
  "/pwa-icon-maskable-v5.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("navi-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API reads and all authenticated server state remain network-only.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  const cacheFirst = url.pathname.startsWith("/_next/static/")
    || request.destination === "font"
    || request.destination === "image"
    || /\.(?:png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname);

  if (cacheFirst) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
        return response;
      }))
    );
    return;
  }

  // Never cache route data or authenticated responses across accounts.
  event.respondWith(fetch(request));
});
