'use client'

import { useEffect } from 'react'
import { noteOffline, reportPhone } from '@/lib/phone-report'
import { flushOutbox } from '@/lib/offline/sync'

const EVERY_MS = 5 * 60_000

/**
 * Renders nothing. While the app is open it reports on the phone: when it
 * opens, comes back on screen, goes off screen, regains network, and every
 * five minutes. See lib/phone-report.ts.
 */
export function PhoneBeacon() {
  useEffect(() => {
    void reportPhone('open')

    const onVisibility = () => {
      void reportPhone(document.visibilityState === 'visible' ? 'visible' : 'hidden')
    }
    const onOnline = () => {
      void reportPhone('online')
      // Whatever was kept while offline goes now, on whichever page is open.
      void flushOutbox().catch(() => {})
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reportPhone('interval')
    }, EVERY_MS)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', noteOffline)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', noteOffline)
    }
  }, [])

  return null
}
