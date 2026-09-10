import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail } from '@/lib/types'
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

export const EXPORT_COLUMNS = [
  'Staff name',
  'Date',
  'Type',
  'Time (Africa/Lagos)',
  'Outlet',
  'Location (premises and street)',
  'Distance from outlet',
  'Accuracy',
  'Status',
  'Selfie link',
] as const

export interface ExportRow {
  values: string[]
  selfieUrl: string | null
}

/**
 * Signed selfie links expire in an hour: long enough to open the export and
 * check a face, short enough that a leaked spreadsheet is not a photo dump.
 */
export async function toExportRows(
  supabase: SupabaseClient,
  rows: AttendanceDetail[],
): Promise<ExportRow[]> {
  const paths = rows.map((r) => r.selfie_path).filter(Boolean)
  const signed = new Map<string, string>()

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { data } = await supabase.storage.from('selfies').createSignedUrls(batch, 3600)
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl)
    }
  }

  return rows.map((r) => {
    const url = signed.get(r.selfie_path) ?? null
    return {
      selfieUrl: url,
      values: [
        r.staff_name,
        r.attendance_date,
        r.type,
        formatLagos(r.created_at, false),
        r.outlet_name ?? '—',
        r.location_label,
        metres(r.distance_m),
        `${Math.round(r.accuracy_m)} m`,
        r.status ?? '—',
        url ?? 'expired',
      ],
    }
  })
}

export function exportFileName(ext: string) {
  const stamp = new Date().toISOString().slice(0, 10)
  return `xtend-attendance-${stamp}.${ext}`
}
