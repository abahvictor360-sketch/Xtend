/*
 * Xtend service worker.
 *
 * Deliberately small. The app shell is cached so a cold start on 3G is not a
 * white screen, and navigations fall back to /offline when the network is
 * gone. Writes are NOT replayed here: they live in the IndexedDB outbox and
 * are flushed by the page, which owns the auth session.
 */
const VERSION = 'xtend-v1'
const SHELL = ['/offline', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never cache anything that mutates or that carries a signed URL.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline').then((r) => r || Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(VERSION).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
  }
})
