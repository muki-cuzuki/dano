// Pasji utrip: aplikacija deluje tudi ob slabi povezavi. Vedno najprej poskusi svežo verzijo z omrežja.
const CACHE = 'utrip-v3';
const SHELL = ['./', './index.html', './config.js', './vendor/supabase.js', './manifest.webmanifest', './icons/icon-192.png',
  './fonts/barlow-latin-400-normal.woff2', './fonts/barlow-latin-500-normal.woff2', './fonts/barlow-latin-600-normal.woff2', './fonts/barlow-latin-700-normal.woff2',
  './fonts/barlow-latin-ext-400-normal.woff2', './fonts/barlow-latin-ext-500-normal.woff2', './fonts/barlow-latin-ext-600-normal.woff2', './fonts/barlow-latin-ext-700-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('./index.html')))
  );
});
