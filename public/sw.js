// public/sw.js
const CACHE_NAME = 'storm-cache-v2';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
const DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      if (!DEV) {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_ASSETS);
      }
    } catch (e) {
      // ignore
    } finally {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Handle Share Target in both DEV & PROD
async function handleShareTarget(event) {
  try {
    const form = await event.request.formData();
    const title = form.get('title') || '';
    const text = form.get('text') || '';
    const sharedUrl = form.get('url') || '';
    const files = form.getAll('files') || [];

    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = allClients[0];
    if (!client) client = await self.clients.openWindow('/share');
    else client = await client.focus();

    client && client.postMessage({ type: 'SHARE_TARGET', payload: { title, text, url: sharedUrl, files } });
    return Response.redirect('/share', 303);
  } catch {
    return new Response('Share failed', { status: 500 });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Share Target POST
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // In DEV: do NOT hijack Vite dev server requests
  if (DEV) return;

  if (event.request.method !== 'GET') return;

  // Same-origin: cache-first with background refresh
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      try {
        const resp = await fetch(event.request);
        if (resp && resp.ok && resp.type !== 'opaque') cache.put(event.request, resp.clone());
        return cached || resp;
      } catch {
        return cached || new Response('', { status: 200 });
      }
    })());
    return;
  }

  // Cross-origin images: network-first with cache fallback
  if (event.request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const resp = await fetch(event.request);
        if (resp && resp.ok) cache.put(event.request, resp.clone());
        return resp;
      } catch {
        const cached = await cache.match(event.request);
        return cached || Response.error();
      }
    })());
  }
});
