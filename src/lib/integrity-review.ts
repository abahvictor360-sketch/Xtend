import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportRow, Sheet } from '@/lib/export/render'
import { FLAG_KINDS } from '@/lib/integrity'
import { addDays, formatLagos, lagosDateString } from '@/lib/utils'

/**
 * The Integrity page, its download and Ask Xtend's risk answer all read
 * flags the same way: a date range, a few filters, the people to look at
 * first, the flags per day, and each flag's detail in plain words. Pure,
 * apart from fetchIntegrity(), so scripts/check-integrity-ask.ts can run it.
 */

export type Severity = 'low' | 'medium' | 'high'
export const SEVERITIES: Severity[] = ['high', 'medium', 'low']
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' }

export interface FlagRow {
  id: string
  user_id: string
  staff_name: string
  kind: string
  severity: Severity
  summary: string
  detail: Record<string, unknown> | null
  outlet_id: string | null
  outlet_name: string | null
  flag_date: string
  created_at: string
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
}

export type ReviewStatus = 'open' | 'reviewed' | 'all'

export interface IntegrityFilter {
  from: string
  to: string
  kind: string | null
  severity: Severity | null
  person: string | null
  store: string | null
  status: ReviewStatus
  q: string | null
}

/** The widest range the page reads at once. */
export const MAX_DAYS = 120
export const DEFAULT_DAYS = 30

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

export function parseIntegrityFilter(
  params: URLSearchParams | Record<string, string | undefined>,
  today = lagosDateString(),
): IntegrityFilter {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k]
    return v && v !== 'all' ? v.slice(0, 120) : null
  }
  const date = (k: string) => {
    const v = get(k)
    return v && DATE.test(v) && v <= today ? v : null
  }
  let to = date('to') ?? today
  let from = date('from') ?? addDays(to, -(DEFAULT_DAYS - 1))
  if (from > to) [from, to] = [to, from]
  if (daysBetween(from, to) > MAX_DAYS - 1) from = addDays(to, -(MAX_DAYS - 1))
  const id = (k: string) => {
    const v = get(k)
    return v && UUID.test(v) ? v : null
  }
  const kind = get('kind')
  const severity = get('severity')
  const status = params instanceof URLSearchParams ? params.get('status') : params.status
  return {
    from,
    to,
    kind: kind && kind in FLAG_KINDS ? kind : null,
    severity: severity && (SEVERITIES as string[]).includes(severity) ? (severity as Severity) : null,
    person: id('person'),
    store: id('store'),
    status: status === 'reviewed' || status === 'all' ? status : 'open',
    q: get('q')?.trim() || null,
  }
}

export function integrityQueryString(f: IntegrityFilter) {
  const p = new URLSearchParams()
  p.set('from', f.from)
  p.set('to', f.to)
  if (f.kind) p.set('kind', f.kind)
  if (f.severity) p.set('severity', f.severity)
  if (f.person) p.set('person', f.person)
  if (f.store) p.set('store', f.store)
  if (f.status !== 'open') p.set('status', f.status)
  if (f.q) p.set('q', f.q)
  return p.toString()
}

/**
 * Every flag in the range, for the person and store asked for, newest
 * first. Kind, severity, review status and search are applied afterwards
 * (applyIntegrityFilter), so the page can count what each filter holds.
 */
