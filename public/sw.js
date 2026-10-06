/*
 * Xtend service worker.
 *
 * Deliberately small. The app shell is cached so a cold start on 3G is not a
 * white screen, and navigations fall back to /offline when the network is
 * gone. Writes are NOT replayed here: they live in the IndexedDB outbox and
 * are flushed by the page, which owns the auth session.
 */
const VERSION = 'xtend-v3'
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

/* -------------------------------------------------------------------------
 * Push notifications.
 *
 * The payload is sent by /api/admin/notifications as JSON. A push that
 * arrives without a readable body still shows something rather than the
 * browser's own "This site has been updated in the background" notice.
 * ---------------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Xtend', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Xtend'
  const check = payload.check && payload.check.id && payload.check.token ? payload.check : null
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-64.png',
    tag: payload.notificationId || undefined,
    renotify: Boolean(payload.notificationId),
    data: { url: payload.url || '/field', check },
    vibrate: [80, 40, 80],
  }

  // A supervisor's "check the phone now": say that it arrived. Arriving at
  // all proves the phone is on and has network (migration 026).
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      check ? answerCheck(check, 'delivered') : Promise.resolve(),
    ]),
  )
})

function answerCheck(check, stage) {
  return fetch('/api/phone-check/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: check.id, token: check.token, stage }),
  }).catch(() => {})
}

function sameOrigin(url) {
  try {
    return new URL(url, self.location.origin).origin === self.location.origin
  } catch (e) {
    return false
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever a page in Xtend: a notification must not open another site.
  const asked = (event.notification.data && event.notification.data.url) || '/field'
  const target = sameOrigin(asked) ? asked : '/field'
  const check = event.notification.data && event.notification.data.check
  if (check) event.waitUntil(answerCheck(check, 'opened'))

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an open tab if there is one, rather than piling up windows.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

/* A subscription can be rotated by the browser; re-register when it is. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: event.oldSubscription?.options?.applicationServerKey })
      .then((subscription) =>
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        }),
      )
      .catch(() => {}),
  )
})
