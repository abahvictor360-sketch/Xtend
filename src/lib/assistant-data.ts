import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail, Profile } from '@/lib/types'
import { FIELD_ROLES } from '@/lib/auth'
import { addDays, formatLagos, lagosDateString, longDate } from '@/lib/utils'

/**
 * The lookups behind Ask Xtend: what the assistant reads to answer a
 * question, and what a downloaded report is built from. Everything goes
 * through the caller's own Supabase client, so RLS decides what is visible.
 */

export const MAX_RANGE_DAYS = 62

export type Roster = Pick<Profile, 'id' | 'full_name' | 'role'> & { outlet_name: string | null }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function checkDate(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new Error(`"${String(value)}" is not a YYYY-MM-DD date`)
  }
  return value
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

/** Resolves an optional range, defaulting to the last `days` days, and bounds it. */
export function checkRange(from: unknown, to: unknown, days = 7) {
  const end = checkDate(to, lagosDateString())
  const start = checkDate(from, addDays(end, -days))
  if (end < start) throw new Error('"to" is before "from"')
  if (daysBetween(start, end) > MAX_RANGE_DAYS) {
    throw new Error(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
  }
  return { from: start, to: end }
}

function* eachDay(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d
}

/** Supabase returns an embedded to-one row as an object or a one-item array. */
function embeddedName(value: unknown, key: string): string | null {
  const row = Array.isArray(value) ? value[0] : value
  const name = row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : null
  return typeof name === 'string' ? name : null
}

export async function fetchRoster(supabase: SupabaseClient): Promise<Roster[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, outlets(name)')
    .eq('is_active', true)
    .in('role', FIELD_ROLES)
    .order('full_name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    outlet_name: embeddedName(row.outlets, 'name'),
  }))
}

