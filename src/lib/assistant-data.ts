import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail, Profile } from '@/lib/types'
import { FIELD_ROLES } from '@/lib/auth'
import { addDays, formatLagos, lagosDateString, longDate } from '@/lib/utils'
import { CLAIMS, judgeExcuse, lagosInstant, type Claim, type ExcuseEvidence } from '@/lib/excuse'
import { detailText, fetchIntegrity, parseIntegrityFilter, personRisk } from '@/lib/integrity-review'

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
  /** Barcode, back store, shop floor and expiry: the Xpel count sheet (040). */
  barcode: string | null
  back_store: number | null
  shop_floor: number | null
  expiry_date: string | null
  /** The total in the store: back store plus shop floor. */
  in_store: number
  sold: number
  /** How far from the store it was submitted, and its shelf photo. Null before migration 022. */
  distance_m: number | null
  photo_path: string | null
}

/**
 * Merchandisers' product counts: units in the store, and units sold since
 * their previous count. Counts are taken when asked for, and at month end.
 */
export async function storeCounts(
  supabase: SupabaseClient,
  fromDate: unknown,
  toDate: unknown,
  filter: { outletId?: string | null; userId?: string | null } = {},
): Promise<{ from: string; to: string; counts: StoreCountRow[] }> {
  const { from, to } = checkRange(fromDate, toDate, 0)
  const run = (columns: string) => {
    let query = supabase
      .from('store_count_detail')
      .select(columns)
      .gte('count_date', from)
      .lte('count_date', to)
      .order('count_date', { ascending: false })
      .order('outlet_name')
      .order('product_name')
      .limit(5000)
    if (filter.outletId) query = query.eq('outlet_id', filter.outletId)
    if (filter.userId) query = query.eq('user_id', filter.userId)
    return query
  }

  const base = 'count_date, staff_name, outlet_name, product_name, sku, in_store, sold'
  let result = await run(`${base}, distance_m, photo_path, barcode, back_store, shop_floor, expiry_date`)
  // Until migration 040 is run the view has no count sheet columns, and
  // until 022 none for location or photo.
  if (result.error?.code === '42703') result = await run(`${base}, distance_m, photo_path`)
  if (result.error?.code === '42703') result = await run(base)
  const { error } = result
  const data = result.data as unknown as Record<string, unknown>[] | null
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
      barcode: (c.barcode as string | null) ?? null,
      back_store: (c.back_store as number | null) ?? null,
      shop_floor: (c.shop_floor as number | null) ?? null,
      expiry_date: (c.expiry_date as string | null) ?? null,
      distance_m: (c.distance_m as number | null) ?? null,
      photo_path: (c.photo_path as string | null) ?? null,
    })),
  }
}

/** Stock count requests: who asked, by when, and who has not counted yet. */
export async function countRequests(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('count_request_progress')
    .select('id, requested_by_name, due_date, note, created_at, is_open, people, counted, waiting_on')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return {
    how_counts_work:
      'Stock counts are taken when a supervisor or admin asks for one, and by everyone in the last three days of each month.',
    requests: (data ?? []).map((r) => ({
      id: r.id as string,
      asked_by: r.requested_by_name,
      asked_on: formatLagos(r.created_at as string),
      due: r.due_date,
      note: r.note,
      open: r.is_open,
      people: r.people,
      counted: r.counted,
      waiting_on: r.waiting_on,
    })),
  }
}

/** Integrity flags: signs of a faked location and stock counts that do not add up. */
export async function integrityFlags(supabase: SupabaseClient, fromDate: unknown, toDate: unknown) {
  const { from, to } = checkRange(fromDate, toDate, 30)
  const { data, error } = await supabase
    .from('integrity_flag_detail')
    .select('id, staff_name, kind, severity, summary, detail, outlet_name, flag_date, reviewed_at, review_note')
    .gte('flag_date', from)
    .lte('flag_date', to)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  return {
    from,
    to,
    flags: (data ?? []).map((f) => ({
      id: f.id as string,
      name: f.staff_name,
      kind: f.kind,
      severity: f.severity,
      summary: f.summary,
      store: f.outlet_name,
      date: f.flag_date,
      detail: detailText(f.kind as string, f.detail as Record<string, unknown> | null),
      reviewed: Boolean(f.reviewed_at),
      review_note: f.review_note,
    })),
  }
}

