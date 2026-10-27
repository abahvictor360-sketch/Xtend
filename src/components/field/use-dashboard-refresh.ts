'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

/**
 * Keep the phone dashboard in step with the backend.
 *
 * The fast path is Supabase realtime Broadcast: a database trigger sends one
 * lightweight event to the member's own private topic `field:<uid>` whenever
 * their attendance, store visit, support message or notification changes
 * (migration 0058). The event carries only { table, op }; the screen re-fetches
 * on it and that fetch goes through RLS, so the socket never carries row data.
 * Broadcast replaces Postgres Changes here because it does not run RLS per
 * subscriber per change, so the same Supabase compute holds far more
 * connections — the thing that caps how many staff can be on shift at once.
 *
 * Behind it sits a slow poll as a safety net for anything realtime can miss:
 * a dropped socket, or a value the server computes only when the page is
 * read. It is far slower than the old 15s poll, because realtime now does the
 * work that used to need constant refreshing, which also makes the app feel
 * quicker and spares the battery and data.
 *
 * At scale (thousands of field staff on shift at once) three things matter:
 *   - Only on-shift members hold a socket (see below); everyone else polls.
 *   - NEXT_PUBLIC_REALTIME_DISABLED=1 turns realtime off fleet-wide and lets
 *     everyone ride the poll instead — a safe release valve if the socket
 *     count is still the thing falling over.
 *   - If every client polled on the same 45s boundary the backend would see a
 *     spike every 45s instead of steady traffic, so the poll is jittered per
 *     client to spread that load out.
 */

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_REALTIME_DISABLED === '1'

// Spread the safety poll around its nominal interval (±30%) so a fleet of
// clients does not stampede the backend on the same tick.
function jitter(ms: number) {
  return Math.round(ms * (0.7 + Math.random() * 0.6))
}

export function useDashboardRefresh(activeShift: boolean, userId: string) {
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

    // Realtime: refresh when the member's own private topic broadcasts a
    // change (migration 0058). Only on-shift members hold a socket — a
    // clocked-out member with the app open rides the poll instead, which keeps
    // the concurrent-connection count down to the people actually working.
    // Skipped entirely when disabled fleet-wide, so no socket is opened.
    let channel: ReturnType<ReturnType<typeof supabase>['channel']> | null = null
    if (!REALTIME_DISABLED && activeShift && userId) {
      try {
        channel = supabase()
          .channel(`field:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'change' }, nudge)
          // 0070: "send a position now" for the location heartbeat. The
          // event carries nothing and nothing is shown.
          .on('broadcast', { event: 'sync' }, () => window.dispatchEvent(new Event('xtend:sync')))
          .subscribe((status) => {
            // SUBSCRIBED => realtime is live, fall back to the slow poll.
            // CHANNEL_ERROR / TIMED_OUT / CLOSED => the socket is not carrying
            // changes (plan connection cap hit, or authorization failed); keep
            // polling on the faster cadence instead of going stale.
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
  }, [activeShift, userId, router])
}
