// FitOS service worker. Bump VERSION to drop old caches after a deploy changes shell files.
const VERSION = "v1";
const SHELL_CACHE = `fitos-shell-${VERSION}`;
const STATIC_CACHE = `fitos-static-${VERSION}`;
const SHELL = ["/", "/workout/", "/nutrition/", "/social/", "/profile/", "/login/", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never touch Supabase (API, auth, storage, realtime) or any other origin: network only.
  if (url.origin !== self.location.origin || url.hostname.endsWith(".supabase.co")) return;

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Pages: network first so deploys show up immediately, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // Other same-origin files (icons, RSC payloads): stale while revalidate.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});
