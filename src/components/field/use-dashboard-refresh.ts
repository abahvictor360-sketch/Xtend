'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Refresh server-rendered dashboard state while the screen is open.
 * The shorter active-shift interval keeps clock/visit state current without
 * polling in the background or spending battery on an idle dashboard.
 */
export function useDashboardRefresh(activeShift: boolean) {
  const router = useRouter()
  const refreshing = useRef(false)

  useEffect(() => {
    const refresh = () => {
      if (
        refreshing.current ||
        document.visibilityState !== 'visible' ||
        navigator.onLine === false
      ) {
        return
      }
      refreshing.current = true
      router.refresh()
      window.setTimeout(() => {
        refreshing.current = false
      }, 2000)
    }

    const interval = window.setInterval(refresh, activeShift ? 15000 : 60000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onOnline = () => refresh()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [activeShift, router])
}