async function fetchRecords(
  supabase: SupabaseClient,
  from: string,
  to: string,
  userIds?: string[],
): Promise<AttendanceDetail[]> {
  let query = supabase
    .from('attendance_detail')
    .select('*')
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (userIds) query = query.in('user_id', userIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceDetail[]
}

export interface Clock {
  time: string
  status: string | null
  late?: boolean
  location: string
  store: string | null
}

function describeClock(record: AttendanceDetail | undefined): Clock | null {
  if (!record) return null
  return {
    time: formatLagos(record.created_at, false),
    status: record.status,
    late: record.type === 'opening' ? record.is_late : undefined,
    location: record.location_label,
    store: record.outlet_name,
  }
}

/** The first opening and last closing per person per day. */
function firstAndLast(records: AttendanceDetail[]) {
  const byKey = new Map<string, { opening?: AttendanceDetail; closing?: AttendanceDetail }>()
  for (const r of records) {
    const key = `${r.user_id}|${r.attendance_date}`
    const entry = byKey.get(key) ?? {}
    if (r.type === 'opening' && !entry.opening) entry.opening = r
    if (r.type === 'closing') entry.closing = r
    byKey.set(key, entry)
  }
  return byKey
}

export interface DayPerson {
  name: string
  role: string
  store: string | null
  clock_in: Clock | null
  clock_out: Clock | null
}

export async function attendanceOnDay(supabase: SupabaseClient, day: unknown) {
  const today = lagosDateString()
  const date = checkDate(day, today)
  const [roster, records] = await Promise.all([
    fetchRoster(supabase),
    fetchRecords(supabase, date, date),
  ])
  const days = firstAndLast(records)

  const clockedInAndOut: DayPerson[] = []
  const stillOnShift: DayPerson[] = []
  const notClockedIn: DayPerson[] = []

  for (const person of roster) {
    const day = days.get(`${person.id}|${date}`)
    const entry: DayPerson = {
      name: person.full_name,
      role: person.role,
      store: person.outlet_name,
      clock_in: describeClock(day?.opening),
      // A clock-out with no clock-in is still worth showing.
      clock_out: describeClock(day?.closing),
    }
    if (!day?.opening) notClockedIn.push(entry)
    else if (!day.closing) stillOnShift.push(entry)
    else clockedInAndOut.push(entry)
  }

  return {
    date,
    day: longDate(date),
    is_today: date === today,
    staff_total: roster.length,
    counts: {
      clocked_in: clockedInAndOut.length + stillOnShift.length,
      clocked_out: clockedInAndOut.length,
      still_on_shift_not_clocked_out: stillOnShift.length,
      not_clocked_in: notClockedIn.length,
    },
    clocked_in_and_out: clockedInAndOut,
    still_on_shift_not_clocked_out: stillOnShift,
    not_clocked_in: notClockedIn,
  }
}

export async function staffHistory(
  supabase: SupabaseClient,
  name: unknown,
  fromDate: unknown,
  toDate: unknown,
) {
  const needle = typeof name === 'string' ? name.trim().toLowerCase() : ''
  if (!needle) throw new Error('A name is required')
  const { from, to } = checkRange(fromDate, toDate)

  const roster = await fetchRoster(supabase)
  const people = roster.filter((p) => p.full_name.toLowerCase().includes(needle))
  if (people.length === 0) {
    return { from, to, matches: [], note: `No staff you can see match "${name}".` }
  }
  if (people.length > 10) {
    return {
      from,
      to,
      note: `"${name}" matches ${people.length} people; ask the user which one.`,
      matches: people.map((p) => ({ name: p.full_name, store: p.outlet_name, history: [] })),
    }
  }

  const records = await fetchRecords(
    supabase,
    from,
    to,
    people.map((p) => p.id),
  )
  const days = firstAndLast(records)

  return {
    from,
    to,
    matches: people.map((person) => ({
      name: person.full_name,
      role: person.role,
      store: person.outlet_name,
      history: [...eachDay(from, to)].map((d) => {
        const day = days.get(`${person.id}|${d}`)
        return {
          date: d,
          clock_in: describeClock(day?.opening),
          clock_out: describeClock(day?.closing),
        }
      }),
    })),
  }
}

export async function attendanceSummary(supabase: SupabaseClient, fromDate: unknown, toDate: unknown) {
  const { from, to } = checkRange(fromDate, toDate)
  const [roster, records] = await Promise.all([
    fetchRoster(supabase),
    fetchRecords(supabase, from, to),
  ])
  const days = firstAndLast(records)

  return {
    from,
    to,
    calendar_days: daysBetween(from, to) + 1,
    people: roster.map((person) => {
      let clockedIn = 0
      let clockedOut = 0
      let neverOut = 0
      let late = 0
      let offSite = 0
      for (const d of eachDay(from, to)) {
        const day = days.get(`${person.id}|${d}`)
        if (day?.opening) {
          clockedIn++
          if (!day.closing) neverOut++
          if (day.opening.is_late) late++
          if (day.opening.status && day.opening.status !== 'on_site') offSite++
        }
        if (day?.closing) clockedOut++
      }
      return {
        name: person.full_name,
        role: person.role,
        store: person.outlet_name,
        days_clocked_in: clockedIn,
        days_clocked_out: clockedOut,
        days_clocked_in_but_not_out: neverOut,
        late_days: late,
        off_site_clock_ins: offSite,
      }
    }),
  }
}

export interface FieldReport {
  date: string
  name: string | null
  store: string | null
  sales: string
  stock: string
  competitors: string
  issues: string
  notes: string
}

/** The daily reports marketers file from the field app. */
export async function fieldReports(
  supabase: SupabaseClient,
  fromDate: unknown,
  toDate: unknown,
  maxChars = 600,
): Promise<{ from: string; to: string; reports: FieldReport[] }> {
  const { from, to } = checkRange(fromDate, toDate)
  const { data, error } = await supabase
    .from('reports')
    .select(
      'report_date, body, sales_summary, stock_status, competitor_activity, issues, profiles(full_name), outlets(name)',
    )
    .gte('report_date', from)
    .lte('report_date', to)
    .order('report_date', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)

  const clip = (v: unknown) => {
    const text = typeof v === 'string' ? v.trim() : ''
    return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
  }

  return {
    from,
    to,
    reports: (data ?? []).map((r) => ({
      date: r.report_date as string,
      name: embeddedName(r.profiles, 'full_name'),
      store: embeddedName(r.outlets, 'name'),
      sales: clip(r.sales_summary),
      stock: clip(r.stock_status),
      competitors: clip(r.competitor_activity),
      issues: clip(r.issues),
      notes: clip(r.body),
    })),
  }
}

export interface StoreVisit {
  date: string
  name: string
  store: string
  arrived: string
  left: string
  minutes: number | null
  arrived_status: string | null
  visit_status: string
}

/** Store visits: a marketer's round of shops, each with an arrival and departure. */
export async function storeVisits(
  supabase: SupabaseClient,
  fromDate: unknown,
  toDate: unknown,
): Promise<{ from: string; to: string; visits: StoreVisit[] }> {
  const { from, to } = checkRange(fromDate, toDate)
  const { data, error } = await supabase
    .from('store_visit_detail')
    .select('visit_date, staff_name, store_label, arrived_at, departed_at, minutes, arrived_status, status')
    .gte('visit_date', from)
    .lte('visit_date', to)
    .order('arrived_at', { ascending: true })
    .limit(3000)
  if (error) throw new Error(error.message)

  return {
    from,
    to,
    visits: (data ?? []).map((v) => ({
      date: v.visit_date as string,
      name: v.staff_name as string,
      store: v.store_label as string,
      arrived: formatLagos(v.arrived_at as string, false),
      left: v.departed_at ? formatLagos(v.departed_at as string, false) : 'still there',
      minutes: (v.minutes as number | null) ?? null,
      arrived_status: (v.arrived_status as string | null) ?? null,
      visit_status: v.status as string,
    })),
  }
}

export interface StoreCountRow {
  date: string
  name: string
  store: string
  product: string
  sku: string | null
  in_store: number
  sold: number
}

/** Merchandisers' product counts: units in the store and units sold, per day. */
export async function storeCounts(
  supabase: SupabaseClient,
  fromDate: unknown,
  toDate: unknown,
  filter: { outletId?: string | null; userId?: string | null } = {},
): Promise<{ from: string; to: string; counts: StoreCountRow[] }> {
  const { from, to } = checkRange(fromDate, toDate, 0)
  let query = supabase
    .from('store_count_detail')
    .select('count_date, staff_name, outlet_name, product_name, sku, in_store, sold')
    .gte('count_date', from)
    .lte('count_date', to)
    .order('count_date', { ascending: false })
    .order('outlet_name')
    .order('product_name')
    .limit(5000)
  if (filter.outletId) query = query.eq('outlet_id', filter.outletId)
  if (filter.userId) query = query.eq('user_id', filter.userId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return {
    from,
    to,
    counts: (data ?? []).map((c) => ({
      date: c.count_date as string,
      name: c.staff_name as string,
      store: c.outlet_name as string,
      product: c.product_name as string,
      sku: (c.sku as string | null) ?? null,
      in_store: c.in_store as number,
      sold: c.sold as number,
    })),
  }
}
