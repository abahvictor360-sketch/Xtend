/**
 * A marketer's report for one day or one month: when they clocked in and
 * out, each store they checked in to and for how long, the daily report
 * they filed, and any stock counts and X Metrics sales they sent. The
 * Marketer reports page and its PDF, Word and Excel downloads read it.
 *
 * Pure on purpose (no Supabase, no server-only), so
 * scripts/check-marketer-reports.ts can build one from made-up rows.
 * Every date and time is Africa/Lagos.
 */
import { addDays, formatLagos, longDate } from '@/lib/utils'
import { duration } from '@/lib/movement'
import { dayList, isDate, minutesOf, weekday } from '@/lib/attendance-report'
import { reportFileLine } from '@/lib/report-files'

export type ReportKind = 'day' | 'month'

/* ------------------------------------------------------------------ */
/* What goes in                                                        */
/* ------------------------------------------------------------------ */

export interface ReportPerson {
  name: string
  /** The role people see, e.g. "Marketer" or an added role's name. */
  role: string
  /** Who they report to, or null. */
  supervisor: string | null
  /** Their home store, or null. */
  homeStore: string | null
}

/** The fields of an attendance_detail row this file reads. */
export interface SourceClock {
  attendance_date: string
  type: 'opening' | 'closing'
  created_at: string
  /** 'YYYY-MM-DD HH:MI', Lagos. */
  local_time: string
  outlet_name: string | null
  /** 'HH:MM:SS' or null. */
  shift_start: string | null
  status: 'on_site' | 'off_site' | 'flagged' | null
  is_late: boolean
  location_label?: string | null
}

/** The fields of a store_visit_detail row this file reads. */
export interface SourceVisit {
  outlet_id: string | null
  outlet_name: string | null
  outlet_address: string | null
  arrived_address?: string | null
  store_label: string | null
  visit_date: string
  status: string
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
}

export interface SourceReport {
  report_date: string
  created_at: string
  updated_at: string | null
  body: string | null
  sales_summary: string | null
  stock_status: string | null
  competitor_activity: string | null
  issues: string | null
}

/** A document attached to a daily report (0064). */
export interface SourceReportFile {
  report_date: string
  name: string
  mime: string | null
  size_bytes: number | null
}

export interface SourceCount {
  count_date: string
  outlet_name: string | null
  product_name: string | null
  in_store: number | null
  sold: number | null
}

export interface SourceSale {
  sale_date: string
  outlet_name: string | null
  product_name: string | null
  units: number
}

export interface ReportSource {
  kind: ReportKind
  person: ReportPerson
  from: string
  to: string
  /** Lagos business date now. */
  today: string
  /** When the file is made (ISO). */
  generatedAt: string
  events: SourceClock[]
  visits: SourceVisit[]
  reports: SourceReport[]
  counts: SourceCount[]
  sales: SourceSale[]
  /** Documents attached to the reports (0064); none when left out. */
  files?: SourceReportFile[]
}

/* ------------------------------------------------------------------ */
/* What comes out                                                      */
/* ------------------------------------------------------------------ */

export interface VisitLine {
  store: string
  address: string | null
  /** 'HH:MM'. */
  inTime: string
  /** 'HH:MM', "Still checked in" or "Not checked out". */
  outTime: string
  open: boolean
  minutes: number
  minutesText: string
  /** At the store, Away from the store, … */
  arrival: string
  /** Minutes since they checked out of the store before; null for the first. */
  gapBefore: number | null
  gapText: string
}

export interface ClockLine {
  time: string
  /** e.g. "On time, at the store" or "12 min late, away from the store". */
  statusText: string
  place: string | null
}

export interface ReportField {
  label: string
  text: string
  empty: boolean
}

export interface DayDetail {
  date: string
  /** "Friday 16 October 2026". */
  dateLabel: string
  /** "Fri 16 Oct". */
  shortLabel: string
  clockIn: ClockLine | null
  clockOut: ClockLine | null
  /** For tables: '08:02' or '—'. */
  inText: string
  /** '17:30', 'Not clocked out', 'Still on shift' or '—'. */
  outText: string
  late: boolean
  onTime: boolean
  missingOut: boolean
  visits: VisitLine[]
  stores: number
  minutesInStores: number
  /** documents: "Price survey.pdf (PDF, 1.2 MB)" for each attached (0064). */
  report: { filedAt: string; fields: ReportField[]; documents: string[] } | null
  counts: { store: string; product: string; inStore: string; sold: string }[]
  sales: { store: string; product: string; units: number }[]
  /** One plain sentence about the day. */
  summary: string
  /** Anything recorded at all. */
  active: boolean
}

