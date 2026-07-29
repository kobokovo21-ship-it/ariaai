const CACHE = 'virgo-v23';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Offene Tabs EINMAL neu laden, damit ein neuer Deploy sofort ankommt.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try { client.navigate(client.url); } catch (e) {}
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // FREMDE Ressourcen (Bilder, Render-Service, Fonts, …) NIEMALS abfangen —
  // sonst brechen sie in iframes/Previews. Nur eigene Domain behandeln.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API nie cachen
  // HTML-Navigationen: immer frisch aus dem Netz, Offline-Fallback aus Cache.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html') || caches.match('/')));
    return;
  }
  // Eigene statische Assets: network-first, Cache nur als Offline-Fallback.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