/**
 * "She says her network was down this morning": everything Xtend heard
 * from one person's phone in a window, and the verdict it points to
 * (check_excuse(), migration 026; worded by lib/excuse.ts).
 */
export async function checkExcuse(
  supabase: SupabaseClient,
  name: unknown,
  date: unknown,
  fromTime: unknown,
  toTime: unknown,
  claim: unknown,
) {
  const needle = typeof name === 'string' ? name.trim().toLowerCase() : ''
  if (!needle) throw new Error('A name is required')
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : lagosDateString()
  const hm = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : fallback
  const from = hm(fromTime, '06:00')
  const to = hm(toTime, day === lagosDateString() ? formatLagos(new Date(), false) : '20:00')
  const said: Claim = claim === 'phone_off' ? 'phone_off' : 'no_network'

  const people = (await fetchRoster(supabase)).filter((p) => p.full_name.toLowerCase().includes(needle))
  if (people.length !== 1) {
    return {
      note:
        people.length === 0
          ? `No staff you can see match "${name}".`
          : `"${name}" matches ${people.map((p) => p.full_name).join(', ')}; ask which one.`,
    }
  }
  const person = people[0]
  const { data, error } = await supabase.rpc('check_excuse', {
    p_user: person.id,
    p_from: lagosInstant(day, from),
    p_to: lagosInstant(day, to),
  })
  if (error) throw new Error(error.message)
  const judged = judgeExcuse(data as ExcuseEvidence, said)
  return {
    name: person.full_name,
    date: day,
    from,
    to,
    claim: CLAIMS[said],
    verdict: judged.verdict,
    headline: judged.headline,
    evidence: judged.points,
    live_check: 'A supervisor can check whether the phone is on right now on the Check an excuse page.',
  }
}