export interface StoreLine {
  store: string
  address: string | null
  visits: number
  minutes: number
  minutesText: string
  /** "16 Oct, 14:20". */
  lastVisit: string
}

export interface Tile {
  label: string
  value: string
  note?: string
}

export interface MarketerReport {
  kind: ReportKind
  person: ReportPerson
  from: string
  to: string
  /** "Friday 16 October 2026" or "October 2026". */
  periodLabel: string
  /** "Day report" or "Month report". */
  kindLabel: string
  /** "16 Oct 2026, 18:05". */
  generatedLabel: string
  totals: {
    daysWorked: number
    workingDays: number
    storesVisited: number
    visits: number
    minutesInStores: number
    averageVisitMinutes: number | null
    clockIns: number
    onTimeClockIns: number
    missingClockOuts: number
    reportsFiled: number
  }
  tiles: Tile[]
  summary: string
  /** Every day of the period up to today. */
  days: DayDetail[]
  /** The days with something recorded. */
  activeDays: DayDetail[]
  stores: StoreLine[]
  /** File name without extension, e.g. "xtend-report-chidi-obi-2026-10". */
  fileBase: string
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export const ARRIVAL_LABEL: Record<string, string> = {
  on_site: 'At the store',
  off_site: 'Away from the store',
  flagged: 'Location unclear',
}

const CLOCK_PLACE: Record<string, string> = {
  on_site: 'at the store',
  off_site: 'away from the store',
  flagged: 'location unclear',
}

export function arrivalText(v: Pick<SourceVisit, 'arrived_status' | 'outlet_id'>) {
  if (v.arrived_status && ARRIVAL_LABEL[v.arrived_status]) return ARRIVAL_LABEL[v.arrived_status]
  return v.outlet_id ? 'Not measured' : 'Shop not on the store list'
}

/** The report's sections, in the order the field app asks for them. */
export const REPORT_FIELDS: { key: keyof SourceReport; label: string }[] = [
  { key: 'body', label: 'How the day went' },
  { key: 'sales_summary', label: 'Sales' },
  { key: 'stock_status', label: 'Stock status' },
  { key: 'competitor_activity', label: 'Competitor activity' },
  { key: 'issues', label: 'Issues for the office' },
]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3))
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const minutesText = (m: number) => duration(Math.max(0, Math.round(m)))

const time = (iso: string | null | undefined) => (iso ? formatLagos(iso, false) : '—')

export function shortDate(date: string) {
  return `${SHORT_DAYS[weekday(date)]} ${Number(date.slice(8, 10))} ${SHORT_MONTHS[Number(date.slice(5, 7)) - 1]}`
}

export function monthName(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'staff'
  )
}

/* ------------------------------------------------------------------ */
/* The period asked for                                                */
/* ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)

export function lastDayOfMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return addDays(next, -1)
}

export interface ReportRequest {
  userId: string | null
  kind: ReportKind
  /** The day, for a day report. */
  date: string
  /** 'YYYY-MM', for a month report. */
  month: string
  from: string
  to: string
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>

/**
 * ?user_id=…&period=day&date=2026-10-16 or ?period=month&month=2026-10,
 * cleaned: never after today, a month ends today at the latest.
 */
export function parseReportRequest(params: Params, today: string): ReportRequest {
  const get = (key: string) => {
    const raw = params instanceof URLSearchParams ? params.get(key) : params[key]
    const v = Array.isArray(raw) ? raw[0] : raw
    return typeof v === 'string' ? v.trim().slice(0, 80) : null
  }
  const user = get('user_id')
  const kind: ReportKind = get('period') === 'month' ? 'month' : 'day'
  const rawDate = get('date')
  const date = isDate(rawDate) && rawDate <= today ? rawDate : today
  const rawMonth = get('month')
  const month = isMonth(rawMonth) && rawMonth <= today.slice(0, 7) ? rawMonth : date.slice(0, 7)
  const end = lastDayOfMonth(month)
  return {
    userId: user && UUID.test(user) ? user : null,
    kind,
    date,
    month,
    from: kind === 'day' ? date : `${month}-01`,
    to: kind === 'day' ? date : end < today ? end : today,
  }
}

