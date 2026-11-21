// Network-first navigation and catalog for safe, prompt library updates.
// Book files and offline reader assets remain available through existing caching.
const CACHE_NAME = 'athenaeum-reader-v6';
const OFFLINE_FILES = [
  './',
  'reader.html',
  'css/reader.css',
  'js/reader.js',
  'js/db.js',
  'js/sync.js',
  'data/offline-dictionary.json?v=2'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const shouldRefresh = req.mode === 'navigate' || url.pathname.endsWith('/data/books.json');
  if (shouldRefresh) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(req);
        if (response.ok && response.type !== 'opaque') cache.put(req, response.clone());
        return response;
      } catch (e) {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
});
