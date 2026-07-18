// sw.js — app-shell cache only; API calls always hit the network.
const SHELL = ['/', '/mobile.css', '/mobile.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open('jarvis-shell-v1').then((c) => c.addAll(SHELL))));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
