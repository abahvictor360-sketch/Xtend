import type { ExportRow, Sheet } from '@/lib/export/render'
import { addDays, formatLagos, lagosDateString, longDate } from '@/lib/utils'

/**
 * The Activity log (migration 062) as the page and its downloads read it:
 * what each person did in Xtend, when, on what device and from what
 * address. Pure, so scripts/check-activity.ts can exercise it. Admins only;
 * nothing here is ever shown to staff.
 */

export interface ActivityRow {
  at: string
  user_id: string
  full_name: string
  role: string
  kind: string
  label: string
  detail: Record<string, unknown> | null
  ip: string | null
  platform: 'web' | 'android' | 'ios' | null
  device: string | null
  user_agent: string | null
}

/** The kinds of activity, grouped the way the filter offers them. */
export const ACTIVITY_GROUPS = {
  signin: { label: 'Signing in and out', kinds: ['sign_in', 'sign_out'] },
  app: { label: 'Opening the app', kinds: ['app_open'] },
  clock: { label: 'Clocking in and out', kinds: ['clock_in', 'clock_out'] },
  visits: { label: 'Store visits', kinds: ['visit_in', 'visit_out'] },
  work: { label: 'Reports and counts', kinds: ['report', 'stock_count', 'xm_count', 'xm_sales'] },
  leave: { label: 'Leave', kinds: ['leave_applied', 'leave_cancelled'] },
  support: { label: 'Support messages', kinds: ['support_message'] },
  account: { label: 'Password and photo', kinds: ['password_changed', 'photo_changed'] },
} as const

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS

export const isActivityGroup = (v: unknown): v is ActivityGroup =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_GROUPS, v)

export function filterKinds(group: ActivityGroup | null): string[] | null {
  return group ? [...ACTIVITY_GROUPS[group].kinds] : null
}

export function kindGroup(kind: string): ActivityGroup | null {
  for (const [g, def] of Object.entries(ACTIVITY_GROUPS)) {
    if ((def.kinds as readonly string[]).includes(kind)) return g as ActivityGroup
  }
  return null
}

/** Not counted as "actions": being signed in, and the app being open. */
const PRESENCE = new Set(['sign_in', 'sign_out', 'app_open'])

export interface ActivityFilter {
  from: string
  to: string
  person: string | null
  group: ActivityGroup | null
}

/** The longest range the page asks for at once. */
export const MAX_RANGE_DAYS = 92

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Today by default; dates in order, never after today, at most MAX_RANGE_DAYS. */
export function parseActivityFilter(
  params: URLSearchParams | Record<string, string | undefined>,
  today = lagosDateString(),
): ActivityFilter {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k]
    return v && v !== 'all' ? v.slice(0, 80) : null
  }
  const date = (k: string) => {
    const v = get(k)
    return v && realDate(v) ? (v > today ? today : v) : null
  }
  let from = date('from')
  let to = date('to')
  if (!from && !to) from = to = today
  else if (!from) from = to
  else if (!to) to = today
  if (from! > to!) [from, to] = [to, from]
  if (daysBetween(from!, to!) > MAX_RANGE_DAYS) from = addDays(to!, -(MAX_RANGE_DAYS - 1))
  const person = get('person')
  const group = get('group')
  return {
    from: from!,
    to: to!,
    person: person && UUID.test(person) ? person : null,
    group: isActivityGroup(group) ? group : null,
  }
}

/** "2026-02-30" looks like a date but is not one. */
function realDate(v: string) {
  if (!DATE.test(v)) return false
  const t = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1
}

export function activityQueryString(f: Partial<ActivityFilter>) {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.person) p.set('person', f.person)
  if (f.group) p.set('group', f.group)
  return p.toString()
}

export function activityPresets(today = lagosDateString()) {
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
  ]
}

export function platformLabel(p: ActivityRow['platform']) {
  return p === 'android' ? 'Android app' : p === 'ios' ? 'iPhone app' : p === 'web' ? 'Web' : null
}

/** Device and platform in one short line, e.g. "Xtend app on Android 14 · Android app". */
export function deviceText(r: Pick<ActivityRow, 'device' | 'platform'>) {
  return [r.device, platformLabel(r.platform)].filter(Boolean).join(' · ') || 'Unknown device'
}

const STATUS: Record<string, string> = { on_site: 'on site', off_site: 'off site', flagged: 'flagged' }
const LEAVE: Record<string, string> = { annual: 'Annual leave', sick: 'Sick leave', casual: 'Casual leave', other: 'Leave' }

function shortDate(d: unknown) {
  if (typeof d !== 'string' || !DATE.test(d)) return null
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
}

/** The detail as plain words, short enough for a cell. */
export function detailText(r: Pick<ActivityRow, 'kind' | 'detail'>) {
  const d = r.detail ?? {}
  const parts: string[] = []
  if (typeof d.status === 'string' && STATUS[d.status]) parts.push(STATUS[d.status])
  if (typeof d.distance_m === 'number' && r.kind !== 'visit_out') parts.push(`${d.distance_m} m from the store`)
  if (typeof d.minutes === 'number') parts.push(`${d.minutes} min in the store`)
  if (typeof d.place === 'string' && d.place !== d.store) parts.push(d.place)
  if (typeof d.products === 'number') parts.push(`${d.products} product${d.products === 1 ? '' : 's'}`)
  if (typeof d.visits === 'number' && d.visits > 0) parts.push(`${d.visits} store visit${d.visits === 1 ? '' : 's'}`)
  if (r.kind.startsWith('leave_')) {
    const from = shortDate(d.from)
    const to = shortDate(d.to)
    parts.push(`${LEAVE[String(d.type)] ?? 'Leave'}${from ? `, ${from}${to && to !== from ? ` to ${to}` : ''}` : ''}`)
  }
  if (typeof d.subject === 'string' && d.subject) parts.push(`“${d.subject}”`)
  if (d.reason === 'new-day') parts.push('a new day')
  if (d.reason === 'clocked-out') parts.push('after clocking out')
  if (d.first === true) parts.push('replacing the temporary password')
  if (typeof d.app_build === 'number') parts.push(`app build ${d.app_build}`)
  return parts.join(' · ')
}

