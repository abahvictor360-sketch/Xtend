'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

/**
 * Keep the phone dashboard in step with the backend.
 *
 * The fast path is Supabase realtime: the moment the member's own data
 * changes in the database (a clock event, a store visit, a reply from the
 * office) the server state is re-fetched and the screen updates, with no
 * tapping or pull-to-refresh. Realtime only carries rows the member may read
 * under RLS, so a channel without a filter still only ever sees their rows.
 *
 * Behind it sits a slow poll as a safety net for anything realtime can miss:
 * a dropped socket, or a value the server computes only when the page is
 * read. It is far slower than the old 15s poll, because realtime now does the
 * work that used to need constant refreshing, which also makes the app feel
 * quicker and spares the battery and data.
 */

// Tables the dashboard's state is derived from. Each is RLS-scoped to the
// member, and each is in the realtime publication (migrations 0002, 0056).
const WATCHED = ['attendance', 'store_visits', 'support_messages', 'notification_deliveries'] as const

export function useDashboardRefresh(activeShift: boolean) {
  const router = useRouter()
  const refreshing = useRef(false)
  const timer = useRef<number | null>(null)

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
      }, 1500)
    }

    // Coalesce a burst of row changes (a clock-in writes several rows at
    // once) into a single refresh a short beat later.
    const nudge = () => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(refresh, 400)
    }

    // Realtime: refresh on any change to the member's own watched rows.
    let channel: ReturnType<ReturnType<typeof supabase>['channel']> | null = null
    try {
      const client = supabase()
      let ch = client.channel('field-dashboard')
      for (const table of WATCHED) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, nudge)
      }
      channel = ch.subscribe()
    } catch {
      // Realtime unavailable (blocked socket, old webview): the poll covers it.
    }

    // Safety net. Realtime is the fast path, so this is deliberately slow.
    const interval = window.setInterval(refresh, activeShift ? 45000 : 120000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onOnline = () => refresh()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      window.clearInterval(interval)
      if (timer.current) window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      if (channel) void supabase().removeChannel(channel)
    }
  }, [activeShift, router])
}
