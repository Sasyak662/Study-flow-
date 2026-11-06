// StudyFlow service worker: network-first for the app page, so updates always show;
// the last good copy is used only when the device is offline. API calls are never cached.
const CACHE = 'studyflow-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && (req.mode === 'navigate' || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then(r => r || caches.match('/')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('/?go=focus');
  }));
});
