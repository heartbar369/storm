const CACHE_NAME = 'storm-cache-v2';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

// Precache
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

// Activate & clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()))))
  );
  self.clients.claim();
});

async function getIndexHtml() {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match('/index.html');
  if (cached) return cached;
  const res = await fetch('/index.html', { credentials: 'same-origin' });
  cache.put('/index.html', res.clone());
  return res;
}

// Convert POST /share-target to GET /share-target?... so the SPA can read URLSearchParams
async function handleShareTargetPOST(event) {
  try {
    const formData = await event.request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const q =
      '/share-target?title=' +
      encodeURIComponent(String(title)) +
      '&text=' +
      encodeURIComponent(String(text)) +
      '&url=' +
      encodeURIComponent(String(url));
    // 303 to a GET route the app can parse
    return Response.redirect(q, 303);
  } catch {
    // Fallback to index
    return getIndexHtml();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Handle POST from Web Share Target
  if (req.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTargetPOST(event));
    return;
  }

  // Ensure /share-target always serves the SPA shell
  if (req.method === 'GET' && (url.pathname === '/share-target' || url.pathname === '/share-target/')) {
    event.respondWith(getIndexHtml());
    return;
  }

  // Network-first for navigations; fallback to index.html on error OR non-OK (e.g., 404)
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (!res.ok || res.status >= 400) {
            return getIndexHtml();
          }
          // cache index.html copy for offline fallback
          caches.open(CACHE_NAME).then((c) => c.put('/index.html', res.clone())).catch(() => {});
          return res;
        } catch {
          return getIndexHtml();
        }
      })()
    );
    return;
  }

  // Cache-first for static assets
  if (['script', 'style', 'image', 'font'].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match('/index.html'));
      })
    );
    return;
  }
});
