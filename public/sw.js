const CACHE = 'adybe-v16';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vendor/playcanvas.min.js',
  './js/main.js',
  './js/api.js',
  './js/session.js',
  './js/settings.js',
  './js/config.js',
  './js/assets.js',
  './js/network.js',
  './js/ui.js',
  './js/world.js',
  './js/rng.js',
  './js/exact-world.js',
  './js/models.js',
  './js/gameplay.js',
  './assets/maps/world-layout.json',
  './assets/textures/grass_albedo.png',
  './assets/textures/asphalt_albedo.png',
  './assets/textures/dirt_albedo.png',
  './assets/textures/wood_albedo.png',
  './assets/textures/concrete_albedo.png',
  './assets/textures/roof_albedo.png',
  './assets/textures/rock_albedo.png',
  './assets/textures/metal_albedo.png',
  './assets/ui/crosshair.png',
  './assets/ui/logo.png',
  './assets/ui/logo-emblem.svg',
  './assets/ui/coin.png',
  './assets/ui/trophy.png',
  './assets/backgrounds/bg-home.png',
  './assets/backgrounds/bg-login.png',
  './assets/backgrounds/bg-connected-01.png',
  './assets/backgrounds/bg-connected-02.png',
  './assets/backgrounds/bg-connected-03.png',
  './data/shop_catalog.json',
  './assets/previews/skin_recruit.jpg',
  './assets/previews/skin_jungle.jpg',
  './assets/previews/skin_ghost.jpg',
  './assets/previews/skin_phoenix.jpg',
  './assets/previews/char_dying.jpg',
  './assets/previews/char_dying1.jpg',
  './assets/previews/char_archer.jpg',
  './assets/previews/char_kaya.jpg',
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
  if (url.pathname.startsWith('/api/')) return;
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
