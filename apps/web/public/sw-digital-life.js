/* Digital Life public app shell — cache app chrome only. Never cache private Workstation data. */
const CACHE = "mybrandos-dl-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/digital-life-192.svg", "/icons/digital-life-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API / auth / private surfaces.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth")) return;

  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/u/") || url.pathname === "/" || url.pathname.endsWith(".svg")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok && (url.pathname === "/" || url.pathname.endsWith(".svg"))) {
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("/") || caches.match(req)),
    );
  }
});
