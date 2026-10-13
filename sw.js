// Service Worker for offline gym tracking
const CACHE_NAME = 'workout-tracker-v22';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css?v=21',
    './app.js?v=21',
    './routine-data.js?v=21',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
  ];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => {
                  return cache.addAll(ASSETS_TO_CACHE);
          })
        );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
          caches.keys().then((keys) => {
                  return Promise.all(
                            keys.map((key) => {
                                        if (key !== CACHE_NAME) {
                                                      return caches.delete(key);
                                        }
                            })
                          );
          })
        ).then(() => self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

                        const url = new URL(event.request.url);
    const isCode =
          event.request.mode === 'navigate' ||
          url.pathname.endsWith('.html') ||
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css') ||
          url.pathname === '/' ||
          url.pathname.endsWith('/workout-tracker/') ||
          url.search.includes('v=');

                        // Network-First for HTML, JS, CSS: always pull latest when online, fallback to cache offline
                        if (isCode) {
                              event.respondWith(
                                      fetch(event.request)
                                        .then((networkResponse) => {
                                                    if (networkResponse && networkResponse.status === 200) {
                                                                  const responseClone = networkResponse.clone();
                                                                  caches.open(CACHE_NAME).then((cache) => {
                                                                                  cache.put(event.request, responseClone);
                                                                  });
                                                    }
                                                    return networkResponse;
                                        })
                                        .catch(() => cache.match(event.request, { ignoreSearch: true }))
                                    );
                              return;
                        }

                        // Cache-First for static media/icons
                        event.respondWith(
                              cache.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
                                      return cachedResponse || fetch(event.request);
                              })
                            );
});
