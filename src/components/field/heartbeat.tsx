'use client'

import { useEffect, useRef } from 'react'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/geo'

/**
 * Foreground heartbeat. Every 5 minutes while the app is open and a shift is
 * running, a fix is posted; the database decides whether that is a geofence
 * breach. The web cannot track a closed tab and this does not pretend to.
 */
export function useHeartbeat(active: boolean) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active) return

    const send = () => {
      if (document.visibilityState !== 'visible') return
      if (!navigator.geolocation) return

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void fetch('/api/pings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy,
            }),
            keepalive: true,
          }).catch(() => {
            // A missed ping is not worth queueing: by the time it syncs it no
            // longer describes where anyone is.
          })
        },
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      )
    }

    send()
    timer.current = setInterval(send, HEARTBEAT_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') send()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}
