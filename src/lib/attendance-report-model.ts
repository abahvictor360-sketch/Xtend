/**
 * What the designed attendance report (lib/export/attendance-report-pdf.ts)
 * shows: the figures, the charts' numbers, the written account and the
 * rows, worked out once from the day records. Pure, so
 * scripts/check-attendance.ts can test it.
 */
import {
  clock,
  counted,
  hoursText,
  lateness,
  minutesOf,
  percent,
  sortDays,
  summarise,
  type ClockEvent,
  type DayRecord,
  type Person,
} from '@/lib/attendance-report'
import { shortDay, writeUpParts, NETWORK_MIN, type Tone, type WriteUpParts } from '@/lib/attendance-writeup'
import { longDate, metres } from '@/lib/utils'

type Event = ClockEvent & { location_label?: string | null; device_info?: Record<string, unknown> | null; lat?: number; lng?: number }

export interface Kpi {
  label: string
  value: string
  note: string
  tone: Tone | 'brand'
  /** 0–100 for a thin bar under the figure. */
  bar?: number | null
}

export interface Slice {
  label: string
  value: number
  color: string
}

export interface Bar {
  label: string
  value: number
  /** Printed above the bar. */
  text: string
  /** Bars past the shift start, or a poor day, are drawn in the warning colour. */
  warn?: boolean
}

export interface StoreBar {
  name: string
  came: number
  expected: number
}

export interface ReportRow {
  date: string
  name: string
  sub: string
  how: string
  tone: Tone | 'muted'
  in: string
  out: string
  hours: string
  from: string
  notes: string
  map: string | null
}

export interface ReportModel {
  single: boolean
  periodLabel: string
  filterLine: string
  kpis: Kpi[]
  mix: Slice[]
  barsTitle: string
  barsNote: string
  bars: Bar[]
  stores: StoreBar[]
  story: WriteUpParts
  rows: ReportRow[]
}

export const TONE_HEX: Record<Tone | 'brand' | 'muted', string> = {
  brand: '#d1511a',
  good: '#2f8f5b',
  warn: '#d99a1e',
  bad: '#c0392b',
  info: '#3b6ea8',
  muted: '#8a7b72',
}

const HOW: Record<string, { text: string; tone: ReportRow['tone'] }> = {
  on_time: { text: 'On time', tone: 'good' },
  late: { text: 'Late', tone: 'warn' },
  off_site: { text: 'Away from store', tone: 'bad' },
  absent: { text: 'Absent', tone: 'bad' },
  off: { text: 'Day off', tone: 'muted' },
  leave: { text: 'On leave', tone: 'muted' },
  none: { text: '', tone: 'muted' },
}