const clipText = (v: unknown, max: number) => {
  const text = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Lagos midnight of a date, as an instant, for timestamp columns. */
const lagosStart = (d: string) => `${d}T00:00:00+01:00`

/** People ranked by their open integrity flags, with the reason in a sentence (lib/integrity-review.ts). */
export async function integrityRisk(supabase: SupabaseClient, fromDate: unknown, toDate: unknown) {
  const { from, to } = checkRange(fromDate, toDate, 30)
  const { rows } = await fetchIntegrity(supabase, { ...parseIntegrityFilter({}), from, to, status: 'all' }, 3000)
  const people = personRisk(rows)
  return {
    from,
    to,
    how_ranked:
      'Open (not reviewed) flags only. High counts 5, medium 2, low 1; older than a week counts half; proof from the phone (fake GPS confirmed, rooted phone, faked clock time) adds 5. "act" means look today.',
    open_flags: rows.filter((r) => !r.reviewed_at).length,
    people: people.slice(0, 15).map((p) => ({
      name: p.name,
      level: p.level,
      open_flags: p.open,
      high: p.high,
      medium: p.medium,
      low: p.low,
      last_flag_day: p.lastDate,
      reason: p.reason,
    })),
    more_people: Math.max(0, people.length - 15),
  }
}

const ALERT_WORDS: Record<string, string> = {
  left_geofence: 'left the store while on shift',
  low_accuracy: 'location too rough to trust',
  permission_denied: 'location permission turned off',
  off_site_clock: 'clocked in or out away from the store',
}

/** Location alerts: someone left their store, clocked in away from it, or switched location off. */
export async function locationAlerts(supabase: SupabaseClient, fromDate: unknown, toDate: unknown, onlyOpen: unknown) {
  const { from, to } = checkRange(fromDate, toDate)
  let query = supabase
    .from('alert_detail')
    .select('staff_name, outlet_name, alert_type, distance_m, is_resolved, note, created_at, resolved_by_name, location_label')
    .gte('created_at', lagosStart(from))
    .lt('created_at', lagosStart(addDays(to, 1)))
    .order('created_at', { ascending: false })
    .limit(300)
  if (onlyOpen === true) query = query.eq('is_resolved', false)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const byType = new Map<string, number>()
  for (const r of rows) byType.set(r.alert_type as string, (byType.get(r.alert_type as string) ?? 0) + 1)
  return {
    from,
    to,
    total: rows.length,
    open: rows.filter((r) => !r.is_resolved).length,
    by_type: Object.fromEntries([...byType].map(([k, n]) => [ALERT_WORDS[k] ?? k, n])),
    alerts: rows.slice(0, 120).map((r) => ({
      when: formatLagos(r.created_at as string),
      name: r.staff_name,
      store: r.outlet_name,
      what: ALERT_WORDS[r.alert_type as string] ?? r.alert_type,
      metres_away: r.distance_m != null ? Math.round(r.distance_m as number) : null,
      where: r.location_label,
      resolved: r.is_resolved
        ? `by ${r.resolved_by_name ?? 'someone'}${r.note ? `: ${clipText(r.note, 120)}` : ''}`
        : false,
    })),
    more: Math.max(0, rows.length - 120),
  }
}

/** Issues field staff raised in the app's help chat, newest activity first. */
export async function supportThreads(supabase: SupabaseClient, status: unknown) {
  let query = supabase
    .from('support_thread_detail')
    .select('subject, status, staff_name, outlet_name, created_at, last_message_at, message_count, last_body')
    .order('last_message_at', { ascending: false })
    .limit(60)
  if (status === 'open') query = query.in('status', ['open', 'escalated'])
  if (status === 'escalated') query = query.eq('status', 'escalated')
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data ?? []
  return {
    how_support_works:
      'Staff raise issues in the app. The Xtend helper answers simple ones; "escalated" means it was passed to the office and needs a person to reply on the Support page.',
    open: rows.filter((r) => r.status === 'open').length,
    escalated: rows.filter((r) => r.status === 'escalated').length,
    threads: rows.map((r) => ({
      subject: clipText(r.subject, 120),
      status: r.status,
      name: r.staff_name,
      store: r.outlet_name,
      started: formatLagos(r.created_at as string),
      last_message: formatLagos(r.last_message_at as string),
      messages: r.message_count,
      latest: clipText(r.last_body, 200),
    })),
  }
}

/** Push notifications the office sent: to whom, and how many phones got them. */
export async function notificationsSent(supabase: SupabaseClient, fromDate: unknown, toDate: unknown) {
  const { from, to } = checkRange(fromDate, toDate)
  const { data, error } = await supabase
    .from('notifications')
    .select('title, body, audience, recipients, delivered, failed, created_at, profiles(full_name)')
    .gte('created_at', lagosStart(from))
    .lt('created_at', lagosStart(addDays(to, 1)))
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return {
    from,
    to,
    note: 'delivered = phones the push service accepted it for; failed = phones it could not reach (notifications off or the app removed).',
    notifications: (data ?? []).map((n) => ({
      when: formatLagos(n.created_at as string),
      sent_by: embeddedName(n.profiles, 'full_name'),
      title: clipText(n.title, 80),
      message: clipText(n.body, 160),
      audience: n.audience,
      recipients: n.recipients,
      delivered: n.delivered,
      failed: n.failed,
    })),
  }
}

/** The first day of the month after a YYYY-MM month. */
export function nextMonthStart(month: string) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** X Metrics for a month: units sold per enrolled store against target, counts that did not add up, expiry alerts. */
export async function xMetricsMonth(supabase: SupabaseClient, monthValue: unknown) {
  const month =
    typeof monthValue === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue) ? monthValue : lagosDateString().slice(0, 7)
  const first = `${month}-01`
  const next = nextMonthStart(month)
  const [stores, sales, targets, gaps, expiry] = await Promise.all([
    supabase.from('xm_stores').select('outlet_id, outlets(name)').eq('is_active', true),
    supabase.from('xm_live_sale_lines').select('outlet_id, user_id, units').gte('sale_date', first).lt('sale_date', next).limit(50000),
    supabase.from('xm_current_targets').select('outlet_id, user_id, target_units').eq('month', first),
    supabase
      .from('xm_reconciliation_detail')
      .select('count_date, outlet_name, staff_name, product_name, expected_units, actual_units, variance_pct')
      .eq('flagged', true)
      .gte('count_date', first)
      .lt('count_date', next)
      .order('variance_pct', { ascending: false })
      .limit(200),
    supabase
      .from('xm_expiry_alert_detail')
      .select('outlet_name, product_name, expiry_date, units_on_hand, consider_pulling')
      .is('acknowledged_at', null)
      .order('expiry_date')
      .limit(30),
  ])
  const failed = [stores, sales, targets, gaps, expiry].find((r) => r.error)
  if (failed?.error) {
    if (failed.error.code === '42P01' || failed.error.code === 'PGRST205') {
      return { month, note: 'X Metrics is not set up yet (migration 043).' }
    }
    throw new Error(failed.error.message)
  }

  const names = new Map<string, string>()
  for (const s of stores.data ?? []) names.set(s.outlet_id as string, embeddedName(s.outlets, 'name') ?? 'Store')
  const soldByStore = new Map<string, number>()
  const soldByPerson = new Map<string, number>()
  for (const l of (sales.data ?? []) as { outlet_id: string; user_id: string | null; units: number }[]) {
    soldByStore.set(l.outlet_id, (soldByStore.get(l.outlet_id) ?? 0) + l.units)
    if (l.user_id) soldByPerson.set(l.user_id, (soldByPerson.get(l.user_id) ?? 0) + l.units)
  }
  const storeTarget = new Map<string, number>()
  const personTarget = new Map<string, number>()
  for (const t of (targets.data ?? []) as { outlet_id: string | null; user_id: string | null; target_units: number }[]) {
    if (t.outlet_id) storeTarget.set(t.outlet_id, t.target_units)
    if (t.user_id) personTarget.set(t.user_id, t.target_units)
  }
  const roster = personTarget.size ? await fetchRoster(supabase) : []
  const pct = (sold: number, target: number | undefined) => (target ? Math.round((sold / target) * 100) : null)
  const gapRows = gaps.data ?? []

  return {
    month,
    enrolled_stores: names.size,
    units_sold: [...soldByStore.values()].reduce((a, b) => a + b, 0),
    stores: [...names]
      .map(([id, name]) => ({
        store: name,
        units_sold: soldByStore.get(id) ?? 0,
        target: storeTarget.get(id) ?? null,
        percent_of_target: pct(soldByStore.get(id) ?? 0, storeTarget.get(id)),
      }))
      .sort((a, b) => b.units_sold - a.units_sold),
    people_with_targets: [...personTarget]
      .map(([id, target]) => ({ person: roster.find((p) => p.id === id), id, target }))
      .filter((p) => p.person)
      .map(({ person, id, target }) => ({
        name: person!.full_name,
        units_sold: soldByPerson.get(id) ?? 0,
        target,
        percent_of_target: pct(soldByPerson.get(id) ?? 0, target),
      })),
    counts_that_did_not_add_up: {
      total: gapRows.length,
      worst: gapRows.slice(0, 8).map((g) => ({
        date: g.count_date,
        store: g.outlet_name,
        name: g.staff_name,
        product: g.product_name,
        expected: g.expected_units,
        counted: g.actual_units,
        off_by_percent: g.variance_pct,
      })),
    },
    expiry_alerts_open: (expiry.data ?? []).map((e) => ({
      store: e.outlet_name,
      product: e.product_name,
      expires: e.expiry_date,
      units: e.units_on_hand,
      consider_pulling: e.consider_pulling,
    })),
  }
}

