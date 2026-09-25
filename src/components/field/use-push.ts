'use client'

import { useCallback, useEffect, useState } from 'react'

export type PushState =
  | 'unsupported'
  | 'unconfigured'
  | 'denied'
  | 'off'
  | 'on'
  | 'working'

/** VAPID keys travel as base64url and the browser wants raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/**
 * Turns notifications on or off for this device. One subscription per
 * browser; the server keys them by endpoint so re-enabling is idempotent.
 */
export function usePush() {
  const [state, setState] = useState<PushState>('working')
  const [error, setError] = useState<string | null>(null)
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  const read = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (!publicKey) {
      setState('unconfigured')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (existing && Notification.permission === 'granted') {
        // The server may have retired it (a failed send) while the phone
        // kept it: register it again, so "on" here is "on" there too.
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(existing.toJSON()),
        }).catch(() => null)
        if (res && !res.ok && res.status !== 401) {
          await existing.unsubscribe().catch(() => {})
          setState('off')
          return
        }
      }
      setState(existing && Notification.permission === 'granted' ? 'on' : 'off')
    } catch {
      setState('off')
    }
  }, [publicKey])

  useEffect(() => {
    void read()
  }, [read])

  const enable = useCallback(async () => {
    setError(null)
    setState('working')
    try {
      if (!publicKey) throw new Error('Notifications are not configured on the server.')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not register this device.')

      setState('on')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn notifications on.')
      void read()
    }
  }, [publicKey, read])

  const disable = useCallback(async () => {
    setError(null)
    setState('working')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setState('off')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn notifications off.')
      void read()
    }
  }, [read])

  return { state, error, enable, disable }
}
