import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail, UserRole } from '@/lib/types'
import { BASE_LABEL, roleLabel, roleValue, type StaffRole } from '@/lib/staff-roles'
import {
  buildDays,
  cleanRange,
  dayList,
  isGroupBy,
  isSortKey,
  isStatusFilter,
  matchesStatus,
  previousPeriod,
  type ClockEvent,
  type DayRecord,
  type GroupBy,
  type Person,
  type SortKey,
  type StatusFilter,
} from '@/lib/attendance-report'
import { addDays, lagosDateString } from '@/lib/utils'

/** The longest range the Attendance and Analytics pages read at once. */
export const MAX_RANGE_DAYS = 92
/** Past this many days the calendar grid is left out: too narrow to read. */
export const GRID_MAX_DAYS = 62
/** Clock events read in one go, in pages of 1000 (PostgREST's usual cap). */
const MAX_EVENTS = 40_000
const PAGE = 1000

export interface ReportFilter {
  from: string
  to: string
  /** The range was cut to MAX_RANGE_DAYS. */
  clipped: boolean
  user_id: string | null
  outlet_id: string | null
  /** A supervisor's id, or 'none' for people who report to nobody. */
  team: string | null
  /** 'merchandiser', 'marketer' or 'custom:<id>'. */
  role: string | null
  status: StatusFilter | null
  /** Count a Sunday without a clock-in as an absence. */
  sundays: boolean
  sort: SortKey
  dir: 'asc' | 'desc'
  by: GroupBy
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>

function reader(params: Params) {
  return (key: string) => {
    const raw = params instanceof URLSearchParams ? params.get(key) : params[key]
    const v = Array.isArray(raw) ? raw[0] : raw
    return v && v !== 'all' ? v : null
  }
}

/**
 * Filters from the address bar (or an export link), cleaned. The same
 * names the old page used (from, to, user_id, outlet_id, status) still
 * work, so links from Ask Xtend keep landing in the right place.
 */
export function parseReportFilter(params: Params, fallbackDays: number): ReportFilter {
  const get = reader(params)
  const today = lagosDateString()
  const range = cleanRange(get('from'), get('to'), today, { from: addDays(today, -(fallbackDays - 1)), to: today }, MAX_RANGE_DAYS)
  const status = get('status')
  const sort = get('sort')
  const by = get('by')
  return {
    ...range,
    user_id: get('user_id') ?? get('person'),
    outlet_id: get('outlet_id'),
    team: get('team'),
    role: get('role'),
    status: isStatusFilter(status) ? status : null,
    sundays: get('sundays') === '1',
    sort: isSortKey(sort) ? sort : 'date',
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
    by: isGroupBy(by) ? by : 'person',
  }
}

/** The filter back as a query string, leaving out what is at its default. */
export function reportQuery(f: Partial<ReportFilter>, extra: Record<string, string | null> = {}) {
  const q = new URLSearchParams()
  if (f.from) q.set('from', f.from)
  if (f.to) q.set('to', f.to)
  if (f.user_id) q.set('user_id', f.user_id)
  if (f.outlet_id) q.set('outlet_id', f.outlet_id)
  if (f.team) q.set('team', f.team)
  if (f.role) q.set('role', f.role)
  if (f.status) q.set('status', f.status)
  if (f.sundays) q.set('sundays', '1')
  if (f.sort && f.sort !== 'date') q.set('sort', f.sort)
  if (f.dir === 'asc') q.set('dir', 'asc')
  if (f.by && f.by !== 'person') q.set('by', f.by)
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) q.delete(k)
    else q.set(k, v)
  }
  return q.toString()
}

export interface Choices {
  people: Person[]
  stores: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  roles: { value: string; label: string }[]
}

interface ProfileRow {
  id: string
  full_name: string
  phone: string | null
  role: UserRole
  staff_role_id: string | null
  outlet_id: string | null
  supervisor_id: string | null
  is_active: boolean
  created_at: string
}

/**
 * Field staff the caller may see (RLS: everyone for an admin, their own
 * team for a supervisor) with their store, team and role names, and the
 * choices for the filters.
 */
