import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExportLinks, RunChecksButton, XmHeader } from '@/components/admin/xm/widgets'
import { KpiCards, RecentActivity, SalesOverviewChart, StockRings, TopStores } from '@/components/admin/xm/dashboard'
import { loadXmDashboard } from '@/lib/metrics/dashboard'
import { addDays, lagosDateString, longDate } from '@/lib/utils'
import { monthStart, windowLabel } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'X Metrics — Xtend' }

interface Gap {
  id: string
  count_date: string
  outlet_id: string
  outlet_name: string
  user_id: string
  staff_name: string | null
  product_name: string
  expected_units: number
  actual_units: number
  variance_units: number
  variance_pct: number
  flag_id: string | null
}

interface ExpiryRow {
  id: string
  outlet_name: string
  product_name: string
  batch: string
  expiry_date: string
  window_days: number
  units_on_hand: number
  consider_pulling: boolean
}

export default async function MetricsOverview() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role !== 'admin'
  const supabase = await createServerSupabase()
  const today = lagosDateString()
  const month = monthStart(today)

  const [{ data: stores }, { data: gaps }, { data: expiry, count: expiryCount }, { data: onHand }, { data: sold }, { data: lastCounts }] =
    await Promise.all([
      supabase.from('xm_stores').select('outlet_id, is_active, outlets(name)').eq('is_active', true),
      supabase
        .from('xm_reconciliation_detail')
        .select('id, count_date, outlet_id, outlet_name, user_id, staff_name, product_name, expected_units, actual_units, variance_units, variance_pct, flag_id')
        .eq('flagged', true)
        .gte('count_date', addDays(today, -30))
        .order('count_date', { ascending: false })
        .limit(50),
      supabase
        .from('xm_expiry_alert_detail')
        .select('id, outlet_name, product_name, batch, expiry_date, window_days, units_on_hand, consider_pulling', { count: 'exact' })
        .is('acknowledged_at', null)
        .order('days_left')
        .limit(8),
      supabase.from('xm_stock_on_hand').select('outlet_id, units').limit(20000),
      supabase.from('xm_live_sale_lines').select('outlet_id, units').gte('sale_date', month).limit(50000),
      supabase.from('xm_counts').select('outlet_id, count_date').is('voided_at', null).order('count_date', { ascending: false }).limit(2000),
    ])

  const unitsBy = new Map<string, number>()
  for (const r of (onHand ?? []) as { outlet_id: string; units: number }[]) unitsBy.set(r.outlet_id, (unitsBy.get(r.outlet_id) ?? 0) + r.units)
  const soldBy = new Map<string, number>()
  for (const r of (sold ?? []) as { outlet_id: string; units: number }[]) soldBy.set(r.outlet_id, (soldBy.get(r.outlet_id) ?? 0) + r.units)
  const lastBy = new Map<string, string>()
  for (const r of (lastCounts ?? []) as { outlet_id: string; count_date: string }[]) if (!lastBy.has(r.outlet_id)) lastBy.set(r.outlet_id, r.count_date)
  const gapsBy = new Map<string, number>()
  for (const g of (gaps ?? []) as Gap[]) gapsBy.set(g.outlet_id, (gapsBy.get(g.outlet_id) ?? 0) + 1)

  const storeRows = ((stores ?? []) as unknown as { outlet_id: string; outlets: { name: string } | { name: string }[] | null }[])
    .map((s) => ({
      id: s.outlet_id,
      name: (Array.isArray(s.outlets) ? s.outlets[0]?.name : s.outlets?.name) ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const pull = ((expiry ?? []) as ExpiryRow[]).filter((e) => e.consider_pulling).length

  const dash = await loadXmDashboard(supabase, today)

  return (
    <div className="space-y-5">
      <XmHeader
        title="X Metrics"
        intro="Stock, sales and expiry for the stores in X Metrics: what merchandisers count and sell, what was supplied, and where the numbers do not add up."
        readOnly={readOnly}
      />

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && <RunChecksButton />}
        <ExportLinks kind="stock" label="Stock on hand" />
      </div>

      <KpiCards kpis={dash.kpis} />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Sales overview</CardTitle>
            <CardDescription>Units sold and supplied across all X Metrics stores, last 12 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <SalesOverviewChart months={dash.months} />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Stock statistic</CardTitle>
            <CardDescription>How well counts match, and sales against store targets, this month.</CardDescription>
          </CardHeader>
          <CardContent>
            <StockRings accuracy={dash.accuracy} salesVsTarget={dash.salesVsTarget} categories={dash.categories} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The latest counts, daily sales and supplies.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecentActivity items={dash.activity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top stores</CardTitle>
            <CardDescription>Units sold this month{dash.stores.some((s) => s.target) ? ', against each store\'s target' : ''}.</CardDescription>
          </CardHeader>
          <CardContent>
            <TopStores stores={dash.stores} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Stock gaps</CardTitle>
          <CardDescription>
            Counts that differ from what was expected (last count + supplied − sold) by more than the
            tolerance. Each one is also an integrity flag on the person, to review there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(gaps ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No gaps in the last 30 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Counted by</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((gaps ?? []) as Gap[]).map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="whitespace-nowrap">{longDate(g.count_date)}</TableCell>
                    <TableCell>
                      <Link className="hover:underline" href={`/admin/metrics/stores/${g.outlet_id}`}>{g.outlet_name}</Link>
                    </TableCell>
                    <TableCell>
                      <Link className="hover:underline" href={`/admin/metrics/staff/${g.user_id}`}>{g.staff_name}</Link>
                    </TableCell>
                    <TableCell>{g.product_name}</TableCell>
                    <TableCell className="text-right">{g.expected_units}</TableCell>
                    <TableCell className="text-right">{g.actual_units}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={g.variance_units < 0 ? 'destructive' : 'warning'}>
                        {g.variance_units > 0 ? '+' : ''}
                        {g.variance_units} ({g.variance_pct}%)
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Link href="/admin/integrity" className="mt-3 inline-block text-xs font-semibold text-brand hover:underline">
            Review the flags →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiry alerts</CardTitle>
          <CardDescription>Batches entering an expiry window, soonest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {(expiry ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {((expiry ?? []) as ExpiryRow[]).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{e.product_name}</span>
                    {e.batch && <span className="text-muted-foreground"> · batch {e.batch}</span>}
                    <span className="text-muted-foreground"> · {e.outlet_name} · {e.units_on_hand} units</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={e.window_days <= 30 ? 'destructive' : 'warning'}>
                      {e.window_days === 0 ? 'Expired' : `Within ${windowLabel(e.window_days)}`} · {longDate(e.expiry_date)}
                    </Badge>
                    {e.consider_pulling && <Badge variant="destructive">Consider pulling</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/metrics/expiry" className="mt-3 inline-block text-xs font-semibold text-brand hover:underline">
            All expiry alerts →
          </Link>
        </CardContent>
      </Card>

      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stores</CardTitle>
          <CardDescription>Open a store for its stock, sales, supplies and reconciliation.</CardDescription>
        </CardHeader>
        <CardContent>
          {storeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No store is in X Metrics yet.{' '}
              {!readOnly && <Link className="font-semibold text-brand hover:underline" href="/admin/metrics/setup">Add stores</Link>}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Last count</TableHead>
                  <TableHead className="text-right">Units on hand</TableHead>
                  <TableHead className="text-right">Sold this month</TableHead>
                  <TableHead className="text-right">Gaps (30 days)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeRows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link className="font-semibold hover:underline" href={`/admin/metrics/stores/${s.id}`}>{s.name}</Link>
                    </TableCell>
                    <TableCell>{lastBy.has(s.id) ? longDate(lastBy.get(s.id)!) : <span className="text-muted-foreground">No count yet</span>}</TableCell>
                    <TableCell className="text-right">{unitsBy.get(s.id) ?? '—'}</TableCell>
                    <TableCell className="text-right">{soldBy.get(s.id) ?? 0}</TableCell>
                    <TableCell className="text-right">{gapsBy.get(s.id) ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