/** The query string for a download link. */
export function reportQuery(userId: string, kind: ReportKind, dateOrMonth: string) {
  const q = new URLSearchParams({ user_id: userId, period: kind })
  q.set(kind === 'day' ? 'date' : 'month', dateOrMonth)
  return q.toString()
}

/* ------------------------------------------------------------------ */
/* Building it                                                         */
/* ------------------------------------------------------------------ */

const storeOf = (v: SourceVisit) => v.store_label || v.outlet_name || 'Unnamed place'
const storeKey = (v: SourceVisit) => v.outlet_id ?? `place:${storeOf(v).toLowerCase()}`

/** Today's visits as the report shows them, with the time between stores. */
export function visitLines(visits: SourceVisit[], today: string): VisitLine[] {
  const sorted = [...visits].sort((a, b) => a.arrived_at.localeCompare(b.arrived_at))
  return sorted.map((v, i) => {
    const before = i > 0 ? sorted[i - 1] : null
    const gap =
      before?.departed_at != null
        ? Math.max(0, Math.round((Date.parse(v.arrived_at) - Date.parse(before.departed_at)) / 60_000))
        : null
    const open = !v.departed_at
    return {
      store: storeOf(v),
      address: v.outlet_address || v.arrived_address || null,
      inTime: time(v.arrived_at),
      outTime: open ? (v.visit_date === today && v.status === 'open' ? 'Still checked in' : 'Not checked out') : time(v.departed_at),
      open,
      minutes: Math.max(0, v.minutes ?? 0),
      minutesText: minutesText(v.minutes ?? 0),
      arrival: arrivalText(v),
      gapBefore: gap,
      gapText: i === 0 ? 'First store' : gap === null ? '—' : `${minutesText(gap)} after the last store`,
    }
  })
}

/**
 * The report's fields as the PDF and Word files print them: the five
 * sections, then "Documents attached" when there are any.
 */
export function reportFieldsWithDocuments(report: { fields: ReportField[]; documents: string[] }): ReportField[] {
  if (!report.documents.length) return report.fields
  return [...report.fields, { label: 'Documents attached', text: report.documents.join('; '), empty: false }]
}

/** Store visit totals for a set of visits: what the daily report shows. */
export function visitTotals(visits: SourceVisit[]) {
  return {
    visits: visits.length,
    stores: new Set(visits.map(storeKey)).size,
    minutes: visits.reduce((sum, v) => sum + Math.max(0, v.minutes ?? 0), 0),
  }
}

function clockLine(e: SourceClock | null, opening: boolean): ClockLine | null {
  if (!e) return null
  const place = e.status ? CLOCK_PLACE[e.status] : 'place not confirmed'
  let status = place
  if (opening) {
    const at = minutesOf(e.local_time)
    const shift = minutesOf(e.shift_start)
    const late = e.is_late && at !== null && shift !== null ? Math.max(0, at - shift) : null
    status = `${e.is_late ? (late ? `${minutesText(late)} late` : 'Late') : 'On time'}, ${place}`
  } else {
    status = place.charAt(0).toUpperCase() + place.slice(1)
  }
  return { time: time(e.created_at), statusText: status, place: e.location_label || e.outlet_name || null }
}

