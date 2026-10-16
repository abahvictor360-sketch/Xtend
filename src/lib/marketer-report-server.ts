import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail, UserRole } from '@/lib/types'
import { fetchEvents } from '@/lib/attendance-server'
import { roleLabel, type StaffRole } from '@/lib/staff-roles'
import {
  buildMarketerReport,
  type MarketerReport,
  type ReportRequest,
  type SourceCount,
  type SourceReport,
  type SourceSale,
  type SourceVisit,
} from '@/lib/marketer-report'
import { lagosDateString } from '@/lib/utils'

type SourceClockRow = Parameters<typeof buildMarketerReport>[0]['events'][number]

const VISIT_COLUMNS =
  'user_id, outlet_id, outlet_name, outlet_address, arrived_address, store_label, visit_date, status, arrived_at, departed_at, minutes, arrived_status'

/**
 * Everything one person's report needs, read through the caller's own
 * client: RLS keeps a supervisor to their team, so somebody they cannot
 * see comes back as null.
 */
export async function loadMarketerReport(supabase: SupabaseClient, req: ReportRequest & { userId: string }): Promise<MarketerReport | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, staff_role_id, outlet_id, supervisor_id')
    .eq('id', req.userId)
    .maybeSingle<{ id: string; full_name: string; role: UserRole; staff_role_id: string | null; outlet_id: string | null; supervisor_id: string | null }>()
  if (!profile) return null

  const [roles, home, lead, got, visits, reports, counts, sales] = await Promise.all([
    supabase.from('staff_roles').select('id, name, base_role, is_active'),
    profile.outlet_id
      ? supabase.from('outlets').select('name').eq('id', profile.outlet_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
    profile.supervisor_id
      ? supabase.from('profiles').select('full_name').eq('id', profile.supervisor_id).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    fetchEvents<AttendanceDetail>(supabase, req.from, req.to, { full: true, userId: req.userId }),
    supabase
      .from('store_visit_detail')
      .select(VISIT_COLUMNS)
      .eq('user_id', req.userId)
      .gte('visit_date', req.from)
      .lte('visit_date', req.to)
      .order('arrived_at')
      .limit(3000),
    supabase
      .from('reports')
      .select('report_date, created_at, updated_at, body, sales_summary, stock_status, competitor_activity, issues')
      .eq('user_id', req.userId)
      .gte('report_date', req.from)
      .lte('report_date', req.to),
    supabase
      .from('store_count_detail')
      .select('count_date, outlet_name, product_name, in_store, sold')
      .eq('user_id', req.userId)
      .gte('count_date', req.from)
      .lte('count_date', req.to)
      .limit(3000),
    supabase
      .from('xm_live_sale_lines')
      .select('sale_date, outlet_id, product_id, units')
      .eq('user_id', req.userId)
      .gte('sale_date', req.from)
      .lte('sale_date', req.to)
      .limit(3000),
  ])
  if (visits.error) throw new Error(visits.error.message)
  if (reports.error) throw new Error(reports.error.message)

  // Names for the X Metrics sales, which carry only ids.
  const saleRows = (sales.data ?? []) as { sale_date: string; outlet_id: string; product_id: string; units: number }[]
  const [products, outlets] = saleRows.length
    ? await Promise.all([
        supabase.from('products').select('id, name').in('id', [...new Set(saleRows.map((s) => s.product_id))]),
        supabase.from('outlets').select('id, name').in('id', [...new Set(saleRows.map((s) => s.outlet_id))]),
      ])
    : [{ data: [] }, { data: [] }]
  const productName = new Map(((products.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const outletName = new Map(((outlets.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
  const saleLines: SourceSale[] = saleRows.map((s) => ({
    sale_date: s.sale_date,
    outlet_name: outletName.get(s.outlet_id) ?? null,
    product_name: productName.get(s.product_id) ?? null,
    units: s.units,
  }))

  return buildMarketerReport({
    kind: req.kind,
    person: {
      name: profile.full_name,
      role: roleLabel(profile, (roles.data ?? []) as StaffRole[]),
      supervisor: lead.data?.full_name ?? (profile.supervisor_id ? 'Another team' : null),
      homeStore: home.data?.name ?? null,
    },
    from: req.from,
    to: req.to,
    today: lagosDateString(),
    generatedAt: new Date().toISOString(),
    events: got.events as SourceClockRow[],
    visits: (visits.data ?? []) as SourceVisit[],
    reports: (reports.data ?? []) as SourceReport[],
    counts: (counts.data ?? []) as SourceCount[],
    sales: saleLines,
  })
}

export interface MarketerRow {
  id: string
  name: string
  role: string
  team: string | null
  visits: number
  stores: number
  minutes: number
  reports: number
  active: boolean
}

/**
 * The people the Marketer reports page lists for a period: every marketer
 * the caller can see, and anyone else who checked in to a store in it,
 * with their visits and reports for the period.
 */
export async function loadMarketerRows(supabase: SupabaseClient, from: string, to: string): Promise<MarketerRow[]> {
  const [people, roles, visits, reports] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, staff_role_id, supervisor_id, is_active')
      .in('role', ['marketer', 'merchandiser'])
      .order('full_name'),
    supabase.from('staff_roles').select('id, name, base_role, is_active'),
    supabase
      .from('store_visit_detail')
      .select('user_id, outlet_id, store_label, minutes')
      .gte('visit_date', from)
      .lte('visit_date', to)
      .limit(20000),
    supabase.from('reports').select('user_id').gte('report_date', from).lte('report_date', to).limit(20000),
  ])
  if (people.error) throw new Error(people.error.message)
  const list = (people.data ?? []) as {
    id: string
    full_name: string
    role: UserRole
    staff_role_id: string | null
    supervisor_id: string | null
    is_active: boolean
  }[]
  const leadIds = [...new Set(list.map((p) => p.supervisor_id).filter((v): v is string => Boolean(v)))]
  const { data: leads } = leadIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', leadIds)
    : { data: [] }
  const leadName = new Map(((leads ?? []) as { id: string; full_name: string }[]).map((l) => [l.id, l.full_name]))

  const stats = new Map<string, { visits: number; stores: Set<string>; minutes: number; reports: number }>()
  const stat = (id: string) => {
    const s = stats.get(id) ?? { visits: 0, stores: new Set<string>(), minutes: 0, reports: 0 }
    stats.set(id, s)
    return s
  }
  for (const v of (visits.data ?? []) as { user_id: string; outlet_id: string | null; store_label: string | null; minutes: number }[]) {
    const s = stat(v.user_id)
    s.visits += 1
    s.stores.add(v.outlet_id ?? `place:${v.store_label ?? ''}`)
    s.minutes += Math.max(0, v.minutes ?? 0)
  }
  for (const r of (reports.data ?? []) as { user_id: string }[]) stat(r.user_id).reports += 1

  const roleList = (roles.data ?? []) as StaffRole[]
  return list
    .filter((p) => p.role === 'marketer' || stats.has(p.id))
    .map((p) => {
      const s = stats.get(p.id)
      return {
        id: p.id,
        name: p.full_name,
        role: roleLabel(p, roleList),
        team: p.supervisor_id ? (leadName.get(p.supervisor_id) ?? 'Another team') : null,
        visits: s?.visits ?? 0,
        stores: s?.stores.size ?? 0,
        minutes: s?.minutes ?? 0,
        reports: s?.reports ?? 0,
        active: p.is_active,
      }
    })
}
