'use client'

import { useEffect, useState } from 'react'
import { BellRing, LogOut, Store } from 'lucide-react'
import { clockOutDue, dayEndAt, msUntilClockOutDue, shiftEndLabel, type ReminderState } from '@/lib/clock-out-reminder'

/** The clock panel listens for this and starts the clock-out (camera after location). */
export const CLOCK_OUT_EVENT = 'xtend:clock-out'

/** Scrolls to the clock panel and starts the clock-out there. */
export function startClockOut() {
  document.getElementById('clock')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  window.dispatchEvent(new Event(CLOCK_OUT_EVENT))
}

/**
 * Once the shift has ended and they are still clocked in, the first thing on
 * the home screen asks them to clock out. It appears by itself if the app
 * is open at the moment the shift ends.
 *
 * A marketer still checked in at a store is asked to check out of it first,
 * the same order as the store visit flow.
 */
export function ClockOutPrompt({
  state,
  openVisitLabel = null,
  onCheckOutFirst,
}: {
  state: ReminderState
  /** The store they are still checked in at, if any. */
  openVisitLabel?: string | null
  onCheckOutFirst?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const { date, shiftEnd, clockedIn, clockedOut } = state

  useEffect(() => {
    // Wake up at the shift end, and again at midnight to take it away.
    const current = { date, shiftEnd, clockedIn, clockedOut }
    const wait = msUntilClockOutDue(current, now)
    const next = wait ?? (clockOutDue(current, now) ? dayEndAt(date) - now : null)
    const timer = next !== null && next > 0 ? window.setTimeout(() => setNow(Date.now()), next + 500) : undefined
    // Phones pause timers in the background; check again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [date, shiftEnd, clockedIn, clockedOut, now])

  if (!clockOutDue(state, now)) return null
  const at = shiftEndLabel(shiftEnd)

  return (
    <section
      role="alert"
      className="brand-surface relative overflow-hidden rounded-[2rem] p-5 shadow-lift"
    >
      <span aria-hidden className="absolute -right-8 -top-10 h-40 w-24 rotate-[25deg] rounded-full bg-white/10" />
      <div className="relative flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">Your shift ended at {at}. Clock out now.</p>
          <p className="mt-1 text-sm text-white/85">
            {openVisitLabel
              ? `You are still checked in at ${openVisitLabel}. Check out of it first, then clock out.`
              : 'Take your clock-out selfie before you leave.'}
          </p>
        </div>
      </div>

      {openVisitLabel ? (
        <button
          type="button"
          onClick={onCheckOutFirst}
          className="relative mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-base font-bold text-brand transition-transform active:scale-[0.99]"
        >
          <Store className="h-5 w-5 shrink-0" />
          <span className="truncate">Check out of {openVisitLabel}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={startClockOut}
          className="relative mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-base font-bold text-brand transition-transform active:scale-[0.99]"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          Clock out
        </button>
      )}
    </section>
  )
}
