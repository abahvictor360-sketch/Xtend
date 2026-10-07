import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExportLinks, MonthPicker, VoidButton, XmHeader } from '@/components/admin/xm/widgets'
import { DayBars } from '@/components/admin/xm/day-bars'
import { lagosDateString, longDate } from '@/lib/utils'
import { monthLabel, monthStart } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store — X Metrics' }

interface OnHand {
  product_id: string
  count_date: string
  batch: string
  expiry_date: string | null
  on_shelf: number
  in_backroom: number
  units: number
}

export default async function StoreMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role !== 'admin'
  const { id } = await params
  const month = monthStart((await searchParams).month)
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const today = lagosDateString()
  const supabase = await createServerSupabase()

  const { data: store } = await supabase.from('outlets').select('id, name, address').eq('id', id).maybeSingle<{ id: string; name: string; address: string | null }>()
  if (!store) notFound()

  const [{ data: enrolled }, { data: onHand }, { data: products }, { data: lines }, { data: target }, { data: recs }, { data: counts }, { data: sales }, { data: supplies }] =
    await Promise.all([
      supabase.from('xm_stores').select('enrolled_at, is_active').eq('outlet_id', id).maybeSingle<{ enrolled_at: string; is_active: boolean }>(),
      supabase.from('xm_stock_on_hand').select('product_id, count_date, batch, expiry_date, on_shelf, in_backroom, units').eq('outlet_id', id),
      supabase.from('products').select('id, name, sku, unit'),
      supabase.from('xm_live_sale_lines').select('sale_date, product_id, units').eq('outlet_id', id).gte('sale_date', month).lte('sale_date', end).limit(20000),
      supabase.from('xm_current_targets').select('target_units').eq('outlet_id', id).eq('month', month).maybeSingle<{ target_units: number }>(),
      supabase.from('xm_reconciliation_detail').select('id, count_date, staff_name, product_name, previous_units, supplied_units, sold_units, expected_units, actual_units, variance_units, variance_pct, flagged').eq('outlet_id', id).gte('count_date', month).lte('count_date', end).order('count_date', { ascending: false }),
      supabase.from('xm_counts').select('id, user_id, count_date, captured_at, is_opening, voided_at, void_reason, profiles:user_id(full_name)').eq('outlet_id', id).gte('count_date', month).lte('count_date', end).order('captured_at', { ascending: false }),
      supabase.from('xm_sales').select('id, user_id, sale_date, created_at, superseded_by, voided_at, void_reason, profiles:user_id(full_name)').eq('outlet_id', id).gte('sale_date', month).lte('sale_date', end).order('sale_date', { ascending: false }),
      supabase.from('xm_supply_detail').select('id, supplied_on, product_name, quantity, batch, expiry_date, voided_at').eq('outlet_id', id).gte('supplied_on', month).lte('supplied_on', end).order('supplied_on', { ascending: false }),
    ])

  const product = new Map(((products ?? []) as { id: string; name: string; sku: string | null; unit: string }[]).map((p) => [p.id, p]))
  const byDay = new Map<string, number>()
  const byProduct = new Map<string, number>()
  for (const l of (lines ?? []) as { sale_date: string; product_id: string; units: number }[]) {
    byDay.set(l.sale_date, (byDay.get(l.sale_date) ?? 0) + l.units)
    byProduct.set(l.product_id, (byProduct.get(l.product_id) ?? 0) + l.units)
  }
  const sold = [...byDay.values()].reduce((a, b) => a + b, 0)
  const stock = ((onHand ?? []) as OnHand[]).sort((a, b) =>
    (product.get(a.product_id)?.name ?? '').localeCompare(product.get(b.product_id)?.name ?? '') || (a.expiry_date ?? '9').localeCompare(b.expiry_date ?? '9'),
  )
  const daysLeft = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000)
  const who = (p: unknown) => (Array.isArray(p) ? p[0]?.full_name : (p as { full_name?: string } | null)?.full_name) ?? ''
  const recRows = (recs ?? []) as { id: string; count_date: string; staff_name: string | null; product_name: string; previous_units: number; supplied_units: number; sold_units: number; expected_units: number; actual_units: number; variance_units: number; variance_pct: number; flagged: boolean }[]
  const accuracy = recRows.length ? Math.round((100 * recRows.filter((r) => !r.flagged).length) / recRows.length) : null

  return (
    <div className="space-y-5">
      <XmHeader
        title={store.name}
        intro={enrolled ? `In X Metrics since ${longDate(enrolled.enrolled_at.slice(0, 10))}${enrolled.is_active ? '' : ' (taken out)'}.` : 'This store is not in X Metrics.'}
        readOnly={readOnly}
      />
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} />
        <ExportLinks kind="stock" outlet={id} label="Stock" />
        <ExportLinks kind="discrepancies" outlet={id} month={month} label="Reconciliation" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Sold in {monthLabel(month)}</p>
          <p className="mt-1 text-2xl font-bold">{sold}</p>
          <p className="text-xs text-muted-foreground">{target ? `Target ${target.target_units} (${Math.round((100 * sold) / target.target_units)}%)` : 'No store target'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Stock accuracy</p>
          <p className="mt-1 text-2xl font-bold">{accuracy === null ? '—' : `${accuracy}%`}</p>
          <p className="text-xs text-muted-foreground">{recRows.length} product counts reconciled</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Units on hand</p>
          <p className="mt-1 text-2xl font-bold">{stock.reduce((a, s) => a + s.units, 0)}</p>
          <p className="text-xs text-muted-foreground">From the latest count of each product</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Units sold per day</CardTitle></CardHeader>
        <CardContent><DayBars month={month} byDay={byDay} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Stock on hand</CardTitle></CardHeader>
        <CardContent className="p-0">
          {stock.length === 0 ? <p className="p-5 pt-0 text-sm text-muted-foreground">No count yet. The first count is the opening stock.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead>
                <TableHead className="text-right">Shelf</TableHead><TableHead className="text-right">Backroom</TableHead>
                <TableHead className="text-right">Sold this month</TableHead><TableHead>Counted</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {stock.map((s, i) => {
                  const left = s.expiry_date ? daysLeft(s.expiry_date) : null
                  return (
                    <TableRow key={`${s.product_id}-${s.batch}-${i}`}>
                      <TableCell className="font-semibold">{product.get(s.product_id)?.name}</TableCell>
                      <TableCell>{s.batch || '—'}</TableCell>
                      <TableCell>
                        {s.expiry_date ? longDate(s.expiry_date) : <span className="text-muted-foreground">Not recorded</span>}
                        {left !== null && left <= 90 && (
                          <Badge variant={left < 0 || left <= 30 ? 'destructive' : 'warning'} className="ml-2">{left < 0 ? 'Expired' : `${left} days`}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{s.on_shelf}</TableCell>
                      <TableCell className="text-right">{s.in_backroom}</TableCell>
                      <TableCell className="text-right">{byProduct.get(s.product_id) ?? 0}</TableCell>
                      <TableCell>{longDate(s.count_date)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reconciliation</CardTitle></CardHeader>
        <CardContent className="p-0">
          {recRows.length === 0 ? <p className="p-5 pt-0 text-sm text-muted-foreground">Nothing reconciled this month.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Counted by</TableHead>
                <TableHead className="text-right">Previous</TableHead><TableHead className="text-right">+ Supplied</TableHead><TableHead className="text-right">− Sold</TableHead>
                <TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Gap</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {recRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{longDate(r.count_date)}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.staff_name}</TableCell>
                    <TableCell className="text-right">{r.previous_units}</TableCell><TableCell className="text-right">{r.supplied_units}</TableCell><TableCell className="text-right">{r.sold_units}</TableCell>
                    <TableCell className="text-right">{r.expected_units}</TableCell><TableCell className="text-right">{r.actual_units}</TableCell>
                    <TableCell className="text-right"><Badge variant={r.flagged ? 'destructive' : 'success'}>{r.variance_units} ({r.variance_pct}%)</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Counts, sales and supplies</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>What</TableHead><TableHead>Day</TableHead><TableHead>By</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {((counts ?? []) as { id: string; user_id: string; count_date: string; is_opening: boolean; voided_at: string | null; void_reason: string | null; profiles: unknown }[]).map((c) => (
                <TableRow key={c.id} className={c.voided_at ? 'opacity-60' : undefined}>
                  <TableCell>Stock count {c.is_opening && <Badge>Opening stock</Badge>}</TableCell>
                  <TableCell>{longDate(c.count_date)}</TableCell>
                  <TableCell><Link className="hover:underline" href={`/admin/metrics/staff/${c.user_id}?month=${month.slice(0, 7)}`}>{who(c.profiles)}</Link></TableCell>
                  <TableCell>{c.voided_at ? <span className="text-xs">Voided: {c.void_reason}</span> : !readOnly && <VoidButton kind="count" id={c.id} />}</TableCell>
                </TableRow>
              ))}
              {((sales ?? []) as { id: string; user_id: string; sale_date: string; superseded_by: string | null; voided_at: string | null; void_reason: string | null; profiles: unknown }[]).map((s) => (
                <TableRow key={s.id} className={s.voided_at || s.superseded_by ? 'opacity-60' : undefined}>
                  <TableCell>Daily sales {s.superseded_by && <Badge variant="outline">Replaced</Badge>}</TableCell>
                  <TableCell>{longDate(s.sale_date)}</TableCell>
                  <TableCell><Link className="hover:underline" href={`/admin/metrics/staff/${s.user_id}?month=${month.slice(0, 7)}`}>{who(s.profiles)}</Link></TableCell>
                  <TableCell>{s.voided_at ? <span className="text-xs">Voided: {s.void_reason}</span> : !readOnly && !s.superseded_by && <VoidButton kind="sales" id={s.id} />}</TableCell>
                </TableRow>
              ))}
              {((supplies ?? []) as { id: string; supplied_on: string; product_name: string; quantity: number; batch: string; voided_at: string | null }[]).map((s) => (
                <TableRow key={s.id} className={s.voided_at ? 'opacity-60' : undefined}>
                  <TableCell>Supply: {s.quantity} × {s.product_name}{s.batch && ` (${s.batch})`}</TableCell>
                  <TableCell>{longDate(s.supplied_on)}</TableCell>
                  <TableCell className="text-muted-foreground">Office</TableCell>
                  <TableCell>{s.voided_at ? <span className="text-xs">Voided</span> : !readOnly && <VoidButton kind="supply" id={s.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
