// sw.js — service worker: la app funciona sin conexión (caché primero).
// IMPORTANTE: al publicar cambios, sube VERSION para que el iPhone descargue la versión nueva.
const VERSION = 'v1.0.0-f0';
const CACHE = `entreno-${VERSION}`;

// Todos los archivos de la app (rutas relativas a este archivo). Comprobado por scripts/check-assets.mjs.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './css/app.css',
  './css/session.css',
  './css/activity.css',
  './css/calendar.css',
  './css/library.css',
  './css/settings.css',
  './css/progress.css',
  './css/weekly.css',
  './js/app.js',
  './js/router.js',
  './js/db.js',
  './js/store.js',
  './js/util.js',
  './js/ui.js',
  './js/seed.js',
  './js/calc.js',
  './js/pickers.js',
  './js/session-logic.js',
  './js/session-view-card.js',
  './js/session-view-summary.js',
  './js/activity-logic.js',
  './js/plan.js',
  './js/plan-ui.js',
  './js/history-logic.js',
  './js/library-logic.js',
  './js/backup.js',
  './js/settings-logic.js',
  './js/views/today.js',
  './js/views/calendar.js',
  './js/views/history.js',
  './js/views/session.js',
  './js/views/activity.js',
  './js/views/bodyweight.js',
  './js/views/exercises.js',
  './js/views/templates.js',
  './js/views/settings.js',
  './js/views/progress.js',
  './js/views/weekly.js',
  './js/views/goals.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' evita guardar copias viejas de la caché HTTP.
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    // Primera instalación: activar ya. En actualizaciones se espera a que el usuario pulse «Actualizar».
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('entreno-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./index.html', { ignoreSearch: true });
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('Sin conexión', { status: 503 }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    }
  })());
});
