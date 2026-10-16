/**
 * Clock-out reminders (migration 0061): when the shift has ended and the
 * person is still clocked in, ask them to clock out. The database decides
 * who is sent a push (claim_clock_out_reminders); this file holds the same
 * timing for the phone screen, and the wording of the pushes.
 *
 * Plain functions with no imports so the browser, the server and the check
 * script (scripts/check-clock-out-reminder.ts) all use the same rules.
 */

/** The shift end for somebody with no store. */
export const DEFAULT_SHIFT_END = '18:00'

/** Minutes after the shift end that the second reminder goes. */
export const SECOND_REMINDER_MIN = 60

const LAGOS_OFFSET_MIN = 60 // Africa/Lagos is UTC+1 all year, no daylight saving.

/** "17:00:00" or "17:00" → "17:00"; anything unusable → the 18:00 default. */
export function shiftEndLabel(shiftEnd: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(shiftEnd ?? '')
  if (!m) return DEFAULT_SHIFT_END
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return DEFAULT_SHIFT_END
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** Midnight Lagos at the start of a business date (YYYY-MM-DD), in ms. */
function lagosMidnight(date: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  return Date.UTC(y, mo - 1, d) - LAGOS_OFFSET_MIN * 60_000
}

/** Midnight Lagos at the end of a business date: nothing is asked after it. */
export function dayEndAt(date: string): number {
  return lagosMidnight(date) + 24 * 60 * 60_000
}

/** The moment the shift ends on that Lagos date, in ms since the epoch. */
export function shiftEndAt(date: string, shiftEnd: string | null | undefined): number {
  const [h, m] = shiftEndLabel(shiftEnd).split(':').map(Number)
  return lagosMidnight(date) + (h * 60 + m) * 60_000
}

export interface ReminderState {
  /** The Lagos business date the clock-in belongs to. */
  date: string
  /** The home store's shift end; null for somebody with no store. */
  shiftEnd: string | null | undefined
  clockedIn: boolean
  clockedOut: boolean
}

/**
 * Should the phone ask them to clock out now? True from the shift end until
 * midnight Lagos, while clocked in and not out.
 */
export function clockOutDue(state: ReminderState, now: number): boolean {
  if (!state.clockedIn || state.clockedOut) return false
  return now >= shiftEndAt(state.date, state.shiftEnd) && now < dayEndAt(state.date)
}

/**
 * Milliseconds until the prompt should appear, so an open app can show it
 * without a reload; null when it never will today (already due, clocked
 * out, not clocked in, or the day is over).
 */
export function msUntilClockOutDue(state: ReminderState, now: number): number | null {
  if (!state.clockedIn || state.clockedOut) return null
  const at = shiftEndAt(state.date, state.shiftEnd)
  return at > now ? at - now : null
}

/**
 * Which reminder is due: 1 at the shift end, 2 an hour later, null before
 * the end, after midnight, or once out. `sent` is what has gone already;
 * a late check sends only the latest one due, never one already passed.
 */
export function reminderDue(state: ReminderState, now: number, sent: number[] = []): 1 | 2 | null {
  if (!clockOutDue(state, now)) return null
  const end = shiftEndAt(state.date, state.shiftEnd)
  const stage: 1 | 2 = now >= end + SECOND_REMINDER_MIN * 60_000 ? 2 : 1
  return sent.some((s) => s >= stage) ? null : stage
}

/** The push for each reminder. */
export function reminderMessage(stage: 1 | 2, shiftEnd: string | null | undefined) {
  const at = shiftEndLabel(shiftEnd)
  return stage === 1
    ? {
        title: 'Time to clock out',
        body: `Your shift ended at ${at}. Clock out with a selfie before you leave.`,
        url: '/field',
      }
    : {
        title: 'You have not clocked out yet',
        body: `Your shift ended at ${at}. Please clock out with a selfie now.`,
        url: '/field',
      }
}
