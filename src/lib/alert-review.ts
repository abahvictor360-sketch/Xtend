/**
 * Location alerts (location_alerts, alert_detail) turned into what a
 * supervisor asks about: what is still open and for how long, who keeps
 * coming up, and where to look next. Plain functions, used by the Alerts
 * page, its downloads and scripts/check-visits-alerts.ts.
 */
import { duration } from '@/lib/movement'
import { addDays, formatLagos, lagosDateString } from '@/lib/utils'
import type { AlertDetail, AlertType } from '@/lib/types'

export const ALERT_LABEL: Record<AlertType, string> = {
  left_geofence: 'Left the store during their shift',
  low_accuracy: 'Location fix too rough to trust',
  permission_denied: 'Tried to open Xtend with location off',
  off_site_clock: 'Clocked in or out away from the store',
}

/** The same, short enough for a chip or a table heading. */
export const ALERT_SHORT: Record<AlertType, string> = {
  left_geofence: 'Left the store',
  low_accuracy: 'Rough location',
  permission_denied: 'Location off',
  off_site_clock: 'Away from the store',
}

export const ALERT_TYPES = Object.keys(ALERT_LABEL) as AlertType[]
export const isAlertType = (v: unknown): v is AlertType => ALERT_TYPES.includes(v as AlertType)
export const alertLabel = (t: string) => (isAlertType(t) ? ALERT_LABEL[t] : t)

/** Open alerts older than this are called out. */
export const STALE_HOURS = 24
/** This many alerts or more for one person in the period makes a pattern. */
export const REPEAT_AT = 3

export type AlertState = 'open' | 'resolved' | 'all'

export interface AlertFilter {
  state: AlertState
  type: AlertType | null
  person: string | null
  /** The person's home store. */
  store: string | null
  from: string | null
  to: string | null
}

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const isId = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

export function parseAlertFilter(params: URLSearchParams | Record<string, string | string[] | undefined>): AlertFilter {
  const raw = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k]
    return (Array.isArray(v) ? v[0] : v) ?? null
  }
  const get = (k: string) => {
    const v = raw(k)
    return v && v !== 'all' ? v.slice(0, 80) : null
  }
  // The old tab link (?show=resolved) still lands on the resolved ones.
  const state = raw('state') ?? (raw('show') === 'resolved' ? 'resolved' : null)
  const from = isDate(get('from'))
  const to = isDate(get('to'))
  return {
    state: state === 'resolved' ? 'resolved' : state === 'all' ? 'all' : 'open',
    type: isAlertType(get('type')) ? (get('type') as AlertType) : null,
    person: isId(get('person')),
    store: isId(get('store')),
    from,
    to: to && from && to < from ? from : to,
  }
}

export function alertQueryString(f: Partial<AlertFilter>) {
  const p = new URLSearchParams()
  if (f.state && f.state !== 'open') p.set('state', f.state)
  if (f.type) p.set('type', f.type)
  if (f.person) p.set('person', f.person)
  if (f.store) p.set('store', f.store)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p.toString()
}

/** Minutes an alert has been open, or took to resolve. */
export function alertAgeMinutes(a: Pick<AlertDetail, 'created_at' | 'resolved_at' | 'is_resolved'>, now = Date.now()) {
  const end = a.is_resolved && a.resolved_at ? Date.parse(a.resolved_at) : now
  return Math.max(0, (end - Date.parse(a.created_at)) / 60000)
}

/** "open for 3 h", "open for 2 days", "resolved after 25 min". */
export function ageText(a: Pick<AlertDetail, 'created_at' | 'resolved_at' | 'is_resolved'>, now = Date.now()) {
  const m = alertAgeMinutes(a, now)
  const span = m < 1 ? 'under a minute' : m >= 48 * 60 ? `${Math.floor(m / 1440)} days` : m >= 60 ? `${Math.floor(m / 60)} h` : duration(m)
  return a.is_resolved ? `resolved after ${span}` : `open for ${span}`
}

export function typeCounts(alerts: Pick<AlertDetail, 'alert_type'>[]) {
  const counts = Object.fromEntries(ALERT_TYPES.map((t) => [t, 0])) as Record<AlertType, number>
  for (const a of alerts) if (isAlertType(a.alert_type)) counts[a.alert_type] += 1
  return counts
}

export interface PersonAlerts {
  userId: string
  name: string
  phone: string | null
  store: string | null
  total: number
  open: number
  types: Record<AlertType, number>
  days: number
  last: string
  oldestOpen: string | null
}

/** One line per person, most alerts first: the repeat offenders on top. */
export function byPerson(alerts: AlertDetail[]): PersonAlerts[] {
  const groups = new Map<string, AlertDetail[]>()
  for (const a of alerts) groups.set(a.user_id, [...(groups.get(a.user_id) ?? []), a])
  return [...groups.values()]
    .map((rows) => {
      const open = rows.filter((a) => !a.is_resolved)
      return {
        userId: rows[0].user_id,
        name: rows[0].staff_name,
        phone: rows[0].staff_phone,
        store: rows[0].outlet_name,
        total: rows.length,
        open: open.length,
        types: typeCounts(rows),
        days: new Set(rows.map((a) => lagosDateString(new Date(a.created_at)))).size,
        last: rows.reduce((m, a) => (a.created_at > m ? a.created_at : m), rows[0].created_at),
        oldestOpen: open.length ? open.reduce((m, a) => (a.created_at < m ? a.created_at : m), open[0].created_at) : null,
      }
    })
    .sort((a, b) => b.total - a.total || b.open - a.open || a.name.localeCompare(b.name))
}

export const repeatOffenders = (people: PersonAlerts[], at = REPEAT_AT) => people.filter((p) => p.total >= at)

/** "3 left the store, 1 rough location": the mix, biggest first. */
export function typeMix(types: Record<AlertType, number>) {
  return ALERT_TYPES.filter((t) => types[t] > 0)
    .sort((a, b) => types[b] - types[a])
    .map((t) => `${types[t]} ${ALERT_SHORT[t].toLowerCase()}`)
    .join(', ')
}

/** Where to look next for one alert: Movement that day, and an hour either side of it as an excuse window. */
export function alertLinks(a: Pick<AlertDetail, 'user_id' | 'created_at'>) {
  const day = lagosDateString(new Date(a.created_at))
  const at = Date.parse(a.created_at)
  const before = new Date(at - 60 * 60_000)
  const after = new Date(Math.min(at + 60 * 60_000, Date.now()))
  const q = new URLSearchParams({
    person: a.user_id,
    date: lagosDateString(before),
    from: formatLagos(before, false),
    until: lagosDateString(after),
    to: formatLagos(after, false),
  })
  return {
    movement: `/admin/tracking?person=${a.user_id}&date=${day}&until=${day}`,
    excuse: `/admin/excuses?${q.toString()}`,
  }
}

/** The quick date ranges, keeping everything else in the filter. */
export function alertPresets(f: AlertFilter, today: string) {
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
  ].map((p) => ({ ...p, href: `?${alertQueryString({ ...f, from: p.from, to: p.to })}` }))
}
