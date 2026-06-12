// CityPlay Vanish — Service Worker
// Caching strategy:
//  - App shell (HTML/CSS/JS/icons): cache-first, refreshed in background
//  - Leaflet from cdnjs: cache-first
//  - Map tiles (OSM): network-first with cache fallback
//  - Everything else: network-first

const CACHE_VERSION = 'cityplay-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;

// Files that make up the app shell — cached on install
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600;700&display=swap',
];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      // Use addAll, but if any single asset fails, cache the rest individually
      // (some CDN resources might fail intermittently)
      return Promise.all(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn('Failed to cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => !k.startsWith(CACHE_VERSION))
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch: route by request type
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // Map tiles: network-first with cache fallback, cap cache size
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(handleTile(request));
    return;
  }

  // App shell + everything else: cache-first with network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Return cached, but also revalidate in background
        fetch(request).then(fresh => {
          if (fresh.ok) caches.open(APP_CACHE).then(c => c.put(request, fresh));
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then(fresh => {
        if (fresh.ok && (url.origin === location.origin || url.hostname.includes('cdnjs') || url.hostname.includes('fonts'))) {
          const clone = fresh.clone();
          caches.open(APP_CACHE).then(c => c.put(request, clone));
        }
        return fresh;
      }).catch(() => {
        // Offline & not cached — return a minimal fallback if it's a navigation
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Tile handler: try network first, fall back to cache
async function handleTile(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(TILE_CACHE);
      cache.put(request, fresh.clone());
      // Trim cache if it gets too big (keep last 500 tiles)
      trimCache(TILE_CACHE, 500);
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // No tile available — return transparent 1x1 PNG
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete oldest (first in list)
    const toDelete = keys.length - maxItems;
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  }
}
