/*
 * Digital Life offline: the public app keeps working without a network (installed App / Space).
 * - Vite bundles: cache-first (immutable, hashed names).
 * - Page loads: network-first; offline → the last cached app shell.
 * - Public API reads (/api/public/**): network-first; offline → last good response.
 * - Covers / logos / images: cached when fetched, served from cache offline.
 * - Offline-kernel media: served from its own cache when present.
 * Never cached: sign-in, Studio, session or any non-public API, non-GETs, ranged media.
 */
const CACHE = "mybrandos-dl-static-v3";
const PAGES = "mybrandos-dl-pages-v3";
const API = "mybrandos-dl-api-v3";
const IMAGES = "mybrandos-dl-images-v3";
const OFFLINE_MEDIA = "mybrandos-offline-media-v1";
const SHELL = "/__app-shell";
const KEEP = [CACHE, PAGES, API, IMAGES];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("mybrandos-dl-") && !KEEP.includes(key))
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

function isPrivatePath(pathname) {
  return /^\/(studio|auth|admin|os)(\/|$)/.test(pathname) || (pathname.startsWith("/api/") && !pathname.startsWith("/api/public/"));
}

async function networkFirst(cacheName, req, ignoreSearch) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(req);
    if (response.status === 200) await cache.put(req, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: every public route is the same app shell.
  if (req.mode === "navigate") {
    if (isPrivatePath(url.pathname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(PAGES);
      try {
        const response = await fetch(req);
        if (response.status === 200 && (response.headers.get("content-type") || "").includes("text/html")) {
          await cache.put(SHELL, response.clone());
        }
        return response;
      } catch (err) {
        const shell = await cache.match(SHELL);
        if (shell) return shell;
        throw err;
      }
    })());
    return;
  }

  if (isPrivatePath(url.pathname) || req.headers.has("range")) return;

  const isStatic = /^\/assets\/[^/]+-[a-zA-Z0-9_-]+\.(js|css|woff2?|svg|png|webp)$/.test(url.pathname);
  const maybeOfflineMedia = /\/assets\/[^/]+\/(media|cover)(\/|$|\?)/.test(url.pathname);
  const isImage = req.destination === "image" || /\/(cover|logo|avatar|poster|thumbnail)(\/|$)/.test(url.pathname);
  const isStream =
    req.destination === "audio" || req.destination === "video" || (req.destination !== "image" && /\/media(\/|$)/.test(url.pathname));

  if (maybeOfflineMedia) {
    event.respondWith((async () => {
      try {
        const hit = await caches.open(OFFLINE_MEDIA).then((c) => c.match(req));
        if (hit) return hit;
      } catch {
        /* ignore */
      }
      return isImage && !isStream ? networkFirst(IMAGES, req, true) : fetch(req);
    })());
    return;
  }

  if (isStatic) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    })());
    return;
  }

  if (url.pathname.startsWith("/api/public/")) {
    if (isImage && !isStream) return event.respondWith(networkFirst(IMAGES, req, true));
    if (isStream) return; // streamed audio/video: network, or the offline kernel
    event.respondWith(networkFirst(API, req, false));
  }
});
