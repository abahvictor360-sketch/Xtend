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
 *
 * At scale (thousands of field staff on shift at once) two things matter:
 *   - Realtime holds one socket per client. Supabase caps concurrent
 *     connections per plan; past the cap new sockets are refused. Set
 *     NEXT_PUBLIC_REALTIME_DISABLED=1 to turn realtime off fleet-wide and let
 *     everyone ride the poll instead — a safe release valve if the socket
 *     count is the thing falling over.
 *   - If every client polls on the same 45s boundary, the backend sees a
 *     spike every 45s instead of steady traffic. The safety poll is jittered
 *     per client to spread that load out.
 */

// Tables the dashboard's state is derived from. Each is RLS-scoped to the
// member, and each is in the realtime publication (migrations 0002, 0056).
const WATCHED = ['attendance', 'store_visits', 'support_messages', 'notification_deliveries'] as const

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_REALTIME_DISABLED === '1'

// Spread the safety poll around its nominal interval (±30%) so a fleet of
// clients does not stampede the backend on the same tick.
function jitter(ms: number) {
  return Math.round(ms * (0.7 + Math.random() * 0.6))
}

export function useDashboardRefresh(activeShift: boolean) {
  const router = useRouter()
  const refreshing = useRef(false)
  const timer = useRef<number | null>(null)
  const pollTimer = useRef<number | null>(null)

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

    // When realtime is carrying changes we can poll slowly (it is just a
    // safety net). When it is off or has failed, the poll is the only path,
    // so it runs quicker. Both are jittered per client.
    let realtimeLive = false
    const base = () => {
      const fast = !realtimeLive // realtime off/failed: poll is the live path
      return activeShift ? (fast ? 20000 : 45000) : fast ? 60000 : 120000
    }
    const schedulePoll = () => {
      pollTimer.current = window.setTimeout(() => {
        refresh()
        schedulePoll()
      }, jitter(base()))
    }
    schedulePoll()

    // Realtime: refresh on any change to the member's own watched rows.
    // Skipped entirely when disabled fleet-wide, so no socket is opened.
    let channel: ReturnType<ReturnType<typeof supabase>['channel']> | null = null
    if (!REALTIME_DISABLED) {
      try {
        const client = supabase()
        let ch = client.channel('field-dashboard')
        for (const table of WATCHED) {
          ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, nudge)
        }
        channel = ch.subscribe((status) => {
          // SUBSCRIBED => realtime is live, fall back to the slow poll.
          // CHANNEL_ERROR / TIMED_OUT / CLOSED => socket is not carrying
          // changes (e.g. the plan's connection cap was hit); keep polling
          // on the faster cadence instead of going stale.
          realtimeLive = status === 'SUBSCRIBED'
        })
      } catch {
        // Realtime unavailable (blocked socket, old webview): the poll covers it.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onOnline = () => refresh()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
      if (timer.current) window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      if (channel) void supabase().removeChannel(channel)
    }
  }, [activeShift, router])
}
