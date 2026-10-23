// A release is cached together. Existing tabs opt in before activating an update.
const CACHE_NAME = 'workout-tracker-v32';
const ASSETS_TO_CACHE = [
  './', './index.html', './styles.css?v=32', './app.js?v=32',
  './warmups.css?v=32', './workout-flow.css?v=32', './insights.css?v=32', './routine-data.js?v=32', './update-manager.js?v=32', './accessibility.js?v=32',
  './manifest.json', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('workout-tracker-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fetch(event.request);
  })());
});
