// sw.js â€” app-shell cache, network-first so installed phones pick up future
// fixes instead of being stuck on whatever shipped at install time. API
// calls always hit the network.
// v8: mobile.js now plays Kokoro audio streamed from the PC instead of using
// the phone's own speechSynthesis. Installed phones must not keep serving v7.
const CACHE = 'jarvis-shell-v8';
const SHELL = ['/', '/mobile.css', '/mobile.js', '/orb-host.js', '/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png',
  '/fonts/SpaceGrotesk.woff2',
  '/orbs/orb-engine.js', '/orbs/plasma.js', '/orbs/neural.js', '/orbs/classic.js', '/orbs/zen.js', '/orbs/halation.js', '/orbs/aurora.js', '/orbs/starfield.js'];

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

