/**
 * Work schedules (days on, days off) and leave, worked out the same way as
 * public.day_kind() in migration 059: approved leave first, then a change
 * made for that one date, then the person's weekly pattern, and Monday to
 * Saturday for anyone without one.
 *
 * Pure on purpose (no Supabase, no server-only), so the dashboard reports,
 * the staff calendars and scripts/check-schedules-leave.ts share it.
 */
import { addDays } from '@/lib/utils'

/** 'working': expected at work. 'off': a day off. 'leave': approved leave. */
export type DayKind = 'working' | 'off' | 'leave'

/** Days of the week as Postgres extract(dow): 0 = Sunday … 6 = Saturday. */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6]

/** Monday first, the way people read a week. */
export const WEEKDAYS = [
  { dow: 1, short: 'Mon', long: 'Monday', letter: 'M' },
  { dow: 2, short: 'Tue', long: 'Tuesday', letter: 'T' },
  { dow: 3, short: 'Wed', long: 'Wednesday', letter: 'W' },
  { dow: 4, short: 'Thu', long: 'Thursday', letter: 'T' },
  { dow: 5, short: 'Fri', long: 'Friday', letter: 'F' },
  { dow: 6, short: 'Sat', long: 'Saturday', letter: 'S' },
  { dow: 0, short: 'Sun', long: 'Sunday', letter: 'S' },
] as const

export interface PatternRow {
  user_id: string
  days: number[]
}

export interface OverrideRow {
  id: string
  user_id: string
  day: string
  working: boolean
  note: string
}

export const LEAVE_KINDS = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  casual: 'Casual leave',
  other: 'Other',
} as const
export type LeaveKind = keyof typeof LEAVE_KINDS
export const isLeaveKind = (v: unknown): v is LeaveKind => typeof v === 'string' && v in LEAVE_KINDS

export const LEAVE_STATUS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const
export type LeaveStatus = keyof typeof LEAVE_STATUS
export const isLeaveStatus = (v: unknown): v is LeaveStatus => typeof v === 'string' && v in LEAVE_STATUS

export interface LeaveRow {
  id: string
  user_id: string
  kind: LeaveKind
  from_date: string
  to_date: string
  reason: string
  status: LeaveStatus
  decision_note: string
  decided_at: string | null
  created_at: string
}

/** Limits, the same as apply_leave() in migration 059. */
export const LEAVE_LIMITS = {
  /** How far back the first day may be. */
  backDays: 7,
  /** How far ahead the last day may be. */
  aheadDays: 365,
  /** Days one request may cover. */
  maxDays: 60,
  reasonMin: 3,
  reasonMax: 1000,
} as const

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD. */
export function dow(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Days from `from` to `to`, both counted. */
export function daysInclusive(from: string, to: string) {
  const ms = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  return Math.round((ms(to) - ms(from)) / 86_400_000) + 1
}

/** The days of a pattern, cleaned: 0-6 only, once each, in order. */
export function cleanDays(days: readonly number[]) {
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
}

export function samePattern(a: readonly number[], b: readonly number[]) {
  const x = cleanDays(a)
  const y = cleanDays(b)
  return x.length === y.length && x.every((d, i) => d === y[i])
}

/**
 * A pattern in words: "Mon–Sat", "Mon–Fri", "Every day", "Mon, Wed, Fri",
 * "No working days". Runs of three or more days are joined with a dash.
 */
export function patternText(days: readonly number[]) {
  const set = new Set(cleanDays(days))
  if (set.size === 7) return 'Every day'
  if (set.size === 0) return 'No working days'
  const order = WEEKDAYS.map((w) => w.dow)
  const runs: string[] = []
  let i = 0
  while (i < order.length) {
    if (!set.has(order[i])) {
      i++
      continue
    }
    let j = i
    while (j + 1 < order.length && set.has(order[j + 1])) j++
    const len = j - i + 1
    const name = (k: number) => WEEKDAYS[k].short
    if (len >= 3) runs.push(`${name(i)}–${name(j)}`)
    else for (let k = i; k <= j; k++) runs.push(name(k))
    i = j + 1
  }
  return runs.join(', ')
}

/** Lookups for many people at once: what the reports read. */
export interface ScheduleBook {
  kind(userId: string, date: string): DayKind
  /** The weekly pattern in force (the default when none is set). */
  pattern(userId: string): number[]
  /** Whether the person has their own pattern rather than the default. */
  hasPattern(userId: string): boolean
}

export function makeSchedule(
  patterns: PatternRow[] = [],
  overrides: Pick<OverrideRow, 'user_id' | 'day' | 'working'>[] = [],
  leave: Pick<LeaveRow, 'user_id' | 'from_date' | 'to_date' | 'status'>[] = [],
): ScheduleBook {
  const byUser = new Map(patterns.map((p) => [p.user_id, new Set(cleanDays(p.days))]))
  const one = new Map(overrides.map((o) => [`${o.user_id}|${o.day}`, o.working]))
  const approved = new Map<string, { from: string; to: string }[]>()
  for (const l of leave) {
    if (l.status !== 'approved') continue
    approved.set(l.user_id, [...(approved.get(l.user_id) ?? []), { from: l.from_date, to: l.to_date }])
  }
  const fallback = new Set(DEFAULT_WORK_DAYS)
  return {
    kind(userId, date) {
      if ((approved.get(userId) ?? []).some((r) => date >= r.from && date <= r.to)) return 'leave'
      const o = one.get(`${userId}|${date}`)
      if (o !== undefined) return o ? 'working' : 'off'
      return (byUser.get(userId) ?? fallback).has(dow(date)) ? 'working' : 'off'
    },
    pattern(userId) {
      return [...(byUser.get(userId) ?? fallback)].sort((a, b) => a - b)
    },
    hasPattern(userId) {
      return byUser.has(userId)
    },
  }
}

/** Everyone on Monday to Saturday, with no changes and no leave. */
export const DEFAULT_SCHEDULE = makeSchedule()

/** Whether two date ranges share a day. */
export function overlaps(a: { from: string; to: string }, b: { from: string; to: string }) {
  return a.from <= b.to && a.to >= b.from
}

/**
 * The same checks apply_leave() makes, for the form to say at once what is
 * wrong. Null when the dates are fine. `existing` is the person's own
 * requests; only pending and approved ones block new dates.
 */
export function leaveDateProblem(
  from: string,
  to: string,
  today: string,
  existing: Pick<LeaveRow, 'from_date' | 'to_date' | 'status'>[] = [],
): string | null {
  const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!ok(from) || !ok(to)) return 'Pick the first and last day of your leave'
  if (to < from) return 'The last day cannot be before the first day'
  if (from < addDays(today, -LEAVE_LIMITS.backDays)) return `Leave can start at most ${LEAVE_LIMITS.backDays} days ago`
  if (to > addDays(today, LEAVE_LIMITS.aheadDays)) return 'Pick dates within the next year'
  if (daysInclusive(from, to) > LEAVE_LIMITS.maxDays) return `One request can cover at most ${LEAVE_LIMITS.maxDays} days`
  const clash = existing.some(
    (l) => (l.status === 'pending' || l.status === 'approved') && overlaps({ from, to }, { from: l.from_date, to: l.to_date }),
  )
  if (clash) return 'You already have leave asked for or approved on some of those days'
  return null
}