/** "2026-10-22" for an instant, in Lagos. */
export const lagosDay = (at: string) => lagosDateString(new Date(at))

/** Rows (newest first) grouped by Lagos day, newest day first. */
export function groupByDay(rows: ActivityRow[]) {
  const days = new Map<string, { day: string; title: string; rows: ActivityRow[] }>()
  for (const r of rows) {
    const day = lagosDay(r.at)
    if (!days.has(day)) days.set(day, { day, title: longDate(day), rows: [] })
    days.get(day)!.rows.push(r)
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
}

export interface PersonActivity {
  user_id: string
  full_name: string
  role: string
  first: string
  last: string
  signIns: number
  appOpens: number
  actions: number
  total: number
  lastDevice: string | null
  lastPlatform: ActivityRow['platform']
  lastIp: string | null
}

/** One line per person: busiest first, then most recently active. */
export function perPerson(rows: ActivityRow[]): PersonActivity[] {
  const map = new Map<string, PersonActivity>()
  // Oldest first, so "last device" ends up as the newest one known.
  for (const r of [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    let p = map.get(r.user_id)
    if (!p) {
      p = {
        user_id: r.user_id,
        full_name: r.full_name,
        role: r.role,
        first: r.at,
        last: r.at,
        signIns: 0,
        appOpens: 0,
        actions: 0,
        total: 0,
        lastDevice: null,
        lastPlatform: null,
        lastIp: null,
      }
      map.set(r.user_id, p)
    }
    p.last = r.at
    p.total++
    if (r.kind === 'sign_in') p.signIns++
    else if (r.kind === 'app_open') p.appOpens++
    else if (!PRESENCE.has(r.kind)) p.actions++
    if (r.device) p.lastDevice = r.device
    if (r.platform) p.lastPlatform = r.platform
    if (r.ip) p.lastIp = r.ip
  }
  return [...map.values()].sort((a, b) => b.total - a.total || Date.parse(b.last) - Date.parse(a.last))
}

export interface ActivitySummary {
  people: number
  signIns: number
  appOpens: number
  actions: number
  mostActive: { name: string; count: number } | null
}

export function summarise(rows: ActivityRow[]): ActivitySummary {
  const people = perPerson(rows)
  const top = people[0]
  return {
    people: people.length,
    signIns: rows.filter((r) => r.kind === 'sign_in').length,
    appOpens: rows.filter((r) => r.kind === 'app_open').length,
    actions: rows.filter((r) => !PRESENCE.has(r.kind)).length,
    mostActive: top ? { name: top.full_name, count: top.total } : null,
  }
}

const ROLE: Record<string, string> = {
  merchandiser: 'Merchandiser',
  marketer: 'Marketer',
  supervisor: 'Supervisor',
  admin: 'Admin',
}
export const roleLabel = (role: string) => ROLE[role] ?? role

/** Where to look at this person's day: their movement and their attendance. */
export function personLinks(userId: string, from: string, to: string) {
  return {
    movement: `/admin/tracking?person=${userId}&date=${from}${to !== from ? `&until=${to}` : ''}`,
    attendance: `/admin/attendance?user_id=${userId}&from=${from}&to=${to}`,
  }
}

export const ACTIVITY_COLUMNS = ['When', 'Person', 'Role', 'What', 'Detail', 'Platform', 'Device', 'IP address'] as const

export function activityExportRows(rows: ActivityRow[]): ExportRow[] {
  return rows.map((r) => ({
    values: [
      formatLagos(r.at),
      r.full_name,
      roleLabel(r.role),
      r.label,
      detailText(r),
      platformLabel(r.platform) ?? '',
      r.device ?? '',
      r.ip ?? '',
    ],
  }))
}

export function activitySheet(rows: ActivityRow[], f: ActivityFilter, people: { id: string; full_name: string }[] = []): Sheet {
  const range = f.from === f.to ? longDate(f.from) : `${longDate(f.from)} to ${longDate(f.to)}`
  const who = f.person ? people.find((p) => p.id === f.person)?.full_name ?? 'One person' : 'Everyone'
  const what = f.group ? ACTIVITY_GROUPS[f.group].label : 'All activity'
  const s = summarise(rows)
  return {
    title: 'Activity log',
    subtitle: `${range} · ${who} · ${what} · ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`,
    notes:
      `What each person did in Xtend, newest first, in Lagos time. ${s.people} ${s.people === 1 ? 'person was' : 'people were'} active: ` +
      `${s.signIns} sign-in${s.signIns === 1 ? '' : 's'}, ${s.appOpens} app open${s.appOpens === 1 ? '' : 's'} and ${s.actions} other action${s.actions === 1 ? '' : 's'}. ` +
      'App opens are kept at most once every 30 minutes per person and device type. The IP address is shown where it was recorded.',
    wrap: true,
    sheetName: 'Activity log',
    columns: ACTIVITY_COLUMNS,
    rows: activityExportRows(rows),
    widths: {
      xlsx: [18, 22, 14, 36, 40, 14, 30, 16],
      pdf: [70, 80, 52, 120, 140, 52, 100, 66],
    },
    fileBase: 'xtend-activity-log',
  }
}
