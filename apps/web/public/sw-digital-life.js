/* Cache immutable Vite bundles + serve offline-kernel media when present. */
const CACHE = "mybrandos-dl-static-v2";
const OFFLINE_MEDIA = "mybrandos-offline-media-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("mybrandos-dl-") && key !== CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode === "navigate") return;
  const url = new URL(req.url);
  const isStatic =
    url.origin === self.location.origin &&
    /^\/assets\/[^/]+-[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname);
  const maybeOfflineMedia = /\/assets\/[^/]+\/(media|cover)(\/|$|\?)/.test(url.pathname);
  if (!isStatic && !maybeOfflineMedia) return;

  event.respondWith((async () => {
    if (maybeOfflineMedia) {
      try {
        const hit = await caches.open(OFFLINE_MEDIA).then((c) => c.match(req));
        if (hit) return hit;
      } catch {
        /* ignore */
      }
      return fetch(req);
    }

    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok) await cache.put(req, response.clone());
    return response;
  })());
});
