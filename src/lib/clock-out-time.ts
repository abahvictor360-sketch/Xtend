/**
 * No clocking out before it is time (0109). Pure, so
 * scripts/check-clock-out-time.ts can test it; the database applies the
 * same rule (clock_out_opens_at) and has the last word.
 */

/** The same 15 minutes the early clock-out flag allows (punctuality_grace_minutes). */
export const CLOCK_OUT_GRACE_MINUTES = 15

const hhmm = (t: string | null | undefined) => (t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null)

/**
 * From when they may clock out, "HH:MM" Lagos time: their "can clock out
 * from" time, or 15 minutes before the end of their day. Null when their
 * hours are unknown (then nothing is held back here).
 */
export function clockOutOpensAt(shiftEnd: string | null | undefined, clockOutFrom: string | null | undefined): string | null {
  const from = hhmm(clockOutFrom)
  if (from) return from
  const end = hhmm(shiftEnd)
  if (!end) return null
  const mins = Math.max(0, Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - CLOCK_OUT_GRACE_MINUTES)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/** The time now in Lagos, "HH:MM". */
export function lagosClock(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

/** Too early to clock out on their day `date` (YYYY-MM-DD) at `now`? */
export function tooEarlyToClockOut(opensAt: string | null, date: string, now = Date.now()): boolean {
  if (!opensAt) return false
  // Lagos is UTC+1 all year; a day that has passed is never too early.
  return now < Date.parse(`${date}T${opensAt}:00+01:00`)
}

/** What they are told; the database says the first sentence too. */
export function tooEarlyWords(opensAt: string, canVisitStores: boolean, openVisit: string | null): string {
  const first = `It is not time to clock out yet. You can clock out from ${opensAt}.`
  if (!canVisitStores) return `${first} Until then, keep working at your store.`
  if (openVisit) return `${first} You are checked in at ${openVisit}: check out of it when you leave, then check in at your next store.`
  return `${first} Until then, check in and check out at your stores.`
}

/** Reads the time out of the server's refusal (0109), if it sent one. */
export function tooEarlyFromServer(body: unknown): string | null {
  const b = body as { code?: string; opens_at?: unknown } | null
  return b?.code === 'too_early' && typeof b.opens_at === 'string' ? b.opens_at : null
}
