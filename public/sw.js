const CACHE = 'adybe-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vendor/playcanvas.min.js',
  './js/main.js',
  './js/config.js',
  './js/assets.js',
  './js/network.js',
  './js/ui.js',
  './js/world.js',
  './js/gameplay.js',
  './assets/maps/world-layout.json',
  './assets/ui/crosshair.png',
  './assets/ui/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/ws')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
