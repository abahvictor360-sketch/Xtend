'use client'

import { useEffect } from 'react'
import { sendActivity } from '@/lib/activity-client'

/** At most one call from this page every few minutes; the database keeps one per 30. */
const MIN_GAP_MS = 5 * 60_000

/**
 * Renders nothing. Notes when the app or dashboard is opened or brought
 * back to the front (migration 062).
 */
export function ActivityPing() {
  useEffect(() => {
    let last = 0
    const ping = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last < MIN_GAP_MS) return
      last = Date.now()
      void sendActivity('app_open', 0)
    }
    ping()
    document.addEventListener('visibilitychange', ping)
    return () => document.removeEventListener('visibilitychange', ping)
  }, [])
  return null
}
