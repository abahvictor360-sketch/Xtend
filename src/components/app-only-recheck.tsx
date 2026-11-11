'use client'

import { useEffect } from 'react'
import { APP_AGENT_MARK } from '@/lib/app-agent'

/**
 * On the "Use the Xtend app" page, inside the app itself: the page load came
 * through Android's service worker without the app's user agent. Any fetch
 * from the page carries it, so one request leaves the xt_app mark
 * (middleware) and the app goes on to Xtend. Once per sitting, so a
 * browser that only claims to be the app cannot loop.
 */
export function AppOnlyRecheck() {
  useEffect(() => {
    if (!navigator.userAgent.includes(APP_AGENT_MARK)) return
    try {
      if (sessionStorage.getItem('xt_app_recheck')) return
      sessionStorage.setItem('xt_app_recheck', '1')
    } catch {
      // No storage: still try once.
    }
    void fetch('/api/version', { cache: 'no-store' })
      .catch(() => null)
      .finally(() => window.location.replace('/'))
  }, [])
  return null
}
