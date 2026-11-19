import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail } from '@/lib/types'
import type { ExportRow, Sheet } from '@/lib/export/render'
import { formatLagos, metres } from '@/lib/utils'

export interface AttendanceFilter {
  from?: string | null
  to?: string | null
  user_id?: string | null
  outlet_id?: string | null
  status?: string | null
  type?: string | null
  limit?: number
}

export function parseFilter(url: URL): AttendanceFilter {
  const get = (k: string) => {
    const v = url.searchParams.get(k)
    return v && v !== 'all' ? v : null
  }
  return {
    from: get('from'),
    to: get('to'),
    user_id: get('user_id'),
    outlet_id: get('outlet_id'),
    status: get('status'),
    type: get('type'),
    limit: Number(url.searchParams.get('limit')) || 2000,
  }
}

/** RLS decides the rows. The filter only narrows what the caller may see. */
export async function fetchAttendance(
  supabase: SupabaseClient,
  filter: AttendanceFilter,
): Promise<AttendanceDetail[]> {
  let query = supabase
    .from('attendance_detail')
    .select('*')
    .order('attendance_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.min(filter.limit ?? 2000, 5000))

  if (filter.from) query = query.gte('attendance_date', filter.from)
  if (filter.to) query = query.lte('attendance_date', filter.to)
  if (filter.user_id) query = query.eq('user_id', filter.user_id)
  if (filter.outlet_id) query = query.eq('outlet_id', filter.outlet_id)
  if (filter.status) query = query.eq('status', filter.status)
  if (filter.type) query = query.eq('type', filter.type)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceDetail[]
}

/** One row per person per day: the clock-in and the clock-out side by side. */
export const EXPORT_COLUMNS = [
  'Staff name',
  'Date',
  'Store',
  'Clock in',
  'In: where',
  'In: from store',
  'In: status',
  'In: photo',
  'Clock out',
  'Out: where',
  'Out: from store',
  'Out: status',
  'Out: photo',
] as const

const STATUS_WORDS: Record<string, string> = { on_site: 'At the store', off_site: 'Away from the store', flagged: 'Location too rough' }

/**
 * Signed selfie links expire in an hour: long enough to open the export and
 * check a face, short enough that a leaked spreadsheet is not a photo dump.
 */
export async function signSelfies(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = paths.filter((p): p is string => Boolean(p))
  const signed = new Map<string, string>()

  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100)
    const { data } = await supabase.storage.from('selfies').createSignedUrls(batch, 3600)
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl)
    }
  }
  return signed
}

/**
 * A person's day as one row (2026-11-19: before, the clock-in and the
 * clock-out were two rows, so everyone appeared twice). The first clock-in
 * and the last clock-out after it, as on the Attendance page; newest day
 * first, then the latest clock-in.
 */
export async function toExportRows(
  supabase: SupabaseClient,
  rows: AttendanceDetail[],
): Promise<ExportRow[]> {
  const days = new Map<string, { ins: AttendanceDetail[]; outs: AttendanceDetail[] }>()
  for (const r of rows) {
    const key = `${r.user_id}|${r.attendance_date}`
    const day = days.get(key) ?? { ins: [], outs: [] }
    ;(r.type === 'opening' ? day.ins : day.outs).push(r)
    days.set(key, day)
  }
  const pairs = [...days.values()].map(({ ins, outs }) => {
    const clockIn = ins.reduce<AttendanceDetail | null>((a, e) => (!a || e.created_at < a.created_at ? e : a), null)
    const after = outs.filter((o) => !clockIn || o.created_at >= clockIn.created_at)
    const clockOut = after.reduce<AttendanceDetail | null>((a, e) => (!a || e.created_at > a.created_at ? e : a), null)
    return { clockIn, clockOut: clockOut ?? (clockIn ? null : (outs[0] ?? null)) }
  })
  pairs.sort((a, b) => {
    const [x, y] = [a.clockIn ?? a.clockOut!, b.clockIn ?? b.clockOut!]
    return y.attendance_date.localeCompare(x.attendance_date) || (b.clockIn?.created_at ?? '').localeCompare(a.clockIn?.created_at ?? '')
  })

  const signed = await signSelfies(supabase, pairs.flatMap((p) => [p.clockIn?.selfie_path, p.clockOut?.selfie_path]))
  const photo = (e: AttendanceDetail | null) => (e?.selfie_path ? (signed.get(e.selfie_path) ?? null) : null)
  const side = (e: AttendanceDetail | null) =>
    e
      ? [formatLagos(e.created_at, false), e.location_label ?? '', metres(e.distance_m), e.status ? (STATUS_WORDS[e.status] ?? e.status) : '—']
      : ['—', '', '', '']
  return pairs.map(({ clockIn, clockOut }) => {
    const any = (clockIn ?? clockOut)!
    const inPhoto = photo(clockIn)
    const outPhoto = photo(clockOut)
    const photoText = (e: AttendanceDetail | null, url: string | null) => (url ? 'link' : e ? 'deleted after 14 days' : '')
    return {
      link: inPhoto,
      links: [outPhoto],
      values: [
        any.staff_name,
        any.attendance_date,
        clockIn?.outlet_name ?? clockOut?.outlet_name ?? '—',
        ...side(clockIn),
        photoText(clockIn, inPhoto),
        ...side(clockOut),
        photoText(clockOut, outPhoto),
      ],
    }
  })
}

export function attendanceSheet(rows: ExportRow[]): Sheet {
  return {
    title: 'Xpel Beauty · Clock-ins and clock-outs',
    subtitle:
      `${rows.length} ${rows.length === 1 ? 'day' : 'days'}, one row per person per day. Times are Africa/Lagos. Clock photos are deleted 14 days ` +
      'after capture; links to the ones still held expire an hour after this file was made.',
    notes: 'One row per person per day: the clock-in and the clock-out side by side, with where each was taken, how far from the store, and the photo.',
    logo: true,
    sheetName: 'Clock-ins and outs',
    columns: EXPORT_COLUMNS,
    rows,
    widths: {
      xlsx: [24, 12, 22, 10, 36, 12, 18, 12, 10, 36, 12, 18, 12],
      pdf: [80, 46, 70, 34, 120, 40, 58, 34, 34, 120, 40, 58, 34],
    },
    linkColumn: 7,
    linkColumns: [12],
    linkText: 'Open photo',
    noLinkText: '—',
    fileBase: 'xtend-clock-ins-and-outs',
  }
}
