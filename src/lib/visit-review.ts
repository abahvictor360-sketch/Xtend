/**
 * Store visits turned into what a supervisor asks about: how many shops
 * were covered and for how long, which visits look wrong, and which stores
 * nobody has been to lately. Plain functions over store_visit_detail and
 * store_coverage rows (migrations 016 and 052), used by the page, the
 * downloads and scripts/check-visits-alerts.ts.
 */
import { duration, metresBetween } from '@/lib/movement'
import { addDays, formatLagos, metres } from '@/lib/utils'

export interface VisitRow {
  id: string
  user_id: string
  staff_name: string
  outlet_id: string | null
  outlet_name: string | null
  outlet_address: string | null
  visit_date: string
  status: string
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
  departed_status: string | null
  arrived_distance_m: number | null
  departed_distance_m: number | null
  arrived_accuracy_m?: number | null
  arrived_lat?: number | null
  arrived_lng?: number | null
  arrived_label: string | null
  /** The outlet's name inside its fence; the map's premises name outside. */
  store_label: string | null
  store_label_source: 'outlet' | 'map' | null
  selfie_path: string | null
  // Migration 052. Absent before it runs, so every use has a fallback.
  departed_lat?: number | null
  departed_lng?: number | null
  departed_accuracy_m?: number | null
  departed_label?: string | null
  outlet_radius_m?: number | null
  outlet_lat?: number | null
  outlet_lng?: number | null
}

/** A visit shorter than this, once closed, is a short one (the default). */
export const SHORT_MINUTES = 10
/** Arriving off site further than this from the store is worth a look. */
export const FAR_M = 300
/** Faster than this between two stores, in Lagos traffic, is not a real trip. */
export const HOP_KMH = 80
/** Hops shorter than this are ignored: two shops on one street. */
export const HOP_MIN_M = 1000

export type VisitView = 'visits' | 'stores' | 'people' | 'coverage'
const VIEWS: VisitView[] = ['visits', 'stores', 'people', 'coverage']
export const GAPS = [7, 14, 30] as const

export interface VisitFilter {
  from: string | null
  to: string | null
  user_id: string | null
  outlet_id: string | null
  /** on_site, off_site, flagged or none (a shop Xtend does not know). */
  status: string | null
  /** A supervisor's id: their team only. */
  team: string | null
  /** Only closed visits shorter than this many minutes. */
  short: number | null
  view: VisitView
  /** Coverage: only stores not visited in this many days. */
  gap: number | null
  limit?: number
}

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const isId = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

export function parseVisitFilter(params: URLSearchParams | Record<string, string | string[] | undefined>): VisitFilter {
  const get = (k: string) => {
    const raw = params instanceof URLSearchParams ? params.get(k) : params[k]
    const v = Array.isArray(raw) ? raw[0] : raw
    return v && v !== 'all' ? v.slice(0, 80) : null
  }
  const status = get('status')
  const short = Number(get('short'))
  const gap = Number(get('gap'))
  return {
    from: isDate(get('from')),
    to: isDate(get('to')),
    user_id: isId(get('user_id')),
    outlet_id: isId(get('outlet_id')),
    status: status && ['on_site', 'off_site', 'flagged', 'none'].includes(status) ? status : null,
    team: isId(get('team')),
    short: Number.isInteger(short) && short > 0 && short <= 240 ? short : null,
    view: VIEWS.includes(get('view') as VisitView) ? (get('view') as VisitView) : 'visits',
    gap: (GAPS as readonly number[]).includes(gap) ? gap : null,
  }
}

export function visitQueryString(f: Partial<VisitFilter>) {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.user_id) p.set('user_id', f.user_id)
  if (f.outlet_id) p.set('outlet_id', f.outlet_id)
  if (f.status) p.set('status', f.status)
  if (f.team) p.set('team', f.team)
  if (f.short) p.set('short', String(f.short))
  if (f.view && f.view !== 'visits') p.set('view', f.view)
  if (f.gap) p.set('gap', String(f.gap))
  return p.toString()
}

