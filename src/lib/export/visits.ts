import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportRow, Sheet } from '@/lib/export/render'
import { signSelfies } from '@/lib/export/data'
import { formatLagos, metres } from '@/lib/utils'
import {
  FLAG_WORDS,
  SHORT_MINUTES,
  parseVisitFilter as parseFilter,
  visitFigures,
  visitFlags,
  worthALook,
  type Covered,
  type CoverageRow,
  type VisitFilter,
  type VisitRow,
} from '@/lib/visit-review'

export type { VisitFilter }
export type VisitExportRow = VisitRow

export function parseVisitFilter(url: URL): VisitFilter {
  return { ...parseFilter(url.searchParams), limit: Number(url.searchParams.get('limit')) || 2000 }
}

/**
 * RLS decides the rows: a supervisor's export covers their team and nobody
 * else's, without the route having to say so.
 */
export async function fetchVisits(
  supabase: SupabaseClient,
  filter: Partial<VisitFilter>,
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
  if (filter.status === 'none') query = query.is('arrived_status', null)
  else if (filter.status) query = query.eq('arrived_status', filter.status)
  if (filter.short) query = query.lt('minutes', filter.short).not('departed_at', 'is', null)
  if (filter.team) {
    // A team is whoever reports to that supervisor, as far as RLS lets the reader see.
    const { data: team } = await supabase.from('profiles').select('id').eq('supervisor_id', filter.team)
    const ids = (team ?? []).map((p) => p.id as string)
    if (!ids.length) return []
    query = query.in('user_id', ids)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as VisitExportRow[]
}

/** Every store with its last visit (052), through RLS like everything else. */
export async function fetchCoverage(supabase: SupabaseClient): Promise<{ rows: CoverageRow[]; error: string | null }> {
  const { data, error } = await supabase.from('store_coverage').select('*').order('name').limit(3000)
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /store_coverage/.test(error.message)
    return { rows: [], error: missing ? 'Store coverage needs the store visits update (052) run in Supabase.' : error.message }
  }
  return { rows: (data ?? []) as CoverageRow[], error: null }
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
  'Where they checked out',
  'Worth a look',
  'Selfie link',
] as const

export async function toVisitRows(
  supabase: SupabaseClient,
  visits: VisitExportRow[],
  shortMinutes = SHORT_MINUTES,
): Promise<ExportRow[]> {
  const signed = await signSelfies(
    supabase,
    visits.map((v) => v.selfie_path),
  )
  const findings = worthALook(visits, shortMinutes)

  return visits.map((v) => {
    const url = v.selfie_path ? (signed.get(v.selfie_path) ?? null) : null
    return {
      link: url,
      values: [
        v.staff_name,
        v.visit_date,
        v.store_label ?? v.outlet_name ?? 'Unnamed place',
        v.store_label_source === 'map' ? 'the map' : 'their own store record',
        v.outlet_name ?? '—',
        formatLagos(v.arrived_at, false),
        v.departed_at ? formatLagos(v.departed_at, false) : `still there (${v.status})`,
        String(v.minutes),
        v.arrived_status ?? '—',
        metres(v.arrived_distance_m),
        v.departed_status ?? '—',
        v.departed_at ? metres(v.departed_distance_m) : '—',
        v.arrived_label ?? '—',
        v.departed_label ?? '—',
        visitFlags(v, findings).map((k) => FLAG_WORDS[k]).join(', ') || '—',
        url ?? 'deleted after 24h',
      ],
    }
  })
}

/** A short summary the reader sees before the table: rounds, stores, time. */
export function visitSummary(visits: VisitExportRow[]) {
  const f = visitFigures(visits)
  return { people: f.people, stores: f.stores, offSite: f.offSite, minutes: f.minutes }
}

export function visitSheet(visits: VisitExportRow[], rows: ExportRow[], shortMinutes = SHORT_MINUTES): Sheet {
  const f = visitFigures(visits, shortMinutes)
  const flagged = rows.filter((r) => r.values[14] !== '—').length
  return {
    title: 'Xtend store visits',
    subtitle:
      `${visits.length} visit(s) · ${f.people} staff · ${f.stores} store(s) · ` +
      `${f.minutes} minutes in store${f.averageMinutes != null ? ` (about ${f.averageMinutes} a visit)` : ''} · ` +
      `${f.short} shorter than ${shortMinutes} min · ${f.offSite} arrived away from the store · ${flagged} worth a look. ` +
      'Times are Africa/Lagos. Clock photos are deleted 24 hours after capture; links to ' +
      'the ones still held expire an hour after this file was made.',
    sheetName: 'Store visits',
    columns: VISIT_COLUMNS,
    rows,
    wrap: true,
    widths: {
      xlsx: [20, 11, 26, 14, 22, 12, 16, 12, 12, 14, 12, 16, 34, 34, 26, 15],
      pdf: [62, 42, 78, 38, 62, 36, 44, 30, 34, 40, 34, 40, 80, 80, 54, 40],
    },
    linkColumn: VISIT_COLUMNS.length - 1,
    statusColumn: 8,
    fileBase: 'xtend-store-visits',
  }
}

export const COVERAGE_COLUMNS = [
  'Store',
  'Address',
  'Staff covering it',
  'Last visit',
  'Days since',
  'Last visited by',
  'Visits in the last 30 days',
] as const

export function coverageSheet(rows: Covered[], today: string): Sheet {
  const never = rows.filter((r) => r.daysSince === null).length
  const over7 = rows.filter((r) => r.daysSince === null || r.daysSince >= 7).length
  return {
    title: 'Xtend store coverage',
    subtitle:
      `${rows.length} store(s) as of ${today} · ${over7} not visited in 7 days or more · ${never} with no visit on record. ` +
      'Longest without a visit first. Times are Africa/Lagos.',
    sheetName: 'Store coverage',
    columns: COVERAGE_COLUMNS,
    rows: rows.map((r) => ({
      values: [
        r.name,
        r.address ?? '—',
        String(r.staff_assigned),
        r.last_visit_at ? formatLagos(r.last_visit_at) : 'Never',
        r.daysSince === null ? '—' : String(r.daysSince),
        r.last_visit_by ?? '—',
        String(r.visits_30d),
      ],
    })),
    wrap: true,
    widths: { xlsx: [30, 40, 14, 20, 10, 22, 14], pdf: [150, 200, 60, 90, 50, 110, 70] },
    fileBase: 'xtend-store-coverage',
  }
}
