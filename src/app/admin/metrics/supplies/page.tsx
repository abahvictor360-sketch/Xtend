import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExportLinks, MonthPicker, VoidButton, XmHeader } from '@/components/admin/xm/widgets'
import { SupplyForm } from '@/components/admin/xm/forms'
import { lagosDateString, longDate } from '@/lib/utils'
import { monthLabel, monthStart, type XmProduct } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Supplies — X Metrics' }

interface Supply {
  id: string
  supplied_on: string
  outlet_name: string
  product_name: string
  quantity: number
  batch: string
  expiry_date: string | null
  note: string | null
  logged_by_name: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
  voided_by_name: string | null
}

export default async function SuppliesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireSession(['admin'])
  const month = monthStart((await searchParams).month)
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const supabase = await createServerSupabase()

  const [{ data: stores }, { data: products }, { data: supplies }] = await Promise.all([
    supabase.from('xm_stores').select('outlet_id, outlets(name)').eq('is_active', true),
    supabase.from('products').select('id, name, sku, category, unit, is_active').eq('is_active', true).order('name'),
    supabase.from('xm_supply_detail').select('*').gte('supplied_on', month).lte('supplied_on', end).order('supplied_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
  ])
  const storeOptions = ((stores ?? []) as unknown as { outlet_id: string; outlets: { name: string } | { name: string }[] | null }[])
    .map((s) => ({ id: s.outlet_id, name: (Array.isArray(s.outlets) ? s.outlets[0]?.name : s.outlets?.name) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const rows = (supplies ?? []) as Supply[]

  return (
    <div className="space-y-5">
      <XmHeader
        title="Supplies"
        intro="Every delivery to a store, by batch. Reconciliation adds them to the last count. A mistake is voided with a reason, never edited or deleted."
      />
      <Card>
        <CardHeader>
          <CardTitle>Log a supply</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplyForm stores={storeOptions} products={(products ?? []) as XmProduct[]} today={lagosDateString()} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} />
        <ExportLinks kind="supplies" month={month} />
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No supplies logged in {monthLabel(month)}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplied</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Logged</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.voided_at ? 'opacity-60' : undefined}>
                    <TableCell className="whitespace-nowrap">{longDate(r.supplied_on)}</TableCell>
                    <TableCell>{r.outlet_name}</TableCell>
                    <TableCell>
                      {r.product_name}
                      {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                    </TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell>{r.batch || '—'}</TableCell>
                    <TableCell>{r.expiry_date ? longDate(r.expiry_date) : '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.logged_by_name}
                      <span className="block text-muted-foreground">{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</span>
                    </TableCell>
                    <TableCell>
                      {r.voided_at ? (
                        <span className="text-xs">
                          <Badge variant="outline">Voided</Badge>
                          <span className="block text-muted-foreground">{r.voided_by_name}: {r.void_reason}</span>
                        </span>
                      ) : (
                        <VoidButton kind="supply" id={r.id} />
                      )}
                    </TableCell>
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
