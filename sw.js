// StudyStarx service worker: the app page is fetched fresh (up to 2s, behind the launch screen);
// if the network is very slow the saved copy opens and the fresh one is saved for next time;
// the last good copy is used only when the device is offline. API calls are never cached.
const CACHE = 'studyflow-v8';
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
  if (nav) {
    // Online: wait for the newest page (up to 2 s, hidden behind the launch screen) so the app opens once, on the
    // newest version, with no reload. Offline or very slow: open the last saved copy.
    const net = fetch(req);
    e.waitUntil(net.then(async res => { if (res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put('/', res.clone()); } }).catch(() => {}));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const saved = () => caches.match('/').then(r => { if (!done) { done = true; resolve(r || new Response('Offline', { status: 504 })); } });
      const t = setTimeout(() => caches.match('/').then(r => { if (r && !done) { done = true; resolve(r); } }), 2000);
      net.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r.clone()); } }).catch(() => { clearTimeout(t); saved(); });
    }));
    return;
  }
  // pictures, fonts and scripts: open the saved copy instantly, refresh it quietly in the background
  e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok && res.type === 'basic') { c.put(req, res.clone()).then(() => { if (url.pathname.startsWith('/js/')) trimJs(c); }).catch(() => {}); } return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match(req, { ignoreSearch: true }).then(r => r || new Response('', { status: 504, statusText: 'Offline' })));
  })));
});

// app code files have a fingerprint in their name; keep only the newest 40 so old versions don't pile up
function trimJs(c) { c.keys().then(ks => { const js = ks.filter(k => new URL(k.url).pathname.startsWith('/js/')); if (js.length > 40) js.slice(0, js.length - 40).forEach(k => c.delete(k)); }).catch(() => {}); }

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('/?go=focus');
  }));
});