function daySummary(d: Omit<DayDetail, 'summary' | 'active'>, date: string, today: string) {
  const parts: string[] = []
  if (d.clockIn) parts.push(`Clocked in at ${d.clockIn.time}${d.late ? ', late' : ', on time'}`)
  else if (d.visits.length || d.report) parts.push('Did not clock in')
  if (d.visits.length) {
    const open = d.visits.filter((v) => v.open && v.outTime === 'Still checked in').length
    parts.push(
      `visited ${plural(d.stores, 'store')}${d.visits.length !== d.stores ? ` in ${plural(d.visits.length, 'visit')}` : ''}, ` +
        `${minutesText(d.minutesInStores)} in stores${open ? ' (still checked in)' : ''}`,
    )
  } else if (d.clockIn) parts.push('no store visits')
  if (d.clockIn || d.visits.length) parts.push(d.report ? 'filed the daily report' : 'no daily report')
  if (d.clockOut) parts.push(`clocked out at ${d.clockOut.time}`)
  else if (d.clockIn) parts.push(date === today ? 'still on shift' : 'did not clock out')
  if (!parts.length) {
    if (date > today) return 'This day has not come yet.'
    return weekday(date) === 0 ? 'Sunday. Nothing recorded.' : 'Nothing recorded: no clock-in, no store visits, no report.'
  }
  const text = parts.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

export function buildDay(
  date: string,
  src: Pick<ReportSource, 'events' | 'visits' | 'reports' | 'counts' | 'sales' | 'today' | 'files'>,
): DayDetail {
  const events = src.events.filter((e) => e.attendance_date === date)
  const ins = events.filter((e) => e.type === 'opening').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const firstIn = ins[0] ?? null
  const outs = events
    .filter((e) => e.type === 'closing' && (!firstIn || e.created_at >= firstIn.created_at))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const lastOut = outs[0] ?? null
  const visits = src.visits.filter((v) => v.visit_date === date)
  const lines = visitLines(visits, src.today)
  const totals = visitTotals(visits)
  const report = src.reports.find((r) => r.report_date === date) ?? null
  const late = Boolean(firstIn?.is_late)
  const missingOut = Boolean(firstIn && !lastOut && date < src.today)

  const base: Omit<DayDetail, 'summary' | 'active'> = {
    date,
    dateLabel: longDate(date),
    shortLabel: shortDate(date),
    clockIn: clockLine(firstIn, true),
    clockOut: clockLine(lastOut, false),
    inText: firstIn ? time(firstIn.created_at) : '—',
    outText: lastOut ? time(lastOut.created_at) : firstIn ? (date === src.today ? 'Still on shift' : 'Not clocked out') : '—',
    late,
    onTime: Boolean(firstIn && !late),
    missingOut,
    visits: lines,
    stores: totals.stores,
    minutesInStores: totals.minutes,
    report: report
      ? {
          filedAt: time(report.updated_at && report.updated_at > report.created_at ? report.updated_at : report.created_at),
          fields: REPORT_FIELDS.map((f) => {
            const text = String(report[f.key] ?? '').trim()
            return { label: f.label, text: text || 'Nothing reported.', empty: !text }
          }),
          documents: (src.files ?? []).filter((f) => f.report_date === date).map(reportFileLine),
        }
      : null,
    counts: src.counts
      .filter((c) => c.count_date === date)
      .map((c) => ({
        store: c.outlet_name ?? '—',
        product: c.product_name ?? '—',
        inStore: c.in_store === null ? '—' : String(c.in_store),
        sold: c.sold === null ? '—' : String(c.sold),
      })),
    sales: src.sales
      .filter((s) => s.sale_date === date)
      .map((s) => ({ store: s.outlet_name ?? '—', product: s.product_name ?? '—', units: s.units })),
  }
  const active = Boolean(firstIn || lastOut || lines.length || report || base.counts.length || base.sales.length)
  return { ...base, summary: daySummary(base, date, src.today), active }
}

export function storeLines(visits: SourceVisit[]): StoreLine[] {
  const by = new Map<string, { store: string; address: string | null; visits: number; minutes: number; last: string }>()
  for (const v of visits) {
    const k = storeKey(v)
    const row = by.get(k) ?? { store: storeOf(v), address: v.outlet_address || v.arrived_address || null, visits: 0, minutes: 0, last: v.arrived_at }
    row.visits += 1
    row.minutes += Math.max(0, v.minutes ?? 0)
    if (v.arrived_at > row.last) row.last = v.arrived_at
    by.set(k, row)
  }
  return [...by.values()]
    .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits || a.store.localeCompare(b.store))
    .map((r) => {
      const date = formatLagos(r.last, true)
      return {
        store: r.store,
        address: r.address,
        visits: r.visits,
        minutes: r.minutes,
        minutesText: minutesText(r.minutes),
        lastVisit: date,
      }
    })
}

