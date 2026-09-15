/* Cache only immutable Vite bundles. Navigation and private responses stay network-only. */
const CACHE = "mybrandos-dl-static-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("mybrandos-dl-") && key !== CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || req.mode === "navigate" || url.origin !== self.location.origin) return;
  if (!/^\/assets\/[^/]+-[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req);
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok) await cache.put(req, response.clone());
    return response;
  }));
});