/** Waiting requests first, then the soonest leave, then the newest asked. */
export function sortLeave<T extends Pick<LeaveRow, 'status' | 'from_date' | 'created_at'>>(rows: T[]): T[] {
  const rank = (s: LeaveStatus) => (s === 'pending' ? 0 : 1)
  return [...rows].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      (a.status === 'pending' ? a.from_date.localeCompare(b.from_date) : b.from_date.localeCompare(a.from_date)) ||
      b.created_at.localeCompare(a.created_at),
  )
}

/* ------------------------------------------------------------------ */
/* Staff calendars                                                     */
/* ------------------------------------------------------------------ */

/** One day as public.my_calendar() returns it. */
export interface CalendarDay {
  day: string
  kind: DayKind
  clocked_in: boolean
  missed: boolean
}

/**
 * How a day looks on the staff app's calendars.
 *   worked: clocked in (whatever the schedule said);
 *   missed: a past working day with no clock-in (red);
 *   off: a day off (grey);
 *   leave: approved leave (soft orange);
 *   plain: today or a future working day, or before they joined.
 */
export type CalendarMark = 'worked' | 'missed' | 'off' | 'leave' | 'plain'

export function calendarMark(d: CalendarDay | undefined): CalendarMark {
  if (!d) return 'plain'
  if (d.clocked_in) return 'worked'
  if (d.missed) return 'missed'
  if (d.kind === 'off') return 'off'
  if (d.kind === 'leave') return 'leave'
  return 'plain'
}

export const MARK_LABEL: Record<CalendarMark, string> = {
  worked: 'Worked',
  missed: 'Missed',
  off: 'Day off',
  leave: 'Leave',
  plain: '',
}

/**
 * The same verdict without the database, for the check script and for a
 * page that already has the pieces: a past working day on or after the day
 * the account was made, with no clock-in, is missed.
 */
export function isMissed(kind: DayKind, date: string, today: string, since: string, clockedIn: boolean) {
  return kind === 'working' && date < today && date >= since && !clockedIn
}

/**
 * A month as weeks, Monday first: each week is seven dates, with null for
 * the days outside the month. `month` is any date in it.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const first = `${month.slice(0, 7)}-01`
  const lead = (dow(first) + 6) % 7
  const weeks: (string | null)[][] = []
  let week: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) {
    week.push(d)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)])
  return weeks
}

/** 'YYYY-MM-01' of the month before or after. */
export function shiftMonth(month: string, by: number) {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + by
  const date = new Date(Date.UTC(y, m, 1, 12))
  return date.toISOString().slice(0, 10)
}

/** The last day of the month a date is in. */
export function monthEnd(month: string) {
  return addDays(shiftMonth(month, 1), -1)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-20' to 'Tue 20 Oct'. */
export function shortDay(date: string) {
  return `${WEEKDAYS[(dow(date) + 6) % 7].short} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
}

/** 'Tue 20 Oct', or 'Tue 20 Oct to Thu 22 Oct (3 days)'. */
export function leaveRangeText(from: string, to: string) {
  if (from === to) return `${shortDay(from)} (1 day)`
  return `${shortDay(from)} to ${shortDay(to)} (${daysInclusive(from, to)} days)`
}
