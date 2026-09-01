const VERSION = 'jib-v1.3.0';
const CORE = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;
  const isAPI = url.indexOf('er-api.com') >= 0 ||
                url.indexOf('gold-api.com') >= 0 ||
                url.indexOf('/api/price') >= 0 ||
                url.indexOf('coingecko') >= 0 ||
                url.indexOf('pollinations') >= 0;

  // Always go to network for API + navigation (HTML) so pages stay fresh after deploy
  const isNav = req.mode === 'navigate' ||
                req.destination === 'document' ||
                url.endsWith('/') || url.endsWith('.html');

  if (isAPI || isNav) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for static assets (images, manifest, icons)
  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