/** The whole report, for one person and one day or month. */
export function buildMarketerReport(src: ReportSource): MarketerReport {
  const last = src.to < src.today ? src.to : src.today
  const dates = src.from <= last ? dayList(src.from, last) : [src.from]
  const days = dates.map((d) => buildDay(d, src))
  const activeDays = days.filter((d) => d.active)
  const inRange = src.visits.filter((v) => v.visit_date >= src.from && v.visit_date <= src.to)
  const totals = visitTotals(inRange)
  const closed = inRange.filter((v) => v.departed_at)
  const clockIns = days.filter((d) => d.clockIn).length
  const onTime = days.filter((d) => d.onTime).length
  const missing = days.filter((d) => d.missingOut).length
  const reportsFiled = days.filter((d) => d.report).length
  const daysWorked = days.filter((d) => d.clockIn || d.visits.length).length
  const workingDays = days.filter((d) => weekday(d.date) !== 0 || d.active).length
  const average = closed.length ? closed.reduce((s, v) => s + Math.max(0, v.minutes), 0) / closed.length : null

  const tiles: Tile[] = [
    { label: 'Days worked', value: String(daysWorked), note: src.kind === 'month' ? `of ${plural(workingDays, 'working day')}` : undefined },
    { label: 'Stores visited', value: String(totals.stores) },
    { label: 'Visits', value: String(totals.visits) },
    { label: 'Time in stores', value: minutesText(totals.minutes) },
    { label: 'Average visit', value: average === null ? '—' : minutesText(average) },
    { label: 'On-time clock-ins', value: `${onTime} of ${clockIns}` },
    { label: 'Missing clock-outs', value: String(missing) },
    { label: 'Reports filed', value: `${reportsFiled} of ${daysWorked}` },
  ]

  let summary: string
  if (src.kind === 'day') {
    summary = days[0]?.summary ?? 'Nothing recorded.'
  } else if (!activeDays.length) {
    summary = `Nothing recorded for ${monthName(src.from.slice(0, 7))}.`
  } else {
    const bits = [
      `Worked ${daysWorked} of ${plural(workingDays, 'working day')}`,
      totals.visits
        ? `visited ${plural(totals.stores, 'store')} ${totals.visits === 1 ? 'once' : `${totals.visits} times`} for ${minutesText(totals.minutes)} in all`
        : 'recorded no store visits',
      `clocked in on time on ${onTime} of ${plural(clockIns, 'day')}`,
      `filed ${plural(reportsFiled, 'daily report')}`,
    ]
    summary = `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}.`
    if (missing) summary += ` ${plural(missing, 'day')} without a clock-out.`
  }

  const period = src.kind === 'day' ? longDate(src.from) : monthName(src.from.slice(0, 7))
  return {
    kind: src.kind,
    person: src.person,
    from: src.from,
    to: src.to,
    periodLabel: period,
    kindLabel: src.kind === 'day' ? 'Day report' : 'Month report',
    generatedLabel: formatLagos(src.generatedAt, true),
    totals: {
      daysWorked,
      workingDays,
      storesVisited: totals.stores,
      visits: totals.visits,
      minutesInStores: totals.minutes,
      averageVisitMinutes: average,
      clockIns,
      onTimeClockIns: onTime,
      missingClockOuts: missing,
      reportsFiled,
    },
    tiles,
    summary,
    days,
    activeDays,
    stores: storeLines(inRange),
    fileBase: `xtend-report-${slug(src.person.name)}-${src.kind === 'day' ? src.from : src.from.slice(0, 7)}`,
  }
}

/* ------------------------------------------------------------------ */
/* The visits kept with a daily report (reports.store_visits, 060)     */
/* ------------------------------------------------------------------ */

export interface SnapshotVisit {
  store: string | null
  outlet_name: string | null
  address: string | null
  arrived_at: string
  departed_at: string | null
  minutes: number | null
  status: string | null
  arrived_status: string | null
}

/** "Ikeja City Mall 09:10–10:00 (50 min); …" for a table cell. */
export function snapshotText(raw: unknown) {
  const list = Array.isArray(raw) ? (raw as SnapshotVisit[]) : []
  if (!list.length) return { text: 'No store visits', minutes: 0, count: 0 }
  const minutes = list.reduce((s, v) => s + Math.max(0, Number(v.minutes) || 0), 0)
  const text = list
    .map((v) => {
      const out = v.departed_at ? time(v.departed_at) : 'still in'
      return `${v.store || v.outlet_name || 'Unnamed place'} ${time(v.arrived_at)}–${out} (${minutesText(Number(v.minutes) || 0)})`
    })
    .join('; ')
  return { text: `${text}. Total ${minutesText(minutes)}.`, minutes, count: list.length }
}