export function attendanceReportModel<E extends Event>(
  rows: DayRecord<E>[],
  all: DayRecord<E>[],
  people: Person[],
  range: { from: string; to: string },
  filterLine: string,
): ReportModel {
  const single = range.from === range.to
  const person = new Map(people.map((p) => [p.id, p]))
  const s = summarise(all)
  const present = all.filter((r) => r.present)
  const out = present.filter((r) => r.clockOut).length
  const onShift = present.filter((r) => r.onShift).length
  const network = all.filter((r) => (r.sentLateMin ?? 0) >= NETWORK_MIN).length
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : null)

  const kpis: Kpi[] = [
    { label: 'Came in', value: `${s.present}`, note: `of ${s.expected} expected · ${percent(s.turnout)}`, tone: 'good', bar: s.turnout },
    { label: 'On time', value: percent(s.punctuality), note: `${s.onTime} of ${s.present} clock-ins`, tone: 'brand', bar: s.punctuality },
    { label: 'Late', value: `${s.late}`, note: s.avgLateMin !== null ? `${lateness(s.avgLateMin)} late on average` : 'Nobody late', tone: s.late ? 'warn' : 'good', bar: pct(s.late, s.present) },
    { label: 'Absent', value: `${s.absent}`, note: s.absent ? 'Expected, no clock-in' : 'Nobody missing', tone: s.absent ? 'bad' : 'good', bar: pct(s.absent, s.expected) },
    { label: 'Clocked in and out', value: `${out}`, note: `of ${s.present} who came`, tone: 'good', bar: pct(out, s.present) },
    { label: 'Still on shift', value: `${onShift}`, note: s.missingOut ? `${s.missingOut} did not clock out` : 'No missing clock-outs', tone: s.missingOut ? 'warn' : 'info', bar: pct(onShift, s.present) },
    { label: 'Away from store', value: `${s.offSite}`, note: s.offSite ? 'Or location too rough' : 'All at their store', tone: s.offSite ? 'bad' : 'good', bar: pct(s.offSite, s.present) },
    { label: 'Usual clock-in', value: clock(s.avgIn), note: network ? `${network} with network trouble` : 'No network trouble', tone: network ? 'info' : 'brand' },
  ]

  const leaveOff = all.filter((r) => !r.present && (r.status === 'leave' || r.status === 'off')).length
  const mix: Slice[] = [
    { label: 'On time', value: present.filter((r) => !r.late && !r.offSite).length, color: TONE_HEX.good },
    { label: 'Late', value: present.filter((r) => r.late && !r.offSite).length, color: TONE_HEX.warn },
    { label: 'Away from store', value: present.filter((r) => r.offSite).length, color: '#e8833a' },
    { label: 'Absent', value: s.absent, color: TONE_HEX.bad },
    { label: 'Leave or day off', value: leaveOff, color: '#c9bdb5' },
  ]

  // One day: when people clocked in, by half hour. Several: each day's turnout.
  let bars: Bar[] = []
  let barsTitle = ''
  let barsNote = ''
  if (single) {
    const mins = present.map((r) => r.inMinutes).filter((m): m is number => m !== null)
    const shifts = present.map((r) => minutesOf(r.clockIn?.shift_start)).filter((m): m is number => m !== null)
    const shift = shifts.length ? shifts.sort((a, b) => shifts.filter((x) => x === b).length - shifts.filter((x) => x === a).length)[0] : null
    barsTitle = 'When people clocked in'
    barsNote = shift !== null ? `Half-hour slots · shift starts ${clock(shift)}` : 'Half-hour slots'
    if (mins.length) {
      const first = Math.floor(Math.min(...mins) / 30) * 30
      const last = Math.floor(Math.max(...mins) / 30) * 30
      for (let t = first; t <= last && bars.length < 16; t += 30) {
        const n = mins.filter((m) => m >= t && m < t + 30).length
        bars.push({ label: clock(t), value: n, text: n ? String(n) : '', warn: shift !== null && t >= shift })
      }
    }
  } else {
    const days = [...new Set(all.map((r) => r.date))].sort().slice(-31)
    barsTitle = 'Turnout, day by day'
    barsNote = 'Share of those expected who clocked in'
    bars = days.map((d) => {
      const day = all.filter((r) => r.date === d && counted(r))
      const came = day.filter((r) => r.present).length
      const v = day.length ? Math.round((came / day.length) * 100) : 0
      return { label: shortDay(d).replace(/^\w+ /, ''), value: v, text: day.length ? `${v}%` : '', warn: day.length > 0 && v < 80 }
    })
  }

  const storeMap = new Map<string, StoreBar>()
  for (const r of all.filter(counted)) {
    const name = r.outletName ?? person.get(r.userId)?.outletName ?? 'No store'
    const b = storeMap.get(name) ?? { name, came: 0, expected: 0 }
    b.expected++
    if (r.present) b.came++
    storeMap.set(name, b)
  }
  const stores = [...storeMap.values()].sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name)).slice(0, 8)

  const names = new Map(people.map((p) => [p.id, p.name]))
  const tableRows: ReportRow[] = sortDays(rows, names, 'date', 'desc').map((r) => {
    const p = person.get(r.userId)
    const how = r.present ? (r.offSite ? HOW.off_site : r.late ? HOW.late : HOW.on_time) : HOW[r.status]
    const e = r.clockIn as E | null
    const notes = [
      r.flagged ? 'Location too rough' : null,
      r.minutesLate ? `${lateness(r.minutesLate)} late` : null,
      r.missingOut ? 'No clock-out' : null,
      r.onShift ? 'On shift' : null,
      (r.sentLateMin ?? 0) >= NETWORK_MIN ? `Sent ${lateness(r.sentLateMin!)} late (no signal)` : null,
      e?.device_info?.source === 'office' ? 'By the office' : null,
      e?.location_label ?? null,
    ].filter(Boolean)
    return {
      date: shortDay(r.date),
      name: p?.name ?? '',
      sub: [p?.roleLabel, r.outletName ?? p?.outletName].filter(Boolean).join(' · '),
      how: how.text,
      tone: how.tone,
      in: r.present ? clock(r.inMinutes) : '',
      out: r.clockOut ? clock(minutesOf(r.clockOut.local_time)) : '',
      hours: r.hours !== null ? hoursText(r.hours) : '',
      from: e ? metres(e.distance_m) : '',
      notes: notes.join(' · '),
      map: e && typeof e.lat === 'number' && typeof e.lng === 'number' ? `https://www.google.com/maps?q=${e.lat},${e.lng}` : null,
    }
  })

  return {
    single,
    periodLabel: single ? longDate(range.from) : `${longDate(range.from)} to ${longDate(range.to)}`,
    filterLine,
    kpis,
    mix,
    barsTitle,
    barsNote,
    bars,
    stores,
    story: writeUpParts(all, people, range),
    rows: tableRows,
  }
}
