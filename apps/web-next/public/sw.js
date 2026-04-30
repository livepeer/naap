/**
 * AgentBook Service Worker — Offline support.
 *
 * Strategies:
 * - Cache-first: static assets (CSS, JS, images)
 * - Network-first with cache fallback: API data (expenses, invoices, trial balance)
 * - Background sync: queued operations (receipt upload, expense recording)
 */

const CACHE_NAME = 'agentbook-v1';
const STATIC_CACHE = 'agentbook-static-v1';
const API_CACHE = 'agentbook-api-v1';

// Static assets to pre-cache
const PRECACHE_URLS = [
  '/agentbook',
  '/manifest.json',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: strategy based on request type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/v1/agentbook')) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // CDN plugin bundles: cache-first (immutable)
  if (url.pathname.startsWith('/cdn/plugins/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Static assets: cache-first
  if (url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Navigation: network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // Default: network
  event.respondWith(fetch(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ success: false, error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Background sync: replay queued operations when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'agentbook-expense-sync') {
    event.waitUntil(replayExpenseQueue());
  }
  if (event.tag === 'agentbook-receipt-sync') {
    event.waitUntil(replayReceiptQueue());
  }
});

async function replayExpenseQueue() {
  // Read from IndexedDB and POST each queued expense
  // TODO: Implement IndexedDB queue read + replay
  console.log('[SW] Replaying expense queue');
}

async function replayReceiptQueue() {
  console.log('[SW] Replaying receipt queue');
}

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'AgentBook';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data.url ? { url: data.url } : {},
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/agentbook';
  event.waitUntil(self.clients.openWindow(url));
});
