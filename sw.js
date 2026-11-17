// StudyStarx service worker: network-first for the app page, so updates always show;
// the last good copy is used only when the device is offline. API calls are never cached.
const CACHE = 'studyflow-v4';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/three-r128.min.js', '/gltf-loader-r128.js',
  '/fonts/inter-latin-400-normal.woff2', '/fonts/inter-latin-500-normal.woff2', '/fonts/inter-latin-600-normal.woff2', '/fonts/inter-latin-700-normal.woff2', '/fonts/inter-latin-800-normal.woff2',
  '/fonts/nunito-latin-700-normal.woff2', '/fonts/nunito-latin-800-normal.woff2', '/fonts/nunito-latin-900-normal.woff2'];
// files worth keeping for offline use (scripts, fonts, pictures, 3D models, question banks)
const ASSET = /\.(js|css|woff2?|png|jpe?g|webp|svg|glb|json)$/i;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const nav = req.mode === 'navigate';
  if (!nav && !ASSET.test(url.pathname) && !SHELL.includes(url.pathname)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(nav ? '/' : req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(nav ? '/' : req, { ignoreSearch: !nav }).then(r => {
      if (r) return r;
      if (nav) return caches.match('/');
      // never answer a missing script or picture with the app page
      return new Response('', { status: 504, statusText: 'Offline' });
    }))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('/?go=focus');
  }));
});
