const VERSION = "navi-shell-v13";
const STATIC_CACHE = `${VERSION}-static`;
/* Last successful render of each route, so a cold launch with no network boots
   the real app instead of the offline placeholder. This HTML is server-rendered
   per account, so the name stays under the `navi-` prefix that the app clears
   whenever the signed-in scope changes. */
const SHELL_CACHE = `${VERSION}-shell`;
/* Assets that ship in /public and carry no account data. Anything outside this
   set is fetched from the network so it cannot outlive a sign-out. */
const PUBLIC_ASSET = /^\/(?:splash\/|favicon\.ico$|apple-touch-icon|pwa-icon-|brand-spark\.png$|offline)/;
const OFFLINE_URL = "/offline-shell.html";
const SHELL = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/pwa-icon-192-v5.png",
  "/pwa-icon-512-v5.png",
  "/pwa-icon-maskable-v5.png"
];

/**
 * Fetch the app shell and keep it for offline boots. This cannot wait for a
 * navigation to go through the worker: the worker does not control the first
 * load, and every navigation after that is handled by the client router, so no
 * further navigate requests may ever reach this file.
 */
async function cacheAppShell() {
  try {
    const response = await fetch("/", { credentials: "same-origin" });
    // A redirect means sign-in, not the app — caching it would strand the user
    // on a login page they cannot complete while offline.
    if (!response.ok || response.redirected) return;
    const cache = await caches.open(SHELL_CACHE);
    await cache.put("/", response);
  } catch {
    // Offline at install time; the next navigation refreshes it.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(cacheAppShell)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("navi-") && key !== STATIC_CACHE && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      // Refresh the shell now that this worker controls the page, so the cached
      // boot document matches the version that is actually running.
      .then(cacheAppShell)
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* Receive side only. Nothing subscribes to push yet — that needs a VAPID
   keypair, a permission flow, somewhere to persist subscriptions, and a sender,
   none of which this app has. This handler exists so a delivered push renders
   correctly rather than showing the browser's generic fallback notification,
   and it pairs with the notificationclick handler below. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title || "NaviOS Hub";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/pwa-icon-192-v5.png",
      badge: "/pwa-icon-192-v5.png",
      tag: payload.tag || "navi-message",
      data: { url: payload.url || "/" }
    })
  );
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
        .then((response) => {
          /* `redirected` means this landed on /sign-in rather than the app.
             Storing it would serve a login page as the shell, and a redirected
             response replayed for a navigation is rejected outright by the
             browser — a blank screen rather than a wrong one. */
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () =>
          // Prefer this exact route, then any cached route, so a deep link
          // opened offline still lands in the app rather than the placeholder.
          (await caches.match(request, { cacheName: SHELL_CACHE }))
          ?? (await caches.match("/", { cacheName: SHELL_CACHE }))
          ?? (await caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Only build output and files shipped in /public are cached. Caching by
  // `request.destination === "image"` would also capture anything an
  // authenticated route or the /_next/image proxy returns, and this cache is
  // shared by every account that signs in on the device.
  const cacheFirst = url.pathname.startsWith("/_next/static/")
    || (request.destination === "font" && !url.pathname.startsWith("/api/"))
    || PUBLIC_ASSET.test(url.pathname);

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
