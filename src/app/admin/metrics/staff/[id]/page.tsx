import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonthPicker, VoidButton, XmHeader } from '@/components/admin/xm/widgets'
import { DayBars } from '@/components/admin/xm/day-bars'
import { longDate } from '@/lib/utils'
import { bandVariant, fmtScore, monthLabel, monthStart, type XmGrade } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Staff — X Metrics' }

export default async function StaffMetricsPage({
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
  const supabase = await createServerSupabase()

  const { data: person } = await supabase.from('profiles').select('id, full_name, role').eq('id', id).maybeSingle<{ id: string; full_name: string; role: string }>()
  if (!person) notFound()

  const [{ data: grade }, { data: history }, { data: counts }, { data: sales }, { data: lines }, { data: recs }] = await Promise.all([
    supabase.rpc('xm_grade', { p_user: id, p_month: month }),
    supabase.from('xm_monthly_grades').select('month, score, band').eq('user_id', id).order('month', { ascending: false }).limit(12),
    supabase.from('xm_counts').select('id, outlet_id, count_date, captured_at, distance_m, is_opening, voided_at, void_reason, outlets(name)').eq('user_id', id).gte('count_date', month).lte('count_date', end).order('captured_at', { ascending: false }),
    supabase.from('xm_sales').select('id, outlet_id, sale_date, captured_at, created_at, superseded_by, voided_at, void_reason, outlets(name)').eq('user_id', id).gte('sale_date', month).lte('sale_date', end).order('sale_date', { ascending: false }),
    supabase.from('xm_live_sale_lines').select('sale_date, units').eq('user_id', id).gte('sale_date', month).lte('sale_date', end).limit(20000),
    supabase.from('xm_reconciliation_detail').select('id, count_date, outlet_name, product_name, expected_units, actual_units, variance_units, variance_pct, flagged').eq('user_id', id).gte('count_date', month).lte('count_date', end).order('count_date', { ascending: false }),
  ])
  const g = grade as XmGrade | null
  const byDay = new Map<string, number>()
  for (const l of (lines ?? []) as { sale_date: string; units: number }[]) byDay.set(l.sale_date, (byDay.get(l.sale_date) ?? 0) + l.units)
  const storeName = (o: unknown) => (Array.isArray(o) ? o[0]?.name : (o as { name?: string } | null)?.name) ?? ''

  return (
    <div className="space-y-5">
      <XmHeader title={person.full_name} intro={`X Metrics for ${monthLabel(month)}: grade, counts, sales and reconciliation.`} readOnly={readOnly} />
      <MonthPicker month={month} />

      {g && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Grade</p>
              <p className="mt-1 text-3xl font-bold">{fmtScore(g.score)}</p>
              <Badge variant={bandVariant(g.band)}>{g.band ?? 'Not graded'}</Badge>
            </CardContent>
          </Card>
          <Factor title={`Sales (${g.weights.sales})`} score={g.sales.score}
            detail={g.sales.target ? `${g.sales.target_kind === 'store' ? `${g.sales.store_units_sold ?? 0} store` : g.sales.units_sold} of ${g.sales.target} ${g.sales.target_kind === 'store' ? '(store target)' : ''}` : `${g.sales.units_sold} sold, no target`} />
          <Factor title={`Accuracy (${g.weights.accuracy})`} score={g.accuracy.score}
            detail={`${g.accuracy.within_tolerance} of ${g.accuracy.reconciliations} within ${g.accuracy.tolerance_pct}%`} />
          <Factor title={`Consistency (${g.weights.consistency})`} score={g.consistency.score}
            detail={`${g.consistency.days_present} days present: sales on time ${g.consistency.sales_on_time}, count in time ${g.consistency.counts_in_time}`} />
          <Factor title={`Expiry (${g.weights.expiry})`} score={g.expiry.score}
            detail={`${g.expiry.expiry_recorded} of ${g.expiry.lines_counted} lines dated, ${g.expiry.expired_on_shelf} expired on shelf`} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Units sold per day</CardTitle></CardHeader>
        <CardContent><DayBars month={month} byDay={byDay} /></CardContent>
      </Card>

      {(history ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Finalised grades</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {((history ?? []) as { month: string; score: number | null; band: string | null }[]).map((h) => (
              <Link key={h.month} href={`?month=${h.month.slice(0, 7)}`}>
                <Badge variant={bandVariant(h.band)}>{monthLabel(h.month)}: {fmtScore(h.score)}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Reconciliation</CardTitle></CardHeader>
        <CardContent className="p-0">
          {(recs ?? []).length === 0 ? <p className="p-5 pt-0 text-sm text-muted-foreground">Nothing reconciled this month.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Store</TableHead><TableHead>Product</TableHead>
                <TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Gap</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {((recs ?? []) as { id: string; count_date: string; outlet_name: string; product_name: string; expected_units: number; actual_units: number; variance_units: number; variance_pct: number; flagged: boolean }[]).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{longDate(r.count_date)}</TableCell><TableCell>{r.outlet_name}</TableCell><TableCell>{r.product_name}</TableCell>
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
        <CardHeader><CardTitle>What they sent</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>What</TableHead><TableHead>Day</TableHead><TableHead>Store</TableHead><TableHead>Sent</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {((counts ?? []) as { id: string; count_date: string; captured_at: string; distance_m: number | null; is_opening: boolean; voided_at: string | null; void_reason: string | null; outlets: unknown }[]).map((c) => (
                <TableRow key={c.id} className={c.voided_at ? 'opacity-60' : undefined}>
                  <TableCell>Stock count {c.is_opening && <Badge>Opening</Badge>}</TableCell>
                  <TableCell>{longDate(c.count_date)}</TableCell>
                  <TableCell>{storeName(c.outlets)}{c.distance_m !== null && <span className="block text-xs text-muted-foreground">{Math.round(c.distance_m)} m from the pin</span>}</TableCell>
                  <TableCell className="text-xs">{new Date(c.captured_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</TableCell>
                  <TableCell>{c.voided_at ? <span className="text-xs">Voided: {c.void_reason}</span> : !readOnly && <VoidButton kind="count" id={c.id} />}</TableCell>
                </TableRow>
              ))}
              {((sales ?? []) as { id: string; sale_date: string; captured_at: string; created_at: string; superseded_by: string | null; voided_at: string | null; void_reason: string | null; outlets: unknown }[]).map((s) => (
                <TableRow key={s.id} className={s.voided_at || s.superseded_by ? 'opacity-60' : undefined}>
                  <TableCell>Daily sales {s.superseded_by && <Badge variant="outline">Replaced</Badge>}</TableCell>
                  <TableCell>{longDate(s.sale_date)}</TableCell>
                  <TableCell>{storeName(s.outlets)}</TableCell>
                  <TableCell className="text-xs">{new Date(s.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</TableCell>
                  <TableCell>{s.voided_at ? <span className="text-xs">Voided: {s.void_reason}</span> : !readOnly && !s.superseded_by && <VoidButton kind="sales" id={s.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function Factor({ title, score, detail }: { title: string; score: number | null; detail: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-bold">{fmtScore(score)}</p>
        <p className="text-xs text-muted-foreground">{score === null ? 'Nothing to judge yet' : detail}</p>
      </CardContent>
    </Card>
  )
}
