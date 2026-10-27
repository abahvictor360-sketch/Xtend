'use client'

import { useEffect, useState } from 'react'
import { AlarmClock, LogIn } from 'lucide-react'
import { shiftEndLabel } from '@/lib/clock-out-reminder'
import { clockInSoon, clockOutSoon, msUntilSoonChange, shiftStartLabel, type SoonState } from '@/lib/shift-reminder'

/** Scrolls to the clock panel and puts the focus on its button. */
export function focusClockButton() {
  document.getElementById('clock')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  window.setTimeout(() => document.getElementById('clock-button')?.focus({ preventScroll: true }), 400)
}

/**
 * The five minutes before the shift starts (not clocked in yet, a working
 * day): a gentle card with a Clock in button that takes them to the clock
 * panel. The five minutes before it ends (clocked in): a heads-up line.
 * Both appear and go by themselves while the app is open.
 */
export function ShiftSoonPrompt({ state }: { state: SoonState }) {
  const [now, setNow] = useState(() => Date.now())
  const { date, shiftStart, shiftEnd, clockedIn, clockedOut, workingDay } = state

  useEffect(() => {
    const wait = msUntilSoonChange({ date, shiftStart, shiftEnd, clockedIn, clockedOut, workingDay }, now)
    const timer = wait !== null ? window.setTimeout(() => setNow(Date.now()), wait + 500) : undefined
    // Phones pause timers in the background; check again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [date, shiftStart, shiftEnd, clockedIn, clockedOut, workingDay, now])

  if (clockInSoon(state, now)) {
    return (
      <section role="status" className="rounded-[2rem] border border-brand/25 bg-tint p-4 text-tint-foreground">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-brand">
            <AlarmClock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-tight">
              Your shift starts at {shiftStartLabel(shiftStart)}.
            </p>
            <p className="mt-0.5 text-sm">Clock in when you arrive.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={focusClockButton}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-primary-foreground transition-transform active:scale-[0.99]"
        >
          <LogIn className="h-4 w-4 shrink-0" />
          Clock in
        </button>
      </section>
    )
  }

  if (clockOutSoon(state, now)) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-2xl bg-tint px-3 py-2.5 text-tint-foreground">
        <AlarmClock className="h-4 w-4 shrink-0 text-brand" />
        <p className="text-sm leading-snug">
          <span className="font-semibold">Your shift ends at {shiftEndLabel(shiftEnd)}.</span> Get ready to clock out.
        </p>
      </div>
    )
  }

  return null
}
