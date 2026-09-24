import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { storeCounts, type StoreCountRow } from '@/lib/assistant-data'
import { REPORT_FORMATS, reportDownloadUrl } from '@/lib/assistant-report-spec'
import { ProductManager, type ManagedProduct } from '@/components/admin/product-manager'
import {
  CountRequests,
  type CountPerson,
  type CountRequestRow,
} from '@/components/admin/count-requests'
import type { Profile } from '@/lib/types'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { addDays, lagosDateString, longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store counts — Xtend' }

type Search = Record<string, string | string[] | undefined>

function one(search: Search, key: string) {
  const value = search[key]
  return (Array.isArray(value) ? value[0] : value) || null
}

/** Units sold over the period, and what is in each store at its latest count. */
function totalsByProduct(rows: StoreCountRow[]) {
  const latest = new Map<string, StoreCountRow>()
  const totals = new Map<string, { product: string; sold: number; in_store: number; stores: Set<string> }>()
  // Rows arrive newest first, so the first row per store and product is its latest count.
  for (const row of rows) {
    const key = `${row.store}|${row.product}`
    const t = totals.get(row.product) ?? { product: row.product, sold: 0, in_store: 0, stores: new Set() }
    t.sold += row.sold
    if (!latest.has(key)) {
      latest.set(key, row)
      t.in_store += row.in_store
      t.stores.add(row.store)
    }
    totals.set(row.product, t)
  }
  return [...totals.values()].sort((a, b) => b.sold - a.sold)
}

export default async function StoreCountsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const search = await searchParams
  const supabase = await createServerSupabase()

  const today = lagosDateString()
  const from = one(search, 'from') ?? today
  const to = one(search, 'to') ?? from

  let rows: StoreCountRow[] = []
  let problem: string | null = null
  try {
    rows = (await storeCounts(supabase, from, to)).counts
  } catch (e) {
    problem = e instanceof Error ? e.message : 'The counts could not be loaded.'
  }

  const [{ data: products }, { data: staff }, { data: requests }] = await Promise.all([
    isAdmin
      ? supabase.from('products').select('id, name, sku, is_active').order('name')
      : Promise.resolve({ data: [] }),
    // Everyone for an admin, the supervisor's own team for a supervisor.
    supabase.rpc('my_staff'),
    supabase
      .from('count_request_progress')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  const people: CountPerson[] = ((staff ?? []) as Profile[])
    .filter(
      (p) =>
        p.is_active && p.id !== session.userId && (p.role === 'merchandiser' || p.role === 'marketer'),
    )
    .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role }))

  // The month-end window: the last three days of the month.
  const nextMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const monthEndFrom = addDays(nextMonth.toISOString().slice(0, 10), -3)

  const totals = totalsByProduct(rows)
  const title = from === to ? `Store counts, ${longDate(from)}` : `Store counts, ${longDate(from)} to ${longDate(to)}`
  const spec = { kind: 'store_counts' as const, from, to, name: null, title, summary: '' }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store counts</h1>
        <p className="text-sm text-muted-foreground">
          What merchandisers count in their stores: units on hand, and units sold since their
          last count. They count when a supervisor asks, and at the end of every month.
          {isAdmin ? ' The product list they count against is below.' : ''}
        </p>
      </div>

      <CountRequests
        people={people}
        requests={(requests ?? []) as CountRequestRow[]}
        today={today}
        monthEndFrom={monthEndFrom}
        myId={session.userId}
        isAdmin={isAdmin}
      />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} className="h-10 w-44" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} className="h-10 w-44" />
        </div>
        <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
          Show
        </button>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {REPORT_FORMATS.map((f) => (
              <a
                key={f.id}
                href={reportDownloadUrl(spec, f.id)}
                download
                className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-10' })}
              >
                {f.label}
              </a>
            ))}
          </div>
        )}
      </form>

      {problem && <Alert variant="destructive">{problem}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>By product</CardTitle>
        </CardHeader>
        <CardContent>
          {totals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No counts for these dates yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Sold (since last count)</TableHead>
                  <TableHead className="text-right">In store (latest)</TableHead>
                  <TableHead className="text-right">Stores</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals.map((t) => (
                  <TableRow key={t.product}>
                    <TableCell className="font-medium">{t.product}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.sold}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.in_store}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.stores.size}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Every count ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">In store</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.store}</TableCell>
                    <TableCell>{r.product}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.in_store}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isAdmin && <ProductManager products={(products ?? []) as ManagedProduct[]} />}
    </div>
  )
}
