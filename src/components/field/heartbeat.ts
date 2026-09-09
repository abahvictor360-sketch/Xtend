'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/geo'

/** Absent entirely on older Android WebViews, so it is read defensively. */
type MaybeWakeLock = { request: (type: 'screen') => Promise<WakeLockSentinel> } | undefined

export type WakeLockState = 'held' | 'released' | 'unsupported' | 'denied'

export interface HeartbeatStatus {
  lastPingAt: string | null
  lastDistanceM: number | null
  lastError: string | null
  sending: boolean
  wakeLock: WakeLockState
  keepAwake: boolean
  setKeepAwake: (on: boolean) => void
  pingNow: () => void
}

/**
 * Location heartbeat.
 *
 * Every 5 minutes while a shift is open, a fix is posted and the database
 * decides whether it is a geofence breach.
 *
 * Implementation note for whoever maintains this: a browser suspends a page
 * that is not on screen, and a service worker cannot read geolocation, so the
 * interval below only runs while the page is live. Two things narrow the gap
 * — a screen wake lock while on shift, and an immediate fix whenever the page
 * becomes visible again — and the server stamps every gap it does see. True
 * background location needs the native wrapper (Phase 4).
 */
export function useHeartbeat(active: boolean): HeartbeatStatus {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const inFlight = useRef(false)

  const [keepAwake, setKeepAwake] = useState(true)
  const [wakeLock, setWakeLock] = useState<WakeLockState>('released')
  const [lastPingAt, setLastPingAt] = useState<string | null>(null)
  const [lastDistanceM, setLastDistanceM] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const send = useCallback(() => {
    if (!navigator.geolocation || inFlight.current) return
    if (document.visibilityState !== 'visible') return

    inFlight.current = true
    setSending(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch('/api/pings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy,
            }),
            keepalive: true,
          })
          if (!res.ok) throw new Error(`Ping rejected (${res.status})`)
          const { ping } = (await res.json()) as {
            ping: { distance_m: number | null; created_at: string }
          }
          setLastPingAt(ping.created_at)
          setLastDistanceM(ping.distance_m)
          setLastError(null)
        } catch (error) {
          // A missed ping is never queued: by the time it synced it would no
          // longer describe where anyone is.
          setLastError(error instanceof Error ? error.message : 'Ping failed')
        } finally {
          inFlight.current = false
          setSending(false)
        }
      },
      (err) => {
        inFlight.current = false
        setSending(false)
        setLastError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was turned off'
            : 'No location fix for this check',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }, [])

  // The heartbeat itself.
  useEffect(() => {
    if (!active) return

    send()
    timer.current = setInterval(send, HEARTBEAT_INTERVAL_MS)

    // Coming back to the foreground is exactly when we most want a fix: it
    // closes the gap the server is about to record.
    const onVisible = () => {
      if (document.visibilityState === 'visible') send()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, send])

  // Screen wake lock: the only lever the web gives us against the phone
  // locking mid-shift and taking the heartbeat with it.
  useEffect(() => {
    const wake = (navigator as Navigator & { wakeLock?: MaybeWakeLock }).wakeLock
    if (!wake) {
      setWakeLock('unsupported')
      return
    }

    let cancelled = false

    const acquire = async () => {
      if (!active || !keepAwake) return
      if (document.visibilityState !== 'visible') return
      if (sentinel.current && !sentinel.current.released) return

      try {
        const lock = await wake.request('screen')
        if (cancelled) {
          void lock.release()
          return
        }
        sentinel.current = lock
        setWakeLock('held')
        lock.addEventListener('release', () => setWakeLock('released'))
      } catch {
        // Battery saver and some OEM builds refuse the request outright.
        setWakeLock('denied')
      }
    }

    const release = async () => {
      const lock = sentinel.current
      sentinel.current = null
      if (lock && !lock.released) await lock.release()
      setWakeLock('released')
    }

    if (active && keepAwake) void acquire()
    else void release()

    // The lock is dropped whenever the page hides; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void release()
    }
  }, [active, keepAwake])

  return {
    lastPingAt,
    lastDistanceM,
    lastError,
    sending,
    wakeLock,
    keepAwake,
    setKeepAwake,
    pingNow: send,
  }
}
