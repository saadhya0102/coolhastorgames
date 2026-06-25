/* Simple offline cache for CoolHastorGames. Caches the app shell + hashed game
 * chunks at runtime so offline games keep working with no connection. Network
 * requests to Firebase/Firestore and cross-origin fonts are left to the network. */
const CACHE = "chg-v1";
const SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // skip firebase + cross-origin

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) {
        // refresh in the background
        fetch(req).then((r) => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === "navigate") {
          const idx = (await cache.match("/index.html")) || (await cache.match("/"));
          if (idx) return idx;
        }
        throw err;
      }
    })(),
  );
});
