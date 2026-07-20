// sw.js — app-shell cache, network-first so installed phones pick up future
// fixes instead of being stuck on whatever shipped at install time. API
// calls always hit the network.
const CACHE = 'jarvis-shell-v2';
const SHELL = ['/', '/mobile.css', '/mobile.js', '/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
