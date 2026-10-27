/**
 * Five-minute heads-ups (migration 0069): "Time to clock in" five minutes
 * before the shift starts, and "Your shift ends at HH:MM" five minutes
 * before it ends. The database decides who is sent a push
 * (claim_shift_soon_reminders); this file holds the same timing for the
 * phone screen, and the wording of the pushes.
 *
 * Plain functions so the browser, the server and the check script
 * (scripts/check-shift-reminders.ts) all use the same rules.
 */
import { dayEndAt, shiftEndAt, shiftEndLabel } from '@/lib/clock-out-reminder'

/** The shift start for somebody with no store (a store's own default too). */
export const DEFAULT_SHIFT_START = '08:00'

/** How many minutes before the start or end the heads-up comes. */
export const HEADS_UP_MIN = 5

export type SoonStage = 'clock_in_soon' | 'clock_out_soon'

/** "08:00:00" or "8:00" → "08:00"; null when the time is unusable. */
function timeLabel(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** The shift start as HH:MM; anything unusable → the 08:00 default. */
export function shiftStartLabel(shiftStart: string | null | undefined): string {
  return timeLabel(shiftStart) ?? DEFAULT_SHIFT_START
}

/** The moment the shift starts on that Lagos date, in ms since the epoch. */
export function shiftStartAt(date: string, shiftStart: string | null | undefined): number {
  return shiftEndAt(date, shiftStartLabel(shiftStart))
}

export interface SoonState {
  /** Today's Lagos business date. */
  date: string
  /** The home store's times; null for somebody with no store. */
  shiftStart: string | null | undefined
  shiftEnd: string | null | undefined
  clockedIn: boolean
  clockedOut: boolean
  /** A working day (not a day off, not leave). */
  workingDay: boolean
}

/** Inside [time - 5 min, time) on the same Lagos day. */
function inHeadsUp(at: number, date: string, now: number): boolean {
  return now >= at - HEADS_UP_MIN * 60_000 && now < at && now < dayEndAt(date)
}

/** Should the phone say "your shift starts soon"? */
export function clockInSoon(state: SoonState, now: number): boolean {
  if (state.clockedIn || !state.workingDay) return false
  return inHeadsUp(shiftStartAt(state.date, state.shiftStart), state.date, now)
}

/** Should the phone say "your shift ends soon"? */
export function clockOutSoon(state: SoonState, now: number): boolean {
  if (!state.clockedIn || state.clockedOut) return false
  return inHeadsUp(shiftEndAt(state.date, state.shiftEnd), state.date, now)
}

/**
 * Milliseconds until the next moment the heads-ups change (one starts or
 * ends), so an open app can show and hide them without a reload; null when
 * nothing more changes today.
 */
export function msUntilSoonChange(state: SoonState, now: number): number | null {
  const marks: number[] = []
  if (!state.clockedIn && state.workingDay) {
    const start = shiftStartAt(state.date, state.shiftStart)
    marks.push(start - HEADS_UP_MIN * 60_000, start)
  }
  if (!state.clockedOut) {
    const end = shiftEndAt(state.date, state.shiftEnd)
    marks.push(end - HEADS_UP_MIN * 60_000, end)
  }
  const next = marks.filter((m) => m > now && m < dayEndAt(state.date)).sort((a, b) => a - b)[0]
  return next === undefined ? null : next - now
}

/**
 * Which heads-up the job would send now, given those already sent today;
 * null outside the five minutes. A late job sends none once the time has
 * passed (the reminder at the shift end covers a missed clock-out one).
 */
export function soonDue(state: SoonState, now: number, sent: SoonStage[] = []): SoonStage | null {
  const stage: SoonStage | null = clockInSoon(state, now) ? 'clock_in_soon' : clockOutSoon(state, now) ? 'clock_out_soon' : null
  return stage && !sent.includes(stage) ? stage : null
}

/** The push for each heads-up. */
export function soonMessage(stage: SoonStage, shiftTime: string | null | undefined, store?: string | null) {
  if (stage === 'clock_in_soon') {
    const at = shiftStartLabel(shiftTime)
    const where = store?.trim() ? ` at ${store.trim()}` : ''
    return {
      title: 'Time to clock in',
      body: `Your shift${where} starts at ${at}. Clock in with a selfie when you arrive.`,
      url: '/field',
    }
  }
  return {
    title: 'Your shift ends soon',
    body: `Your shift ends at ${shiftEndLabel(shiftTime)}. Get ready to clock out with a selfie.`,
    url: '/field',
  }
}
