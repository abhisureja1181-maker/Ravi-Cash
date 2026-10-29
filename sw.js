/* Ravi Cash service worker — app-shell cache so the app opens (and offline vouchers can be prepared) with no network.
 * Strategy: navigations and config.js are network-first with a cached fallback; static assets are stale-while-revalidate.
 * Business data never goes through here: the demo keeps it in IndexedDB and the real server's /api/* calls
 * (including the live-sync stream) are never intercepted or cached. */
const VERSION = 'rw-shell-v6';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest',
  'css/app.css', 'css/login.css', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'js/util.js', 'js/store.js', 'js/server-core.js', 'js/server-vouchers.js', 'js/server-admin.js', 'js/server-erase.js', 'js/server-tours.js', 'js/server-location.js', 'js/seed.js', 'js/api.js',
  'js/pdf.js', 'js/voucher.js', 'js/pdf-docs.js', 'js/export.js', 'js/ui.js', 'js/charts.js', 'js/images.js', 'js/map.js', 'js/tracker.js',
  'js/views/common.js', 'js/views/login.js', 'js/views/dashboard.js', 'js/views/vouchers.js', 'js/views/voucher-form.js',
  'js/views/voucher-detail.js', 'js/views/cash.js', 'js/views/admin.js', 'js/views/reports.js', 'js/views/misc.js', 'js/views/ceo.js', 'js/views/tours.js', 'js/views/livemap.js', 'js/app.js',
  'fonts/Inter-Regular.woff', 'fonts/Inter-Medium.woff', 'fonts/Inter-SemiBold.woff', 'fonts/Inter-Bold.woff',
  'fonts/Inter-Regular.ttf', 'fonts/Inter-Medium.ttf', 'fonts/Inter-SemiBold.ttf', 'fonts/Inter-Bold.ttf',
  'icons/icon-192.png', 'icons/icon-512.png', 'img/logo.jpg', 'img/logo-mark.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch API / storage calls to other origins
  if (url.pathname.startsWith('/api/')) return; // business data and the live-sync stream: always straight to the network
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r && r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