export interface CoveragePerson {
  name: string
  role: string
  stores_allocated: number
  allocated_visited: number
  coverage_percent: number | null
  visits: number
  not_visited: string[]
  not_visited_more: number
  visited_outside_allocation: string[]
}

/**
 * Store coverage, pure: for each person, the stores allocated to them and
 * which of those they visited. Sorted worst coverage first.
 */
export function coverage(
  roster: Pick<Roster, 'id' | 'full_name' | 'role'>[],
  allocated: { user_id: string; outlet_id: string; name: string }[],
  visits: { user_id: string; outlet_id: string | null; name: string | null }[],
) {
  const mine = new Map<string, Map<string, string>>()
  for (const a of allocated) {
    const m = mine.get(a.user_id) ?? new Map<string, string>()
    m.set(a.outlet_id, a.name)
    mine.set(a.user_id, m)
  }
  const seen = new Map<string, Map<string, { visits: number; name: string }>>()
  const anyone = new Set<string>()
  for (const v of visits) {
    if (!v.outlet_id) continue
    anyone.add(v.outlet_id)
    const m = seen.get(v.user_id) ?? new Map<string, { visits: number; name: string }>()
    const s = m.get(v.outlet_id) ?? { visits: 0, name: v.name ?? 'Store' }
    s.visits++
    m.set(v.outlet_id, s)
    seen.set(v.user_id, m)
  }

  const people: CoveragePerson[] = roster
    .filter((p) => mine.has(p.id) || seen.has(p.id))
    .map((p) => {
      const stores = mine.get(p.id) ?? new Map<string, string>()
      const went = seen.get(p.id) ?? new Map<string, { visits: number; name: string }>()
      const missed = [...stores].filter(([id]) => !went.has(id)).map(([, n]) => n)
      return {
        name: p.full_name,
        role: p.role,
        stores_allocated: stores.size,
        allocated_visited: stores.size - missed.length,
        coverage_percent: stores.size ? Math.round(((stores.size - missed.length) / stores.size) * 100) : null,
        visits: [...went.values()].reduce((a, s) => a + s.visits, 0),
        not_visited: missed.slice(0, 12),
        not_visited_more: Math.max(0, missed.length - 12),
        visited_outside_allocation: [...went].filter(([id]) => !stores.has(id)).map(([, s]) => s.name).slice(0, 6),
      }
    })
    .sort((a, b) => (a.coverage_percent ?? 101) - (b.coverage_percent ?? 101) || a.name.localeCompare(b.name))

  const allAllocated = new Map<string, string>()
  for (const m of mine.values()) for (const [id, n] of m) allAllocated.set(id, n)
  const nobody = [...allAllocated].filter(([id]) => !anyone.has(id)).map(([, n]) => n).sort()
  return { allocated_stores: allAllocated.size, stores_nobody_visited: nobody, people }
}

