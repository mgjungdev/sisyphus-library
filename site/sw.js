// Offline support: app shell and book data served from cache and refreshed in the background, dictionary lookups cache-first.
const VERSION = 'v4';
const SHELL = `shell-${VERSION}`, DATA = `data-${VERSION}`, LOOKUP = 'lookup-v1', FONTS = 'fonts-v1';
const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'img/icon.svg',
  'css/tokens.css', 'css/base.css', 'css/library.css', 'css/reader.css', 'css/card.css', 'css/pages.css',
  'js/app.js', 'js/art.js', 'js/card.js', 'js/library.js', 'js/lookup.js', 'js/pages.js', 'js/reader.js', 'js/speech.js', 'js/store.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const keep = new Set([SHELL, DATA, LOOKUP, FONTS]);
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !keep.has(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(name)).put(req, res.clone());
  return res;
}
// Answer from the cache at once and update it for next time; wait on the network only on a miss.
async function staleWhileRevalidate(e, name) {
  const req = e.request;
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => { if (res.ok) return cache.put(req, res.clone()).then(() => res); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

self.addEventListener('fetch', e => {
  const { request: req } = e;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // sync always goes to the network
  if (url.hostname === 'api.datamuse.com' || url.hostname === 'en.wiktionary.org') return e.respondWith(cacheFirst(req, LOOKUP));
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) return e.respondWith(cacheFirst(req, FONTS));
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) return e.respondWith(staleWhileRevalidate(e, DATA));
  e.respondWith(staleWhileRevalidate(e, SHELL));
});