export async function fetchIntegrity(supabase: SupabaseClient, f: IntegrityFilter, limit = 2000) {
  let query = supabase
    .from('integrity_flag_detail')
    .select('id, user_id, staff_name, kind, severity, summary, detail, outlet_id, outlet_name, flag_date, created_at, reviewed_at, reviewed_by_name, review_note')
    .gte('flag_date', f.from)
    .lte('flag_date', f.to)
    .order('created_at', { ascending: false })
    .limit(limit + 1)
  if (f.person) query = query.eq('user_id', f.person)
  if (f.store) query = query.eq('outlet_id', f.store)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as FlagRow[]
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

export function applyIntegrityFilter(rows: FlagRow[], f: IntegrityFilter) {
  const q = f.q?.toLowerCase()
  return rows.filter((r) => {
    if (f.kind && r.kind !== f.kind) return false
    if (f.severity && r.severity !== f.severity) return false
    if (f.status === 'open' && r.reviewed_at) return false
    if (f.status === 'reviewed' && !r.reviewed_at) return false
    if (q) {
      const hay = [r.staff_name, r.summary, r.outlet_name, kindLabel(r.kind), r.review_note].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function kindLabel(kind: string) {
  return FLAG_KINDS[kind]?.label ?? kind.replace(/_/g, ' ')
}

/** How many of each, most first. */
export function countBy<T extends string>(rows: FlagRow[], key: (r: FlagRow) => T) {
  const counts = new Map<T, { total: number; open: number }>()
  for (const r of rows) {
    const k = key(r)
    const c = counts.get(k) ?? { total: 0, open: 0 }
    c.total++
    if (!r.reviewed_at) c.open++
    counts.set(k, c)
  }
  return [...counts.entries()].map(([k, c]) => ({ key: k, ...c })).sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------
// Who to look at first.
// ---------------------------------------------------------------------

export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 5, medium: 2, low: 1 }

/** Flags that are the phone's own word, not a guess: one is enough to act. */
export const PROOF_KINDS = ['mock_location_confirmed', 'device_integrity_failed', 'backdated_clock']

export type RiskLevel = 'act' | 'watch' | 'note'
export const RISK_LABEL: Record<RiskLevel, string> = { act: 'Act now', watch: 'Keep an eye', note: 'Minor' }

export interface RiskPerson {
  user_id: string
  name: string
  score: number
  level: RiskLevel
  open: number
  high: number
  medium: number
  low: number
  /** The most recent open flag's day: where Movement and the excuse check start. */
  lastDate: string
  kinds: { kind: string; count: number; days: number }[]
  reason: string
}

/**
 * People ranked by their open flags, weighted: high 5, medium 2, low 1,
 * halved when older than a week, and 5 more for each flag that is proof
 * rather than a sign. Reviewed flags do not count.
 */
export function personRisk(rows: FlagRow[], today = lagosDateString()): RiskPerson[] {
  const weekAgo = addDays(today, -6)
  const byPerson = new Map<string, FlagRow[]>()
  for (const r of rows) {
    if (r.reviewed_at) continue
    byPerson.set(r.user_id, [...(byPerson.get(r.user_id) ?? []), r])
  }

  const people: RiskPerson[] = []
  for (const [userId, flags] of byPerson) {
    let score = 0
    let proof = 0
    for (const f of flags) {
      score += SEVERITY_WEIGHT[f.severity] * (f.flag_date >= weekAgo ? 1 : 0.5)
      if (PROOF_KINDS.includes(f.kind)) {
        score += 5
        proof++
      }
    }
    const kinds = new Map<string, { count: number; days: Set<string> }>()
    for (const f of flags) {
      const k = kinds.get(f.kind) ?? { count: 0, days: new Set<string>() }
      k.count++
      k.days.add(f.flag_date)
      kinds.set(f.kind, k)
    }
    const kindList = [...kinds.entries()]
      .map(([kind, k]) => ({ kind, count: k.count, days: k.days.size }))
      .sort((a, b) => b.count - a.count || kindLabel(a.kind).localeCompare(kindLabel(b.kind)))
    const sev = (s: Severity) => flags.filter((f) => f.severity === s).length
    const level: RiskLevel = proof > 0 || score >= 10 ? 'act' : score >= 4 ? 'watch' : 'note'
    people.push({
      user_id: userId,
      name: flags[0].staff_name,
      score: Math.round(score * 10) / 10,
      level,
      open: flags.length,
      high: sev('high'),
      medium: sev('medium'),
      low: sev('low'),
      lastDate: flags.map((f) => f.flag_date).sort().at(-1)!,
      kinds: kindList,
      reason: riskReason(flags, kindList, weekAgo),
    })
  }
  return people.sort((a, b) => b.score - a.score || b.open - a.open || a.name.localeCompare(b.name))
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "3 high flags this week: Same GPS point again on 2 different days, VPN or proxy. Includes proof: Fake GPS confirmed." */
export function riskReason(
  flags: FlagRow[],
  kinds: { kind: string; count: number; days: number }[],
  weekAgo: string,
) {
  const highWeek = flags.filter((f) => f.severity === 'high' && f.flag_date >= weekAgo).length
  const recent = flags.filter((f) => f.flag_date >= weekAgo).length
  const lead =
    highWeek > 0
      ? `${plural(highWeek, 'high flag')} this week`
      : recent > 0
        ? `${plural(recent, 'open flag')} this week`
        : `${plural(flags.length, 'open flag')}, none this week`
  const parts = kinds.slice(0, 3).map((k) =>
    k.days > 1
      ? `${kindLabel(k.kind)} on ${k.days} different days`
      : k.count > 1
        ? `${kindLabel(k.kind)} ×${k.count}`
        : kindLabel(k.kind),
  )
  const more = kinds.length > 3 ? ` and ${plural(kinds.length - 3, 'other kind')}` : ''
  const proof = kinds.filter((k) => PROOF_KINDS.includes(k.kind)).map((k) => kindLabel(k.kind))
  return `${lead}: ${parts.join(', ')}${more}.${proof.length ? ` Includes proof: ${proof.join(', ')}.` : ''}`
}

// ---------------------------------------------------------------------
// Flags per day.
// ---------------------------------------------------------------------

export interface DayCount {
  date: string
  high: number
  medium: number
  low: number
  total: number
}

export function flagsPerDay(rows: FlagRow[], from: string, to: string): DayCount[] {
  const days = new Map<string, DayCount>()
  for (let d = from, i = 0; d <= to && i < MAX_DAYS; d = addDays(d, 1), i++) {
    days.set(d, { date: d, high: 0, medium: 0, low: 0, total: 0 })
  }
  for (const r of rows) {
    const day = days.get(r.flag_date)
    if (!day) continue
    day[r.severity]++
    day.total++
  }
  return [...days.values()]
}

// ---------------------------------------------------------------------
// A flag's detail, in words.
// ---------------------------------------------------------------------

export interface ProductLine {
  product: string
  last_left: number
  sold: number
  left: number
  missing: number
}

export interface DetailFacts {
  facts: { label: string; value: string }[]
  products: ProductLine[]
  map: string | null
}

const HIDDEN = new Set(['attendance_id', 'count_id', 'product_id', 'previous_count_id', 'place_id', 'verdict', 'products', 'lat', 'lng'])

const SOURCE: Record<string, string> = {
  clock_in: 'a clock-in',
  opening: 'a clock-in',
  closing: 'a clock-out',
  visit: 'a store visit',
  store_visit: 'a store visit',
  ping: 'location while on shift',
  offline_positions: 'positions saved offline',
  background: 'tracking with the app closed',
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null)
const yesNo = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : String(v))
const minutesText = (m: number) => (m >= 90 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`)
const humanKey = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')

function when(v: unknown) {
  if (typeof v !== 'string' || isNaN(Date.parse(v))) return String(v)
  return formatLagos(v)
}

function plain(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return yesNo(v)
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined)
      .map(([k, x]) => `${humanKey(k).toLowerCase()} ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
      .join(', ') || 'none'
  }
  return String(v)
}

/** Turns a flag's detail jsonb into labelled facts a supervisor can read. */
export function detailFacts(kind: string, detail: Record<string, unknown> | null | undefined): DetailFacts {
  const d = detail ?? {}
  const facts: { label: string; value: string }[] = []
  const add = (label: string, value: string) => facts.push({ label, value })
  const lat = num(d.lat)
  const lng = num(d.lng)
  if (lat != null && lng != null) add('GPS point', `${lat.toFixed(6)}, ${lng.toFixed(6)}`)

  for (const [k, v] of Object.entries(d)) {
    if (HIDDEN.has(k) || v === null || v === undefined || v === '') continue
    const n = num(v)
    switch (k) {
      case 'source':
        add('Seen in', SOURCE[String(v)] ?? String(v).replace(/_/g, ' '))
        break
      case 'km':
        add('Distance', `${n ?? v} km`)
        break
      case 'minutes':
        add(
          kind === 'late_clock_in' ? 'Minutes late' : kind === 'early_clock_out' ? 'Minutes early' : 'Time between readings',
          n != null ? minutesText(n) : String(v),
        )
        break
      case 'accuracy_m':
        add('Accuracy the phone claimed', n != null ? `${Math.round(n * 10) / 10} m` : String(v))
        break
      case 'ip':
        add('Internet address', String(v))
        break
      case 'ip_country':
      case 'country':
        add('Country of the internet address', String(v))
        break
      case 'proxy':
        add('VPN or proxy', yesNo(v))
        break
      case 'hosting':
        add('Datacentre address', yesNo(v))
        break
      case 'mobile':
        add('Mobile network', yesNo(v))
        break
      case 'tz':
        add('Phone time zone', String(v))
        break
      case 'tz_offset_min':
        add('Phone offset', n != null ? `UTC${n <= 0 ? '+' : '-'}${Math.abs(n) / 60}` : String(v))
        break
      case 'platform':
        add('Phone', v === 'ios' ? 'iPhone' : v === 'android' ? 'Android' : String(v))
        break
      case 'offset_s':
        add(
          'Phone clock',
          n == null ? String(v) : Math.abs(n) < 60 ? 'right' : `${Math.round(Math.abs(n) / 60)} min ${n > 0 ? 'ahead' : 'behind'}`,
        )
        break
      case 'lag_s':
        add('Sent after', n != null ? minutesText(n / 60) : String(v))
        break
      case 'taken_at':
        add('Really taken at', when(v))
        break
      case 'contact_at':
        add('Phone was in touch with Xtend at', when(v))
        break
      case 'last_contact_at':
        add('Last in touch before that', when(v))
        break
      case 'how':
        add('How we know', v === 'anchor' ? 'a later message from the phone' : v === 'nothing_waiting' ? 'the phone said nothing was waiting to upload' : String(v))
        break
      case 'refused':
        add('Positions refused', String(v))
        break
      case 'positions':
        add('Positions from a fake-GPS app', String(v))
        break
      case 'times':
        add('Times seen there', String(v))
        break
      case 'previous_units':
        add('Last count', String(v))
        break
      case 'supplied':
        add('Supplied since', String(v))
        break
      case 'sold':
        add('Sold since', String(v))
        break
      case 'expected':
        add('Expected on the shelf', String(v))
        break
      case 'actual':
        add('Counted', String(v))
        break
      case 'variance_pct':
        add('Difference', `${n ?? v}%`)
        break
      case 'gps': {
        const g = v as Record<string, unknown>
        const missing = ['altitude', 'speed', 'heading'].filter((x) => g?.[x] === null || g?.[x] === undefined)
        add('GPS extras', missing.length === 3 ? 'no altitude, speed or heading (a bare coordinate)' : plain(v))
        break
      }
      default:
        add(humanKey(k), plain(v))
    }
  }

  const products = Array.isArray(d.products)
    ? (d.products as Record<string, unknown>[])
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          product: String(p.product ?? 'Product'),
          last_left: num(p.last_left) ?? 0,
          sold: num(p.sold) ?? 0,
          left: num(p.left) ?? 0,
          missing: num(p.missing) ?? 0,
        }))
    : []

  return { facts, products, map: lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null }
}

/** One line of the detail, for a spreadsheet cell or the assistant. */
export function detailText(kind: string, detail: Record<string, unknown> | null | undefined) {
  const { facts, products } = detailFacts(kind, detail)
  return [
    ...facts.map((f) => `${f.label}: ${f.value}`),
    ...products.map((p) => `${p.product}: ${p.last_left} left last time, ${p.sold} sold, counted ${p.left}, ${p.missing} missing`),
  ].join('; ')
}

// ---------------------------------------------------------------------
// Where to look next.
// ---------------------------------------------------------------------

export interface FlagLink {
  label: string
  href: string
}

export function flagLinks(f: Pick<FlagRow, 'user_id' | 'flag_date' | 'kind'>): FlagLink[] {
  const who = `person=${encodeURIComponent(f.user_id)}&date=${f.flag_date}`
  const links: FlagLink[] = [
    { label: 'Movement that day', href: `/admin/tracking?${who}` },
    { label: 'Check an excuse', href: `/admin/excuses?${who}` },
  ]
  if (f.kind === 'own_named_place') links.push({ label: 'Places', href: '/admin/places' })
  if (['count_units_missing', 'count_identical', 'count_round_numbers'].includes(f.kind)) {
    links.push({ label: 'Stock counts', href: `/admin/store-counts?from=${f.flag_date}&to=${f.flag_date}` })
  }
  if (f.kind === 'stock_discrepancy') links.push({ label: 'X Metrics', href: '/admin/metrics' })
  return links
}

// ---------------------------------------------------------------------
// The download.
// ---------------------------------------------------------------------

export const INTEGRITY_COLUMNS = ['Day', 'Raised', 'Person', 'Severity', 'Check', 'What happened', 'Store', 'Detail', 'Reviewed', 'Reviewed by', 'Note'] as const

export function integritySheet(rows: FlagRow[], f: IntegrityFilter, today = lagosDateString()): Sheet {
  const risk = personRisk(rows, today).filter((p) => p.level !== 'note').slice(0, 5)
  const open = rows.filter((r) => !r.reviewed_at).length
  const exportRows: ExportRow[] = rows.map((r) => ({
    values: [
      r.flag_date,
      formatLagos(r.created_at),
      r.staff_name,
      SEVERITY_LABEL[r.severity] ?? r.severity,
      kindLabel(r.kind),
      r.summary,
      r.outlet_name ?? '',
      detailText(r.kind, r.detail),
      r.reviewed_at ? formatLagos(r.reviewed_at) : 'Not yet',
      r.reviewed_by_name ?? '',
      r.review_note ?? '',
    ],
  }))
  const which = [
    f.status === 'open' ? 'to review' : f.status === 'reviewed' ? 'reviewed' : 'all',
    f.kind ? kindLabel(f.kind) : null,
    f.severity ? `${SEVERITY_LABEL[f.severity].toLowerCase()} severity` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return {
    title: 'Integrity checks',
    subtitle: `${f.from} to ${f.to} · ${which} · ${rows.length} flag${rows.length === 1 ? '' : 's'}, ${open} not yet reviewed`,
    notes:
      'Things that looked wrong: signs of a fake-location app, phone clocks changed, photos refused, and stock counts that do not add up. A flag is a reason to look, not proof.' +
      (risk.length ? `\nLook at first: ${risk.map((p) => `${p.name} (${p.reason})`).join(' ')}` : ''),
    wrap: true,
    sheetName: 'Integrity',
    columns: INTEGRITY_COLUMNS,
    rows: exportRows,
    widths: {
      xlsx: [11, 18, 20, 9, 22, 48, 22, 50, 18, 18, 30],
      pdf: [44, 58, 64, 36, 66, 120, 64, 130, 56, 52, 70],
    },
    fileBase: 'xtend-integrity',
  }
}