export async function loadChoices(supabase: SupabaseClient): Promise<Choices> {
  const [{ data: rows, error }, { data: outlets }, { data: roleRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, role, staff_role_id, outlet_id, supervisor_id, is_active, created_at')
      .in('role', ['merchandiser', 'marketer'])
      .order('full_name'),
    supabase.from('outlets').select('id, name').order('name'),
    supabase.from('staff_roles').select('id, name, base_role, is_active'),
  ])
  if (error) throw new Error(error.message)
  const profiles = (rows ?? []) as ProfileRow[]
  const outletName = new Map(((outlets ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
  const roles = (roleRows ?? []) as StaffRole[]

  // Supervisors' names. An admin reads them all; a supervisor reads only
  // their own profile, so anyone else's team shows as "Another team".
  const leadIds = [...new Set(profiles.map((p) => p.supervisor_id).filter((v): v is string => Boolean(v)))]
  const { data: leads } = leadIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', leadIds)
    : { data: [] }
  const leadName = new Map(((leads ?? []) as { id: string; full_name: string }[]).map((l) => [l.id, l.full_name]))

  const people: Person[] = profiles.map((p) => ({
    id: p.id,
    name: p.full_name,
    phone: p.phone,
    role: p.role,
    roleLabel: roleLabel(p, roles),
    roleValue: roleValue(p),
    outletId: p.outlet_id,
    outletName: p.outlet_id ? (outletName.get(p.outlet_id) ?? null) : null,
    teamId: p.supervisor_id,
    teamName: p.supervisor_id ? (leadName.get(p.supervisor_id) ?? 'Another team') : null,
    active: p.is_active,
    since: lagosDateString(new Date(p.created_at)),
  }))

  const teams = [...new Map(people.filter((p) => p.teamId).map((p) => [p.teamId!, p.teamName!])).entries()]
    .map(([id, name]) => ({ id, name: `${name}’s team` }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const usedRoles = new Map<string, string>()
  for (const p of people) {
    usedRoles.set(p.role, BASE_LABEL[p.role as UserRole])
    if (p.roleValue !== p.role) usedRoles.set(p.roleValue, p.roleLabel)
  }

  return {
    people,
    // Every store the caller can see, so a store with nobody in yet is still a choice.
    stores: [...outletName.entries()].map(([id, name]) => ({ id, name })),
    teams,
    roles: [...usedRoles.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

/** People the filter keeps, before looking at any clock event. */
export function peopleInScope(people: Person[], f: Pick<ReportFilter, 'user_id' | 'team' | 'role'>) {
  return people.filter(
    (p) =>
      (!f.user_id || p.id === f.user_id) &&
      (!f.team || (f.team === 'none' ? !p.teamId : p.teamId === f.team)) &&
      (!f.role || (f.role.startsWith('custom:') ? p.roleValue === f.role : p.role === f.role)),
  )
}

/** The light columns analytics needs; the Attendance page reads them all. */
const LIGHT =
  'id, user_id, attendance_date, type, created_at, local_time, outlet_id, outlet_name, shift_start, status, distance_m, is_late, client_captured_at'

/**
 * Clock events from attendance_detail between two days, a page at a time.
 * The view is security_invoker, so RLS keeps a supervisor to their team.
 */
export async function fetchEvents<E extends ClockEvent = ClockEvent>(
  supabase: SupabaseClient,
  from: string,
  to: string,
  opts: { full?: boolean; userId?: string | null } = {},
): Promise<{ events: E[]; truncated: boolean }> {
  const page = (start: number, count: boolean) => {
    let q = supabase
      .from('attendance_detail')
      .select(opts.full ? '*' : LIGHT, count ? { count: 'exact' } : undefined)
      .gte('attendance_date', from)
      .lte('attendance_date', to)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + PAGE - 1)
    if (opts.userId) q = q.eq('user_id', opts.userId)
    return q
  }
  const first = await page(0, true)
  if (first.error) throw new Error(first.error.message)
  const events = (first.data ?? []) as unknown as E[]
  const total = Math.min(first.count ?? events.length, MAX_EVENTS)
  const rest: number[] = []
  for (let start = PAGE; start < total; start += PAGE) rest.push(start)
  const more = await Promise.all(rest.map((s) => page(s, false)))
  for (const r of more) {
    if (r.error) throw new Error(r.error.message)
    events.push(...((r.data ?? []) as unknown as E[]))
  }
  return { events, truncated: (first.count ?? 0) > MAX_EVENTS }
}

export interface Report<E extends ClockEvent> {
  filter: ReportFilter
  today: string
  days: string[]
  people: Person[]
  /** Every day of every person in scope, store filter applied, status not. */
  records: DayRecord<E>[]
  events: E[]
  truncated: boolean
}

/**
 * People in scope and their days, for one range. The store filter keeps
 * days at that store: the clock-in's store, or their own on a day they
 * did not come.
 */
export function assemble<E extends ClockEvent>(
  allPeople: Person[],
  events: E[],
  filter: ReportFilter,
  from: string,
  to: string,
  today: string,
) {
  let people = peopleInScope(allPeople, filter)
  if (filter.outlet_id) {
    const there = new Set(events.filter((e) => e.outlet_id === filter.outlet_id).map((e) => e.user_id))
    people = people.filter((p) => p.outletId === filter.outlet_id || there.has(p.id))
  }
  const ids = new Set(people.map((p) => p.id))
  const mine = events.filter((e) => ids.has(e.user_id))
  const days = dayList(from, to)
  let records = buildDays(people, mine, days, { today, sundays: filter.sundays })
  if (filter.outlet_id) records = records.filter((r) => r.outletId === filter.outlet_id)
  return { people, days, records, events: mine }
}

/** Everything the Attendance page and its download show, through RLS. */
export async function loadAttendance(supabase: SupabaseClient, filter: ReportFilter) {
  const today = lagosDateString()
  const [choices, got] = await Promise.all([
    loadChoices(supabase),
    fetchEvents<AttendanceDetail>(supabase, filter.from, filter.to, { full: true, userId: filter.user_id }),
  ])
  const built = assemble(choices.people, got.events, filter, filter.from, filter.to, today)
  const report: Report<AttendanceDetail> = { filter, today, ...built, truncated: got.truncated }
  return { choices, report, shown: report.records.filter((r) => matchesStatus(r, filter.status)) }
}

/**
 * Analytics: the range and the same number of days straight before it, in
 * one read, so every figure can say how it moved.
 */
export async function loadAnalytics(supabase: SupabaseClient, filter: ReportFilter) {
  const today = lagosDateString()
  const previous = previousPeriod(filter.from, filter.to)
  const [choices, got] = await Promise.all([loadChoices(supabase), fetchEvents(supabase, previous.from, filter.to)])
  const now = assemble(choices.people, got.events, filter, filter.from, filter.to, today)
  const before = assemble(choices.people, got.events, filter, previous.from, previous.to, today)
  return { choices, today, previous, now, before, truncated: got.truncated }
}
