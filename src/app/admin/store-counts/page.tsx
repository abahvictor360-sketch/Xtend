import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { storeCounts, type StoreCountRow } from '@/lib/assistant-data'
import { REPORT_FORMATS, reportDownloadUrl } from '@/lib/assistant-report-spec'
import {
  CountRequests,
  type CountPerson,
  type CountRequestRow,
} from '@/components/admin/count-requests'
import { CountTemplateCard } from '@/components/admin/count-template-card'
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
import { addDays, lagosDateString, longDate, metres } from '@/lib/utils'
import { countMonth } from '@/lib/count-sheet'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store counts — Xtend' }

type Search = Record<string, string | string[] | undefined>

function one(search: Search, key: string) {
  const value = search[key]
  return (Array.isArray(value) ? value[0] : value) || null
}

/** 31 Mar 2027 */
function shortDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
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

  const [{ data: staff }, { data: requests }, { data: sheetRows }, { data: template }, { count: sheetCount }] = await Promise.all([
    // Everyone for an admin, the supervisor's own team for a supervisor.
    supabase.rpc('my_staff'),
    supabase
      .from('count_request_progress')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(15),
    // Paper count sheets (migration 035); RLS narrows them like the counts.
    supabase
      .from('store_count_sheet_detail')
      .select('id, staff_name, outlet_name, count_date, file_name, content_type, path, created_at')
      .gte('count_date', from)
      .lte('count_date', to)
      .order('created_at', { ascending: false })
      .limit(500),
    // The blank count sheet staff download (migration 035).
    supabase
      .from('count_sheet_templates')
      .select('file_name, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ file_name: string; created_at: string }>(),
    // The products on the Xpel stock count sheet (migration 038).
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .not('sheet_order', 'is', null)
      .eq('is_active', true),
  ])
  const sheets = (sheetRows ?? []) as {
    id: string
    staff_name: string
    outlet_name: string
    count_date: string
    file_name: string
    content_type: string
    path: string
    created_at: string
  }[]

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

  // Shelf photos. The rows above are already narrowed to what this person
  // may see, so their photos are signed with the service role: supervisors
  // cannot read the reports bucket directly. Links last an hour.
  const photoUrls = new Map<string, string>()
  const paths = [
    ...new Set([
      ...rows.map((r) => r.photo_path).filter((p): p is string => Boolean(p)),
      ...sheets.map((s) => s.path),
    ]),
  ]
  if (paths.length) {
    try {
      const { data } = await createAdminSupabase()
        .storage.from('reports')
        .createSignedUrls(paths.slice(0, 500), 3600)
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) photoUrls.set(item.path, item.signedUrl)
      }
    } catch {
      // Without the service key the table still shows, just without photos.
    }
  }
  const title = from === to ? `Store counts, ${longDate(from)}` : `Store counts, ${longDate(from)} to ${longDate(to)}`
  const spec = { kind: 'store_counts' as const, from, to, name: null, title, summary: '' }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store counts</h1>
        <p className="text-sm text-muted-foreground">
          Merchandisers count every product on the Xpel stock count sheet: how many are in the
          back store and on the shop floor, the expiry date, and how many sold since their last
          count. They count when a supervisor asks, and at the end of every month.
        </p>
      </div>

      <CountTemplateCard
        month={countMonth(today)}
        products={sheetCount ?? 0}
        current={template ?? null}
        canUpload={isAdmin}
      />

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
                  <TableHead className="text-right">In store (latest count)</TableHead>
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

      {sheets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Count sheets ({sheets.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Counts done on paper and sent as a file. Their figures are not in the totals above;
              open the sheet to read them.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Sheet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet) => (
                  <TableRow key={sheet.id}>
                    <TableCell className="whitespace-nowrap">{sheet.count_date}</TableCell>
                    <TableCell>{sheet.staff_name}</TableCell>
                    <TableCell>{sheet.outlet_name}</TableCell>
                    <TableCell className="text-xs">
                      {photoUrls.get(sheet.path) ? (
                        <a
                          href={photoUrls.get(sheet.path)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-brand underline-offset-2 hover:underline"
                        >
                          Open {sheet.content_type === 'application/pdf' ? 'PDF' : 'photo'}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Link unavailable</span>
                      )}
                      <span className="ml-2 text-muted-foreground">{sheet.file_name}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                  <TableHead className="text-right">Back store</TableHead>
                  <TableHead className="text-right">Shop floor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead>Taken</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.store}</TableCell>
                    <TableCell>
                      {r.product}
                      {r.barcode && (
                        <span className="block font-mono text-[11px] text-muted-foreground">{r.barcode}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.back_store ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.shop_floor ?? '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{r.in_store}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.expiry_date ? shortDate(r.expiry_date) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.sold}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.distance_m === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span>{metres(r.distance_m)} from store</span>
                      )}
                      {r.photo_path && photoUrls.get(r.photo_path) && (
                        <a
                          href={photoUrls.get(r.photo_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 font-semibold text-brand underline-offset-2 hover:underline"
                        >
                          Shelf photo
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
