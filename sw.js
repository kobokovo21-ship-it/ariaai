const CACHE = 'virgo-v22';
// index.html NICHT vorab cachen — sonst kann eine alte Seite hängenbleiben.
// Wir cachen nur den Navigations-Fallback für den Offline-Fall zur Laufzeit.
const ASSETS = [];

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Alle alten Caches löschen (auch alte index.html-Kopien v19–v21).
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Offene Tabs EINMAL neu laden, damit sie sofort den neuen Code bekommen.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try { client.navigate(client.url); } catch (e) {}
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.url.includes('/api/')) return; // API nie cachen
  // HTML-Navigationen: IMMER frisch aus dem Netz (network-only, nur Offline-Fallback).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html') || caches.match('/')));
    return;
  }
  // Statische Assets: network-first, Cache nur als Offline-Fallback.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
