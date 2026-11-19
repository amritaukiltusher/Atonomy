// Offline cache: the app shell, 3D models, wasm and MediaPipe models are cached after first use.
const CACHE = 'anatomylive-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
const okOrigin = (u) => u.origin === location.origin || u.hostname === 'storage.googleapis.com';
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !okOrigin(url) || req.headers.has('range')) return;
  const isPage = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: isPage });
    // pages: network first (fresh deploys), everything else: cache first (big, hashed/immutable files)
    if (hit && !isPage) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) { if (hit) return hit; throw err; }
  })());
});