/** Store coverage over a range, through the caller's RLS. */
export async function visitCoverage(supabase: SupabaseClient, fromDate: unknown, toDate: unknown) {
  const { from, to } = checkRange(fromDate, toDate)
  const [roster, allocated, visits] = await Promise.all([
    fetchRoster(supabase),
    supabase.from('staff_outlets').select('user_id, outlet_id, outlets(name)').limit(10000),
    supabase
      .from('store_visit_detail')
      .select('user_id, outlet_id, outlet_name')
      .gte('visit_date', from)
      .lte('visit_date', to)
      .limit(10000),
  ])
  if (allocated.error) throw new Error(allocated.error.message)
  if (visits.error) throw new Error(visits.error.message)
  const got = coverage(
    roster,
    (allocated.data ?? []).map((a) => ({
      user_id: a.user_id as string,
      outlet_id: a.outlet_id as string,
      name: embeddedName(a.outlets, 'name') ?? 'Store',
    })),
    (visits.data ?? []).map((v) => ({
      user_id: v.user_id as string,
      outlet_id: (v.outlet_id as string | null) ?? null,
      name: (v.outlet_name as string | null) ?? null,
    })),
  )
  return {
    from,
    to,
    allocated_stores: got.allocated_stores,
    stores_nobody_visited: got.stores_nobody_visited.slice(0, 30),
    stores_nobody_visited_total: got.stores_nobody_visited.length,
    people: got.people.slice(0, 60),
  }
}
