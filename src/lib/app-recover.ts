'use client'

/**
 * What the error screens do (lib/app-error.ts says what they say). Only the
 * stored copy of the app's pages and code (Cache Storage) is cleared, never
 * the work saved without signal (IndexedDB), the sign-in or notifications.
 */

/** Loads the newest version: clears the stored copy, then reloads past every cache. */
export async function reloadFresh() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // Nothing stored, or not allowed: reload anyway.
  }
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('_r', String(Date.now()))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

/**
 * Tells the server a screen crashed, so the office can see why (the logs).
 * Only the error, the page and the app version: nothing about the person.
 */
export function reportAppError(info: { kind: string; code: string; message?: string; digest?: string; where: string }) {
  try {
    const body = JSON.stringify({
      kind: info.kind,
      code: info.code,
      message: (info.message ?? '').slice(0, 300),
      digest: info.digest ?? null,
      where: info.where,
      path: window.location.pathname,
      build: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      online: navigator.onLine,
    })
    if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }))
    else void fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
  } catch {
    // Reporting must never make it worse.
  }
}
