/**
 * Attendance, worked out day by day: who came, who was late, who clocked in
 * away from their store, who never clocked out and who did not come at all.
 * The Attendance and Analytics pages and their downloads all read from here.
 *
 * Pure on purpose (no Supabase, no server-only), so
 * scripts/check-attendance.ts can run it on made-up days.
 */
import { addDays } from '@/lib/utils'

/** The fields of an attendance_detail row this file reads. */
export interface ClockEvent {
  id: string
  user_id: string
  attendance_date: string
  type: 'opening' | 'closing'
  created_at: string
  /** 'YYYY-MM-DD HH:MI' in Africa/Lagos. */
  local_time: string
  outlet_id: string | null
  outlet_name: string | null
  /** 'HH:MM:SS' of the clock-in store, or null. */
  shift_start: string | null
  status: 'on_site' | 'off_site' | 'flagged' | null
  distance_m: number | null
  is_late: boolean
  client_captured_at: string
}

/** A merchandiser or marketer, as the reports group them. */
export interface Person {
  id: string
  name: string
  phone: string | null
  /** 'merchandiser' or 'marketer'. */
  role: string
  /** The name people see: an added role's name, or the built-in one. */
  roleLabel: string
  /** Built-in role, or 'custom:<id>' for an added one. */
  roleValue: string
  outletId: string | null
  outletName: string | null
  /** Who they report to (profiles.supervisor_id). */
  teamId: string | null
  teamName: string | null
  active: boolean
  /** The Lagos day their account was made; no absences before it. */
  since: string
}

/**
 * How a day reads at a glance. Off site wins over late: being somewhere
 * else matters more than being somewhere a few minutes after time.
 * 'rest' is a Sunday nobody expected them; 'none' is a day before they
 * joined, or after they were switched off, with nothing recorded.
 */
export type DayStatus = 'on_time' | 'late' | 'off_site' | 'absent' | 'rest' | 'none'

export interface DayRecord<E extends ClockEvent = ClockEvent> {
  key: string
  userId: string
  date: string
  status: DayStatus
  present: boolean
  late: boolean
  /** Clocked in outside the store's circle, or the clock-in was flagged. */
  offSite: boolean
  flagged: boolean
  /** Clocked in, never clocked out, and the day is over. */
  missingOut: boolean
  /** Clocked in today and not out yet. */
  onShift: boolean
  minutesLate: number | null
  /** Minutes after midnight, Lagos, of the clock-in. */
  inMinutes: number | null
  hours: number | null
  /** Minutes between the phone taking the clock-in and the server getting it. */
  sentLateMin: number | null
  /** The store of the clock-in, or the person's own store on a day without one. */
  outletId: string | null
  outletName: string | null
  clockIn: E | null
  clockOut: E | null
}