const closed = (v: VisitRow) => Boolean(v.departed_at)
const storeKey = (v: VisitRow) => v.outlet_id ?? `map:${(v.store_label ?? 'Unnamed place').toLowerCase()}`
export const storeName = (v: VisitRow) => v.store_label ?? v.outlet_name ?? 'Unnamed place'

/** The figures across the top of the page. */
export function visitFigures(visits: VisitRow[], shortMinutes = SHORT_MINUTES) {
  const done = visits.filter(closed)
  const minutes = done.reduce((t, v) => t + v.minutes, 0)
  return {
    visits: visits.length,
    stores: new Set(visits.map(storeKey)).size,
    people: new Set(visits.map((v) => v.user_id)).size,
    minutes,
    averageMinutes: done.length ? Math.round(minutes / done.length) : null,
    short: done.filter((v) => v.minutes < shortMinutes).length,
    offSite: visits.filter((v) => v.arrived_status === 'off_site').length,
    rough: visits.filter((v) => v.arrived_status === 'flagged').length,
    open: visits.filter((v) => !closed(v)).length,
  }
}

export interface Breakdown {
  key: string
  name: string
  /** The person's id on a per-person row; the outlet's (if known) on a per-store row. */
  id: string | null
  visits: number
  /** People on a per-store row, stores on a per-person row. */
  other: number
  minutes: number
  averageMinutes: number | null
  short: number
  offSite: number
  last: string
}

function breakdown(visits: VisitRow[], keyOf: (v: VisitRow) => string, nameOf: (v: VisitRow) => string,
  idOf: (v: VisitRow) => string | null, otherOf: (v: VisitRow) => string, shortMinutes: number): Breakdown[] {
  const groups = new Map<string, VisitRow[]>()
  for (const v of visits) groups.set(keyOf(v), [...(groups.get(keyOf(v)) ?? []), v])
  return [...groups.entries()]
    .map(([key, rows]) => {
      const done = rows.filter(closed)
      const minutes = done.reduce((t, v) => t + v.minutes, 0)
      return {
        key,
        name: nameOf(rows[0]),
        id: idOf(rows[0]),
        visits: rows.length,
        other: new Set(rows.map(otherOf)).size,
        minutes,
        averageMinutes: done.length ? Math.round(minutes / done.length) : null,
        short: done.filter((v) => v.minutes < shortMinutes).length,
        offSite: rows.filter((v) => v.arrived_status === 'off_site').length,
        last: rows.reduce((a, v) => (v.arrived_at > a ? v.arrived_at : a), rows[0].arrived_at),
      }
    })
    .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))
}

export const storeBreakdown = (visits: VisitRow[], shortMinutes = SHORT_MINUTES) =>
  breakdown(visits, storeKey, storeName, (v) => v.outlet_id, (v) => v.user_id, shortMinutes)

export const personBreakdown = (visits: VisitRow[], shortMinutes = SHORT_MINUTES) =>
  breakdown(visits, (v) => v.user_id, (v) => v.staff_name, (v) => v.user_id, storeKey, shortMinutes)

export interface Finding {
  kind: 'short' | 'far' | 'hop'
  visitId: string
  userId: string
  name: string
  date: string
  at: string
  text: string
}

/**
 * Two visits back to back, too far apart for the time between them: from
 * where they checked out of one to where they checked in at the next.
 */
export function hops(visits: VisitRow[]) {
  const byDay = new Map<string, VisitRow[]>()
  for (const v of visits) {
    const k = `${v.user_id}|${v.visit_date}`
    byDay.set(k, [...(byDay.get(k) ?? []), v])
  }
  const found: { from: VisitRow; to: VisitRow; distanceM: number; minutes: number; kmh: number }[] = []
  for (const rows of byDay.values()) {
    const sorted = [...rows].sort((a, b) => a.arrived_at.localeCompare(b.arrived_at))
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const aLat = a.departed_lat ?? a.arrived_lat
      const aLng = a.departed_lng ?? a.arrived_lng
      if (!a.departed_at || aLat == null || aLng == null || b.arrived_lat == null || b.arrived_lng == null) continue
      const distanceM = metresBetween(aLat, aLng, b.arrived_lat, b.arrived_lng)
      const minutes = Math.max(1, (Date.parse(b.arrived_at) - Date.parse(a.departed_at)) / 60000)
      const kmh = distanceM / 1000 / (minutes / 60)
      if (distanceM >= HOP_MIN_M && kmh > HOP_KMH) found.push({ from: a, to: b, distanceM, minutes, kmh })
    }
  }
  return found
}

