/* eslint-disable no-restricted-globals */
/* global URL */
// Service worker for Area Code: Web Push + offline app shell.
//
// Two responsibilities:
//   1. Web Push notifications (push / notificationclick handlers).
//   2. Offline resilience for SA mobile networks - precache the app shell and
//      serve same-origin static assets from cache, with a graceful offline
//      fallback for navigations.
//
// Caching strategy:
//   - Navigations (HTML): network-first, fall back to the cached shell when
//     offline so the SPA still boots and can show its own offline UI.
//   - Hashed build assets (/assets/*, icons, manifest): cache-first, since Vite
//     fingerprints them so a changed file always has a new URL.
//   - Everything cross-origin (Mapbox tiles, fonts, API) is left to the network
//     and never cached here.
//
// Bump CACHE_VERSION whenever the precache list or strategy changes so old
// caches are cleared on activate.

const CACHE_VERSION = 'v1'
const CACHE_NAME = `area-code-${CACHE_VERSION}`

// The minimal shell needed for a cold offline boot. Hashed JS/CSS bundles are
// cached on demand at runtime (their URLs change every build, so listing them
// here would be stale immediately).
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.ico']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Don't let one missing asset abort the whole install.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Lets the app trigger an immediate takeover by a newly-installed worker that
// is parked in "waiting" (see useAppUpdate). No-op when nothing is waiting.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

// Cache-first for same-origin static assets; falls back to network and stores
// the response for next time.
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached
    return fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
      }
      return response
    })
  })
}

// Network-first for navigations so users always get the freshest HTML when
// online, with the cached shell as the offline fallback.
function networkFirstNavigation(request) {
  return fetch(request)
    .then((response) => {
      const copy = response.clone()
      void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
      return response
    })
    .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET; never interfere with POST/PUT (API mutations etc.).
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Leave cross-origin requests (Mapbox, Google Fonts, API) to the network.
  if (url.origin !== self.location.origin) return

  // SPA navigations.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  // Same-origin static assets (hashed bundles, icons, manifest, images).
  event.respondWith(cacheFirst(request))
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const payload = event.data.json()
    const title = payload.title || 'Area Code'
    const options = {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: payload.data || {},
      tag: payload.data?.rewardId || 'default',
      renotify: true,
    }

    event.waitUntil(self.registration.showNotification(title, options))
  } catch {
    // Malformed push payload - ignore
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
