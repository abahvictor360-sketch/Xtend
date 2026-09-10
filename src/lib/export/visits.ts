import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportRow, Sheet } from '@/lib/export/render'
import { signSelfies } from '@/lib/export/data'
import { formatLagos, metres } from '@/lib/utils'

export interface VisitFilter {
  from?: string | null
  to?: string | null
  user_id?: string | null
  outlet_id?: string | null
  status?: string | null
  limit?: number
}

export interface VisitExportRow {
  id: string
  staff_name: string
  outlet_name: string
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
  arrived_label: string | null
  /** The outlet's name inside its fence; the map's premises name outside. */
  store_label: string | null
  store_label_source: 'outlet' | 'map' | null
  selfie_path: string | null
}

export function parseVisitFilter(url: URL): VisitFilter {
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
    limit: Number(url.searchParams.get('limit')) || 2000,
  }
}

/**
 * RLS decides the rows: a supervisor's export covers their team and nobody
 * else's, without the route having to say so.
 */
export async function fetchVisits(
  supabase: SupabaseClient,
  filter: VisitFilter,
): Promise<VisitExportRow[]> {
  let query = supabase
    .from('store_visit_detail')
    .select('*')
    .order('visit_date', { ascending: false })
    .order('staff_name')
    .order('arrived_at')
    .limit(Math.min(filter.limit ?? 2000, 5000))

  if (filter.from) query = query.gte('visit_date', filter.from)
  if (filter.to) query = query.lte('visit_date', filter.to)
  if (filter.user_id) query = query.eq('user_id', filter.user_id)
  if (filter.outlet_id) query = query.eq('outlet_id', filter.outlet_id)
  if (filter.status) query = query.eq('arrived_status', filter.status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as VisitExportRow[]
}

export const VISIT_COLUMNS = [
  'Marketer',
  'Date',
  'Store',
  'Store named by',
  'Nearest of their stores',
  'Checked in',
  'Checked out',
  'Minutes in store',
  'Arrived',
  'Distance on arrival',
  'Left',
  'Distance on departure',
  'Where they checked in',
  'Selfie link',
] as const

export async function toVisitRows(
  supabase: SupabaseClient,
  visits: VisitExportRow[],
): Promise<ExportRow[]> {
  const signed = await signSelfies(
    supabase,
    visits.map((v) => v.selfie_path),
  )

  return visits.map((v) => {
    const url = v.selfie_path ? (signed.get(v.selfie_path) ?? null) : null
    return {
      link: url,
      values: [
        v.staff_name,
        v.visit_date,
        v.store_label ?? v.outlet_name,
        v.store_label_source === 'map' ? 'the map' : 'their own store record',
        v.outlet_name,
        formatLagos(v.arrived_at, false),
        v.departed_at ? formatLagos(v.departed_at, false) : `still there (${v.status})`,
        String(v.minutes),
        v.arrived_status ?? '—',
        metres(v.arrived_distance_m),
        v.departed_status ?? '—',
        v.departed_at ? metres(v.departed_distance_m) : '—',
        v.arrived_label ?? '—',
        url ?? 'deleted after 24h',
      ],
    }
  })
}

/** A short summary the reader sees before the table: rounds, stores, time. */
export function visitSummary(visits: VisitExportRow[]) {
  const people = new Set(visits.map((v) => v.staff_name))
  const stores = new Set(visits.map((v) => v.outlet_name))
  const offSite = visits.filter((v) => v.arrived_status !== 'on_site').length
  const minutes = visits.reduce((total, v) => total + v.minutes, 0)
  return { people: people.size, stores: stores.size, offSite, minutes }
}

export function visitSheet(visits: VisitExportRow[], rows: ExportRow[]): Sheet {
  const s = visitSummary(visits)
  return {
    title: 'Xtend store visits',
    subtitle:
      `${visits.length} visit(s) · ${s.people} staff · ${s.stores} store(s) · ` +
      `${s.minutes} minutes in store · ${s.offSite} arrived away from the store. ` +
      'Times are Africa/Lagos. Clock photos are deleted 24 hours after capture; links to ' +
      'the ones still held expire an hour after this file was made.',
    sheetName: 'Store visits',
    columns: VISIT_COLUMNS,
    rows,
    widths: {
      xlsx: [20, 11, 26, 14, 22, 12, 16, 12, 12, 14, 12, 16, 34, 15],
      pdf: [74, 46, 92, 44, 74, 42, 50, 34, 38, 46, 38, 46, 130, 44],
    },
    linkColumn: VISIT_COLUMNS.length - 1,
    statusColumn: 8,
    fileBase: 'xtend-store-visits',
  }
}