/** Very short visits, check-ins far from the store, and impossible trips. */
export function worthALook(visits: VisitRow[], shortMinutes = SHORT_MINUTES): Finding[] {
  const out: Finding[] = []
  const base = (v: VisitRow) => ({ visitId: v.id, userId: v.user_id, name: v.staff_name, date: v.visit_date, at: v.arrived_at })
  for (const v of visits) {
    if (closed(v) && v.minutes < shortMinutes) {
      out.push({
        ...base(v),
        kind: 'short',
        text: `only ${v.minutes} min at ${storeName(v)} (${formatLagos(v.arrived_at, false)} to ${formatLagos(v.departed_at, false)})`,
      })
    }
    if (v.arrived_status === 'off_site' && (v.arrived_distance_m ?? 0) >= FAR_M) {
      out.push({
        ...base(v),
        kind: 'far',
        text: `checked in at ${v.outlet_name ?? storeName(v)} from ${metres(v.arrived_distance_m)} away, at ${formatLagos(v.arrived_at, false)}${
          v.arrived_label ? ` (${v.arrived_label})` : ''
        }`,
      })
    }
  }
  for (const h of hops(visits)) {
    out.push({
      ...base(h.to),
      kind: 'hop',
      text: `left ${storeName(h.from)} at ${formatLagos(h.from.departed_at, false)} and checked in at ${storeName(h.to)} ${metres(h.distanceM)} away ${duration(h.minutes)} later (about ${Math.round(h.kmh)} km/h)`,
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** The reasons one visit is worth a look, for its row and the download. */
export function visitFlags(v: VisitRow, findings: Finding[]) {
  return findings.filter((f) => f.visitId === v.id).map((f) => f.kind)
}

export const FLAG_WORDS: Record<Finding['kind'], string> = {
  short: 'Very short',
  far: 'Far from the store',
  hop: 'Too far from the last store',
}

export interface CoverageRow {
  outlet_id: string
  name: string
  address: string | null
  lat: number
  lng: number
  is_active: boolean
  staff_assigned: number
  last_visit_at: string | null
  last_visit_date: string | null
  last_visit_user_id: string | null
  last_visit_by: string | null
  visits_30d: number
}

export interface Covered extends CoverageRow {
  /** Days since the last visit; null when there has never been one. */
  daysSince: number | null
}

const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/**
 * Every store the reader looks after, longest without a visit first. An
 * admin sees every active store; a supervisor (all = false) the ones their
 * team covers or has visited.
 */
export function coverage(rows: CoverageRow[], today: string, all: boolean): Covered[] {
  return rows
    .filter((r) => r.is_active && (all || r.staff_assigned > 0 || r.last_visit_at))
    .map((r) => ({ ...r, daysSince: r.last_visit_date ? Math.max(0, daysFrom(r.last_visit_date, today)) : null }))
    .sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9) || a.name.localeCompare(b.name))
}

/** Not visited in this many days (or never). */
export const notVisitedIn = (rows: Covered[], days: number) => rows.filter((r) => r.daysSince === null || r.daysSince >= days)

export function coverageCounts(rows: Covered[]) {
  return {
    stores: rows.length,
    never: rows.filter((r) => r.daysSince === null).length,
    ...Object.fromEntries(GAPS.map((g) => [`over${g}`, notVisitedIn(rows, g).length])),
  } as { stores: number; never: number; over7: number; over14: number; over30: number }
}

/** Movement for one person over the days in question. */
export function movementHref(userId: string, date: string, until?: string | null) {
  const end = until && until > date ? (until > addDays(date, 6) ? addDays(date, 6) : until) : date
  return `/admin/tracking?person=${userId}&date=${date}&until=${end}`
}
