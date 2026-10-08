import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MonthBar {
  month: string // YYYY-MM-01
  label: string // "Jan"
  sold: number
  supplied: number
}

export interface Kpi {
  label: string
  value: string
  /** Change against last month, shown as a pill: "+12%". Null: nothing to compare. */
  change: string | null
  tone: 'up' | 'down' | 'flat'
  note: string
}

export interface CategoryShare {
  name: string
  units: number
  share: number
}

export interface Activity {
  id: string
  kind: 'count' | 'sales' | 'supply'
  what: string
  store: string
  who: string
  at: string
  status: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
  href: string
}

export interface StoreBar {
  id: string
  name: string
  sold: number
  target: number | null
}

export interface XmDashboard {
  kpis: Kpi[]
  months: MonthBar[]
  accuracy: { pct: number | null; checked: number; gaps: number }
  salesVsTarget: { pct: number | null; sold: number; target: number }
  categories: CategoryShare[]
  activity: Activity[]
  stores: StoreBar[]
}

const monthKey = (d: string) => `${d.slice(0, 7)}-01`
const shortMonth = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + by, 1))
  return d.toISOString().slice(0, 10)
}

function change(now: number, before: number): Pick<Kpi, 'change' | 'tone'> {
  if (!before) return { change: now ? 'New' : null, tone: now ? 'up' : 'flat' }
  const pct = Math.round(((now - before) / before) * 100)
  return { change: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' }
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * Everything the X Metrics overview shows, worked out from the tables the
 * caller may read (RLS narrows a supervisor to their team). `today` is the
 * Lagos business date.
 */
export async function loadXmDashboard(db: SupabaseClient, today: string): Promise<XmDashboard> {
  const thisMonth = monthKey(today)
  const lastMonth = shiftMonth(thisMonth, -1)
  const firstMonth = shiftMonth(thisMonth, -11)
  // Last month up to the same day, so a part month is compared fairly.
  const day = Number(today.slice(8, 10))
  const lastMonthDays = new Date(Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)).getUTCDate()
  const lastMonthSameDay = `${lastMonth.slice(0, 8)}${String(Math.min(day, lastMonthDays)).padStart(2, '0')}`

  const [{ data: sales }, { data: supplies }, { data: recs }, { data: expiry }, { data: products }, { data: targets }, { data: counts }, { data: salesReports }, { data: supplyRows }, { data: stores }] =
    await Promise.all([
      db.from('xm_live_sale_lines').select('sale_date, outlet_id, product_id, units').gte('sale_date', firstMonth).limit(100000),
      db.from('xm_supplies').select('supplied_on, quantity').is('voided_at', null).gte('supplied_on', firstMonth).limit(50000),
      db.from('xm_reconciliation_detail').select('count_date, flagged').gte('count_date', lastMonth).limit(50000),
      db.from('xm_expiry_alerts').select('consider_pulling').is('acknowledged_at', null).limit(5000),
      db.from('products').select('id, category'),
      db.from('xm_current_targets').select('outlet_id, user_id, target_units').eq('month', thisMonth),
      db
        .from('xm_counts')
        .select('id, user_id, outlet_id, count_date, captured_at, is_opening, reconciled_at, voided_at, outlets(name), profiles:user_id(full_name)')
        .order('captured_at', { ascending: false })
        .limit(8),
      db
        .from('xm_sales')
        .select('id, user_id, outlet_id, sale_date, created_at, superseded_by, voided_at, outlets(name), profiles:user_id(full_name)')
        .order('created_at', { ascending: false })
        .limit(8),
      db
        .from('xm_supply_detail')
        .select('id, outlet_id, outlet_name, product_name, quantity, created_at, voided_at, logged_by_name')
        .order('created_at', { ascending: false })
        .limit(8),
      db.from('xm_stores').select('outlet_id, outlets(name)').eq('is_active', true),
    ])

  // Months, oldest first.
  const months: MonthBar[] = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(firstMonth, i)
    return { month: m, label: shortMonth(m), sold: 0, supplied: 0 }
  })
  const byMonth = new Map(months.map((m) => [m.month, m]))
  type SaleRow = { sale_date: string; outlet_id: string; product_id: string; units: number }
  const saleRows = (sales ?? []) as SaleRow[]
  for (const s of saleRows) {
    const m = byMonth.get(monthKey(s.sale_date))
    if (m) m.sold += s.units
  }
  for (const s of (supplies ?? []) as { supplied_on: string; quantity: number }[]) {
    const m = byMonth.get(monthKey(s.supplied_on))
    if (m) m.supplied += s.quantity
  }

  const soldNow = byMonth.get(thisMonth)!.sold
  const soldBefore = saleRows
    .filter((s) => s.sale_date >= lastMonth && s.sale_date <= lastMonthSameDay)
    .reduce((n, s) => n + s.units, 0)
  const suppliedNow = byMonth.get(thisMonth)!.supplied
  const suppliedBefore = ((supplies ?? []) as { supplied_on: string; quantity: number }[])
    .filter((s) => s.supplied_on >= lastMonth && s.supplied_on <= lastMonthSameDay)
    .reduce((n, s) => n + s.quantity, 0)

  const recRows = (recs ?? []) as { count_date: string; flagged: boolean }[]
  const recNow = recRows.filter((r) => r.count_date >= thisMonth)
  const recBefore = recRows.filter((r) => r.count_date < thisMonth)
  const accNow = recNow.length ? Math.round((100 * recNow.filter((r) => !r.flagged).length) / recNow.length) : null
  const accBefore = recBefore.length ? Math.round((100 * recBefore.filter((r) => !r.flagged).length) / recBefore.length) : null

  const alerts = (expiry ?? []) as { consider_pulling: boolean }[]
  const pull = alerts.filter((a) => a.consider_pulling).length

  const fmt = (n: number) => n.toLocaleString('en-GB')
  const kpis: Kpi[] = [
    { label: 'Units sold this month', value: fmt(soldNow), ...change(soldNow, soldBefore), note: 'vs last month to date' },
    { label: 'Units supplied', value: fmt(suppliedNow), ...change(suppliedNow, suppliedBefore), note: 'vs last month to date' },
    {
      label: 'Stock accuracy',
      value: accNow === null ? '—' : `${accNow}%`,
      change: accNow === null || accBefore === null ? null : `${accNow - accBefore >= 0 ? '+' : ''}${accNow - accBefore} pts`,
      tone: accNow === null || accBefore === null ? 'flat' : accNow > accBefore ? 'up' : accNow < accBefore ? 'down' : 'flat',
      note: 'counts within tolerance',
    },
    {
      label: 'Open expiry alerts',
      value: fmt(alerts.length),
      change: pull ? `${pull} to pull` : null,
      // More alerts is worse: a batch to pull is shown as a fall.
      tone: pull ? 'down' : 'flat',
      note: 'batches near expiry',
    },
  ]

  // Store targets this month, against what those stores sold.
  const targetRows = (targets ?? []) as { outlet_id: string | null; user_id: string | null; target_units: number }[]
  const storeTarget = new Map(targetRows.filter((t) => t.outlet_id).map((t) => [t.outlet_id!, t.target_units]))
  const soldByStore = new Map<string, number>()
  for (const s of saleRows) if (s.sale_date >= thisMonth) soldByStore.set(s.outlet_id, (soldByStore.get(s.outlet_id) ?? 0) + s.units)
  const targetTotal = [...storeTarget.values()].reduce((a, b) => a + b, 0)
  const soldTowardTarget = [...storeTarget.keys()].reduce((n, id) => n + (soldByStore.get(id) ?? 0), 0)

  // Sales this month by product category.
  const category = new Map(((products ?? []) as { id: string; category: string | null }[]).map((p) => [p.id, p.category ?? 'Uncategorised']))
  const byCategory = new Map<string, number>()
  for (const s of saleRows) {
    if (s.sale_date < thisMonth) continue
    const c = category.get(s.product_id) ?? 'Uncategorised'
    byCategory.set(c, (byCategory.get(c) ?? 0) + s.units)
  }
  const categories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, units]) => ({ name, units, share: soldNow ? Math.round((100 * units) / soldNow) : 0 }))

  // Recent activity, newest first.
  const storeName = (o: unknown) => one(o as { name: string } | { name: string }[] | null)?.name ?? ''
  const person = (p: unknown) => one(p as { full_name: string } | { full_name: string }[] | null)?.full_name ?? ''
  const activity: Activity[] = [
    ...((counts ?? []) as { id: string; user_id: string; outlet_id: string; count_date: string; captured_at: string; is_opening: boolean; reconciled_at: string | null; voided_at: string | null; outlets: unknown; profiles: unknown }[]).map(
      (c): Activity => ({
        id: c.id,
        kind: 'count',
        what: c.is_opening ? 'Opening stock count' : 'Stock count',
        store: storeName(c.outlets),
        who: person(c.profiles),
        at: c.captured_at,
        status: c.voided_at
          ? { label: 'Voided', tone: 'bad' }
          : c.is_opening
            ? { label: 'Baseline', tone: 'neutral' }
            : c.reconciled_at
              ? { label: 'Reconciled', tone: 'good' }
              : { label: 'Awaiting check', tone: 'warn' },
        href: `/admin/metrics/stores/${c.outlet_id}`,
      }),
    ),
    ...((salesReports ?? []) as { id: string; user_id: string; outlet_id: string; sale_date: string; created_at: string; superseded_by: string | null; voided_at: string | null; outlets: unknown; profiles: unknown }[]).map(
      (s): Activity => ({
        id: s.id,
        kind: 'sales',
        what: 'Daily sales',
        store: storeName(s.outlets),
        who: person(s.profiles),
        at: s.created_at,
        status: s.voided_at
          ? { label: 'Voided', tone: 'bad' }
          : s.superseded_by
            ? { label: 'Replaced', tone: 'neutral' }
            : { label: 'Received', tone: 'good' },
        href: `/admin/metrics/staff/${s.user_id}`,
      }),
    ),
    ...((supplyRows ?? []) as { id: string; outlet_id: string; outlet_name: string; product_name: string; quantity: number; created_at: string; voided_at: string | null; logged_by_name: string | null }[]).map(
      (s): Activity => ({
        id: s.id,
        kind: 'supply',
        what: `Supply: ${s.quantity} × ${s.product_name}`,
        store: s.outlet_name,
        who: s.logged_by_name ?? 'Office',
        at: s.created_at,
        status: s.voided_at ? { label: 'Voided', tone: 'bad' } : { label: 'Delivered', tone: 'good' },
        href: `/admin/metrics/stores/${s.outlet_id}`,
      }),
    ),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)

  // Top stores this month.
  const storeList = ((stores ?? []) as unknown as { outlet_id: string; outlets: unknown }[]).map((s) => ({
    id: s.outlet_id,
    name: storeName(s.outlets),
  }))
  const topStores: StoreBar[] = storeList
    .map((s) => ({ ...s, sold: soldByStore.get(s.id) ?? 0, target: storeTarget.get(s.id) ?? null }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5)

  return {
    kpis,
    months,
    accuracy: { pct: accNow, checked: recNow.length, gaps: recNow.filter((r) => r.flagged).length },
    salesVsTarget: {
      pct: targetTotal ? Math.min(100, Math.round((100 * soldTowardTarget) / targetTotal)) : null,
      sold: soldTowardTarget,
      target: targetTotal,
    },
    categories,
    activity,
    stores: topStores,
  }
}