export interface ReportOptions {
  today: string
  /** Whether a Sunday without a clock-in counts as an absence. */
  sundays: boolean
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD. */
export function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Every day from `from` to `to`, both included, at most `max`. */
export function dayList(from: string, to: string, max = 400) {
  const days: string[] = []
  for (let d = from; d <= to && days.length < max; d = addDays(d, 1)) days.push(d)
  return days
}

export function dayCount(from: string, to: string) {
  const [a, b] = [from, to].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
  return Math.round((b - a) / 86_400_000) + 1
}

/** The same number of days straight before, for "compared with". */
export function previousPeriod(from: string, to: string) {
  const n = dayCount(from, to)
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

export function isWorkingDay(date: string, sundays: boolean) {
  return sundays || weekday(date) !== 0
}

export interface Preset {
  key: string
  label: string
  from: string
  to: string
}

/** Quick ranges, Monday-start weeks, ending today at the latest. */
export function presets(today: string, keys: string[]): Preset[] {
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(monthStart, -1)
  const all: Record<string, Omit<Preset, 'key'>> = {
    today: { label: 'Today', from: today, to: today },
    yesterday: { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    week: { label: 'This week', from: monday, to: today },
    last_week: { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    '7d': { label: 'Last 7 days', from: addDays(today, -6), to: today },
    '30d': { label: 'Last 30 days', from: addDays(today, -29), to: today },
    '90d': { label: 'Last 90 days', from: addDays(today, -89), to: today },
    month: { label: 'This month', from: monthStart, to: today },
    last_month: { label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  }
  return keys.filter((k) => k in all).map((k) => ({ key: k, ...all[k] }))
}

/**
 * The range asked for, made sensible: real dates, never after today, `to`
 * not before `from`, and no longer than `maxDays` (the end is kept, the
 * start moved).
 */
export function cleanRange(
  from: unknown,
  to: unknown,
  today: string,
  fallback: { from: string; to: string },
  maxDays: number,
) {
  let end = isDate(to) ? (to > today ? today : to) : isDate(from) ? today : fallback.to
  let start = isDate(from) ? from : isDate(to) ? end : fallback.from
  if (start > end) [start, end] = [end, start]
  if (start > today) start = today
  const clipped = dayCount(start, end) > maxDays
  if (clipped) start = addDays(end, -(maxDays - 1))
  return { from: start, to: end, clipped }
}

/* ------------------------------------------------------------------ */
/* Times                                                               */
/* ------------------------------------------------------------------ */

/** '2026-10-08 08:05' or '08:05:00' to minutes after midnight. */
export function minutesOf(value: string | null | undefined) {
  const m = /(\d{2}):(\d{2})(?::\d{2})?$/.exec(value ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Minutes after midnight to '08:05'. */
export function clock(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const m = Math.round(minutes)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** 75 to '1 h 15 min', 40 to '40 min'. */
export function lateness(minutes: number) {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

export function hoursText(hours: number | null) {
  if (hours === null) return '—'
  const m = Math.round(hours * 60)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** A short name for the phone from device_info, for the detail rows. */
export function deviceText(info: unknown) {
  const d = (info ?? {}) as { ua?: string; native?: { platform?: string } | null }
  const ua = d.ua ?? ''
  const android = /Android\s?(\d+)?/.exec(ua)
  const os = android
    ? `Android${android[1] ? ` ${android[1]}` : ''}`
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows computer'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : null
  // Android browsers name the handset before "Build/", e.g. "TECNO KG5".
  const model = /;\s*([^;()]+?)\s+Build\//.exec(ua)?.[1] ?? null
  const via = d.native ? 'the Xtend app' : ua ? 'a web browser' : null
  const phone = [model, os].filter(Boolean).join(', ')
  if (!phone && !via) return 'Not reported'
  return [phone || 'Unknown phone', via ? `in ${via}` : null].filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ */
/* Days                                                                */
/* ------------------------------------------------------------------ */

/**
 * One record per person per day of `days`. The first clock-in of the day
 * and the last clock-out are the ones that count; events for people not
 * in `people` are left out.
 */
export function buildDays<E extends ClockEvent>(
  people: Person[],
  events: E[],
  days: string[],
  opts: ReportOptions,
): DayRecord<E>[] {
  const byKey = new Map<string, { ins: E[]; outs: E[] }>()
  for (const e of events) {
    const key = `${e.user_id}|${e.attendance_date}`
    const slot = byKey.get(key) ?? { ins: [], outs: [] }
    ;(e.type === 'opening' ? slot.ins : slot.outs).push(e)
    byKey.set(key, slot)
  }
  const earliest = (list: E[]) => list.reduce<E | null>((a, e) => (!a || e.created_at < a.created_at ? e : a), null)
  const latest = (list: E[]) => list.reduce<E | null>((a, e) => (!a || e.created_at > a.created_at ? e : a), null)

  const records: DayRecord<E>[] = []
  for (const p of people) {
    for (const date of days) {
      const slot = byKey.get(`${p.id}|${date}`)
      const clockIn = slot ? earliest(slot.ins) : null
      const clockOut = slot ? latest(slot.outs.filter((o) => !clockIn || o.created_at >= clockIn.created_at)) : null
      const present = Boolean(clockIn)
      const offSite = Boolean(clockIn && clockIn.status && clockIn.status !== 'on_site')
      const late = Boolean(clockIn?.is_late)
      const inMinutes = clockIn ? minutesOf(clockIn.local_time) : null
      const shift = clockIn ? minutesOf(clockIn.shift_start) : null
      let status: DayStatus
      if (present) status = offSite ? 'off_site' : late ? 'late' : 'on_time'
      else if (date > opts.today || date < p.since || !p.active) status = 'none'
      else if (!isWorkingDay(date, opts.sundays)) status = 'rest'
      else status = 'absent'

      records.push({
        key: `${p.id}|${date}`,
        userId: p.id,
        date,
        status,
        present,
        late,
        offSite,
        flagged: clockIn?.status === 'flagged',
        missingOut: present && !clockOut && date < opts.today,
        onShift: present && !clockOut && date === opts.today,
        minutesLate: late && inMinutes !== null && shift !== null ? Math.max(0, inMinutes - shift) : null,
        inMinutes,
        hours:
          clockIn && clockOut
            ? Math.max(0, (Date.parse(clockOut.created_at) - Date.parse(clockIn.created_at)) / 3_600_000)
            : null,
        sentLateMin: clockIn
          ? Math.max(0, Math.round((Date.parse(clockIn.created_at) - Date.parse(clockIn.client_captured_at)) / 60_000))
          : null,
        outletId: clockIn?.outlet_id ?? p.outletId,
        outletName: clockIn?.outlet_name ?? p.outletName,
        clockIn,
        clockOut,
      })
    }
  }
  return records
}

/** Days that say something: present, or absent on a working day. */
export const counted = (r: DayRecord) => r.present || r.status === 'absent'

export const STATUS_FILTERS = {
  on_time: 'On time',
  late: 'Late',
  off_site: 'Off site or flagged',
  flagged: 'Flagged',
  missing_out: 'No clock-out',
  absent: 'Absent / not in',
  present: 'Came in (any)',
} as const
export type StatusFilter = keyof typeof STATUS_FILTERS
export const isStatusFilter = (v: unknown): v is StatusFilter => typeof v === 'string' && v in STATUS_FILTERS

export function matchesStatus(r: DayRecord, status: StatusFilter | null) {
  if (!counted(r)) return false
  switch (status) {
    case null:
      return true
    case 'on_time':
      return r.present && !r.late && !r.offSite
    case 'late':
      return r.late
    case 'off_site':
      return r.offSite
    case 'flagged':
      return r.flagged
    case 'missing_out':
      return r.missingOut
    case 'absent':
      return r.status === 'absent'
    case 'present':
      return r.present
  }
}

export interface Summary {
  people: number
  /** Present plus absent: the days somebody was expected. */
  expected: number
  present: number
  absent: number
  onTime: number
  late: number
  offSite: number
  flagged: number
  missingOut: number
  /** Share of clock-ins that were on time, 0-100, or null with none. */
  punctuality: number | null
  /** Share of expected days they came, 0-100, or null. */
  turnout: number | null
  avgIn: number | null
  avgLateMin: number | null
  avgHours: number | null
}

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : null)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function summarise(records: DayRecord[]): Summary {
  const real = records.filter(counted)
  const present = real.filter((r) => r.present)
  const late = present.filter((r) => r.late)
  const onTime = present.length - late.length
  return {
    people: new Set(real.map((r) => r.userId)).size,
    expected: real.length,
    present: present.length,
    absent: real.length - present.length,
    onTime,
    late: late.length,
    offSite: present.filter((r) => r.offSite).length,
    flagged: present.filter((r) => r.flagged).length,
    missingOut: present.filter((r) => r.missingOut).length,
    punctuality: pct(onTime, present.length),
    turnout: pct(present.length, real.length),
    avgIn: mean(present.map((r) => r.inMinutes).filter((m): m is number => m !== null)),
    avgLateMin: mean(late.map((r) => r.minutesLate).filter((m): m is number => m !== null)),
    avgHours: mean(present.map((r) => r.hours).filter((h): h is number => h !== null)),
  }
}

/** A whole-number percentage, or a dash. */
export const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export const SORTS = ['date', 'name', 'store', 'in', 'out', 'late', 'distance', 'hours'] as const
export type SortKey = (typeof SORTS)[number]
export const isSortKey = (v: unknown): v is SortKey => SORTS.includes(v as SortKey)

/** Newest day first by default; blanks always last whichever way. */
export function sortDays<E extends ClockEvent>(
  records: DayRecord<E>[],
  names: Map<string, string>,
  key: SortKey,
  dir: 'asc' | 'desc',
) {
  const value = (r: DayRecord<E>): string | number | null => {
    switch (key) {
      case 'date':
        return r.date
      case 'name':
        return names.get(r.userId) ?? ''
      case 'store':
        return r.outletName
      case 'in':
        return r.inMinutes
      case 'out':
        return r.clockOut ? minutesOf(r.clockOut.local_time) : null
      case 'late':
        return r.minutesLate ?? (r.present ? 0 : null)
      case 'distance':
        return r.clockIn?.distance_m ?? null
      case 'hours':
        return r.hours
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...records].sort((a, b) => {
    const [x, y] = [value(a), value(b)]
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1
    } else if (x !== y) {
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign
    }
    // Ties: newest day, then name.
    return b.date.localeCompare(a.date) || (names.get(a.userId) ?? '').localeCompare(names.get(b.userId) ?? '')
  })
}

/* ------------------------------------------------------------------ */
/* Worth a look                                                        */
/* ------------------------------------------------------------------ */

export interface Concern {
  userId: string
  name: string
  kind: 'absent' | 'late' | 'off_site' | 'missing_out' | 'sent_late'
  count: number
  /** The days it happened, oldest first. */
  dates: string[]
  text: string
}

/** How many times in the range before a pattern is called out. */
export const CONCERN_AT = { absent: 2, late: 3, off_site: 2, missing_out: 2, sent_late: 2 } as const
/** A clock-in that reached the server this many minutes after it was taken. */
export const SENT_LATE_MIN = 30

/**
 * Patterns worth a conversation, biggest first: repeated absences,
 * lateness, clocking in away from the store, never clocking out, and
 * clock-ins saved on the phone and sent much later.
 */
export function concerns(records: DayRecord[], people: Person[], limit = 10): Concern[] {
  const name = new Map(people.map((p) => [p.id, p.name]))
  const tally = new Map<string, Concern>()
  const add = (r: DayRecord, kind: Concern['kind']) => {
    const key = `${r.userId}|${kind}`
    const c = tally.get(key) ?? { userId: r.userId, name: name.get(r.userId) ?? 'Someone', kind, count: 0, dates: [], text: '' }
    c.count += 1
    c.dates.push(r.date)
    tally.set(key, c)
  }
  for (const r of records) {
    if (r.status === 'absent') add(r, 'absent')
    if (r.late) add(r, 'late')
    if (r.offSite) add(r, 'off_site')
    if (r.missingOut) add(r, 'missing_out')
    if ((r.sentLateMin ?? 0) >= SENT_LATE_MIN) add(r, 'sent_late')
  }
  const lateMins = new Map<string, number[]>()
  for (const r of records) {
    if (r.minutesLate !== null) lateMins.set(r.userId, [...(lateMins.get(r.userId) ?? []), r.minutesLate])
  }
  const weight = { absent: 5, off_site: 4, sent_late: 3, missing_out: 2, late: 1 }
  return [...tally.values()]
    .filter((c) => c.count >= CONCERN_AT[c.kind])
    .map((c) => {
      c.dates.sort()
      const n = `${c.count} day${c.count === 1 ? '' : 's'}`
      const avg = mean(lateMins.get(c.userId) ?? [])
      c.text = {
        absent: `${c.name} did not clock in on ${n}.`,
        late: `${c.name} was late on ${n}${avg !== null ? `, by ${lateness(avg)} on average` : ''}.`,
        off_site: `${c.name} clocked in away from their store (or was flagged) on ${n}.`,
        missing_out: `${c.name} did not clock out on ${n}.`,
        sent_late: `${c.name}'s clock-in reached Xtend ${SENT_LATE_MIN}+ minutes after the photo was taken on ${n}. Saved with no network, or worth asking about.`,
      }[c.kind]
      return c
    })
    .sort((a, b) => b.count * weight[b.kind] - a.count * weight[a.kind] || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* Grouping and analytics                                              */
/* ------------------------------------------------------------------ */

export type GroupBy = 'person' | 'store' | 'team'
export const isGroupBy = (v: unknown): v is GroupBy => v === 'person' || v === 'store' || v === 'team'

export interface GroupRow extends Summary {
  key: string
  label: string
}

/**
 * Totals per person, per store (the store of the clock-in, or their own
 * store on a day they did not come) or per team (who they report to).
 */
export function group(records: DayRecord[], people: Person[], by: GroupBy): GroupRow[] {
  const person = new Map(people.map((p) => [p.id, p]))
  const buckets = new Map<string, { label: string; rows: DayRecord[] }>()
  for (const r of records) {
    if (!counted(r)) continue
    const p = person.get(r.userId)
    const [key, label] =
      by === 'person'
        ? [r.userId, p?.name ?? 'Someone']
        : by === 'store'
          ? [r.outletId ?? 'none', r.outletName ?? 'No store']
          : [p?.teamId ?? 'none', p?.teamName ?? 'No supervisor']
    const b = buckets.get(key) ?? { label, rows: [] }
    b.rows.push(r)
    buckets.set(key, b)
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, ...summarise(b.rows) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** The top `n` by a figure, highest first, leaving out rows that have none. */
export function leaders<T extends GroupRow>(rows: T[], pick: (r: T) => number | null, n = 5, lowest = false) {
  return rows
    .filter((r) => (pick(r) ?? 0) > 0 || (lowest && pick(r) !== null))
    .sort((a, b) => ((pick(b) ?? 0) - (pick(a) ?? 0)) * (lowest ? -1 : 1) || a.label.localeCompare(b.label))
    .slice(0, n)
}

export interface TrendPoint {
  /** First day of the bucket. */
  date: string
  label: string
  long: string
  onTime: number
  late: number
  absent: number
  offSite: number
  missingOut: number
  punctuality: number | null
  turnout: number | null
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayMonth = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`

/** Day by day, or week by week (Monday start) once the range passes `weekly` days. */
export function trend(records: DayRecord[], days: string[], weekly = 45): TrendPoint[] {
  const byWeek = days.length > weekly
  const bucketOf = (d: string) => (byWeek ? addDays(d, -((weekday(d) + 6) % 7)) : d)
  const buckets = new Map<string, DayRecord[]>()
  for (const d of days) buckets.set(bucketOf(d), [])
  for (const r of records) buckets.get(bucketOf(r.date))?.push(r)
  return [...buckets.entries()].map(([date, rows]) => {
    const s = summarise(rows)
    return {
      date,
      label: byWeek ? dayMonth(date) : days.length > 10 ? String(Number(date.slice(8, 10))) : SHORT_DAY[weekday(date)],
      long: byWeek ? `Week of ${LONG_DAY[weekday(date)]} ${dayMonth(date)}` : `${LONG_DAY[weekday(date)]}, ${dayMonth(date)}`,
      onTime: s.onTime,
      late: s.late,
      absent: s.absent,
      offSite: s.offSite,
      missingOut: s.missingOut,
      punctuality: s.punctuality,
      turnout: s.turnout,
    }
  })
}

export interface WeekdayRow {
  day: number
  label: string
  long: string
  present: number
  late: number
  absent: number
  punctuality: number | null
  turnout: number | null
}

/** Monday to Sunday: how on time and how present each weekday is. */
export function byWeekday(records: DayRecord[]): WeekdayRow[] {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const s = summarise(records.filter((r) => weekday(r.date) === day))
    return {
      day,
      label: SHORT_DAY[day],
      long: LONG_DAY[day],
      present: s.present,
      late: s.late,
      absent: s.absent,
      punctuality: s.punctuality,
      turnout: s.turnout,
    }
  })
}

export interface HourRow {
  hour: number
  label: string
  onTime: number
  late: number
}

/**
 * Clock-ins by the hour they happened, from the earliest to the latest hour
 * seen (at least 06:00 to 11:00, so a quiet week still has a shape).
 */
export function byHour(records: DayRecord[]): HourRow[] {
  const ins = records.filter((r) => r.present && r.inMinutes !== null)
  const hours = ins.map((r) => Math.floor(r.inMinutes! / 60))
  const lo = Math.min(6, ...hours)
  const hi = Math.max(11, ...hours)
  const rows: HourRow[] = []
  for (let h = lo; h <= hi; h++) {
    const here = ins.filter((r) => Math.floor(r.inMinutes! / 60) === h)
    rows.push({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      onTime: here.filter((r) => !r.late).length,
      late: here.filter((r) => r.late).length,
    })
  }
  return rows
}

export interface StoreCover {
  id: string
  name: string
  /** People whose own store this is. */
  people: number
  /** Working days somebody clocked in there. */
  covered: number
  workingDays: number
  pct: number | null
  lastIn: string | null
  /** Working days nobody clocked in there, oldest first. */
  gaps: string[]
}

/**
 * For each store: on how many working days at least one person clocked in
 * there. Only stores that belong to the people in view are listed, so a
 * supervisor sees their team's stores and not every store in Lagos.
 */
export function storeCoverage(
  records: DayRecord[],
  people: Person[],
  days: string[],
  opts: ReportOptions,
): StoreCover[] {
  const working = days.filter((d) => d <= opts.today && isWorkingDay(d, opts.sundays))
  const stores = new Map<string, { name: string; people: Set<string>; dates: Set<string>; last: string | null }>()
  const ensure = (id: string, name: string) => {
    const s = stores.get(id) ?? { name, people: new Set<string>(), dates: new Set<string>(), last: null }
    stores.set(id, s)
    return s
  }
  for (const p of people) if (p.outletId && p.active) ensure(p.outletId, p.outletName ?? 'Store').people.add(p.id)
  for (const r of records) {
    if (!r.present || !r.clockIn?.outlet_id) continue
    const s = ensure(r.clockIn.outlet_id, r.clockIn.outlet_name ?? 'Store')
    s.dates.add(r.date)
    if (!s.last || r.date > s.last) s.last = r.date
  }
  return [...stores.entries()]
    .map(([id, s]) => {
      const covered = working.filter((d) => s.dates.has(d)).length
      return {
        id,
        name: s.name,
        people: s.people.size,
        covered,
        workingDays: working.length,
        pct: pct(covered, working.length),
        lastIn: s.last,
        gaps: working.filter((d) => !s.dates.has(d)),
      }
    })
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name))
}

export interface Delta {
  /** Now minus before, or null when either side has nothing. */
  change: number | null
  /** Whether the change is for the better. */
  better: boolean | null
}

/** Change against the period before. `higherIsBetter` says which way is good. */
export function delta(now: number | null, before: number | null, higherIsBetter: boolean): Delta {
  if (now === null || before === null) return { change: null, better: null }
  const change = now - before
  return { change, better: change === 0 ? null : change > 0 === higherIsBetter }
}

/* ------------------------------------------------------------------ */
/* Calendar grid                                                       */
/* ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<DayStatus, string> = {
  on_time: 'On time',
  late: 'Late',
  off_site: 'Off site',
  absent: 'Absent',
  rest: 'Sunday (not expected)',
  none: 'Not on the team yet, or switched off',
}

/** What a calendar cell says when pointed at. */
export function cellTitle(r: DayRecord, name: string) {
  const parts = [`${name}, ${LONG_DAY[weekday(r.date)]} ${dayMonth(r.date)}`]
  if (r.present) {
    parts.push(`In ${clock(r.inMinutes)}${r.minutesLate ? ` (${lateness(r.minutesLate)} late)` : r.late ? ' (late)' : ''}`)
    if (r.offSite) parts.push(r.flagged ? 'Flagged' : 'Off site')
    parts.push(r.clockOut ? `Out ${clock(minutesOf(r.clockOut.local_time))}` : r.onShift ? 'Still on shift' : 'No clock-out')
  } else {
    parts.push(STATUS_LABEL[r.status])
  }
  return parts.join(' · ')
}
