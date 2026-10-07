import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NoteAction, XmHeader } from '@/components/admin/xm/widgets'
import { longDate } from '@/lib/utils'
import { windowLabel } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Expiry alerts — X Metrics' }

interface Row {
  id: string
  outlet_name: string
  product_name: string
  sku: string | null
  batch: string
  expiry_date: string
  window_days: number
  days_left: number
  units_on_hand: number
  daily_velocity: number
  days_to_sell: number | null
  consider_pulling: boolean
  created_at: string
  acknowledged_at: string | null
  acknowledged_by_name: string | null
  note: string | null
}

export default async function ExpiryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role !== 'admin'
  const { show } = await searchParams
  const handled = show === 'handled'
  const supabase = await createServerSupabase()

  let q = supabase.from('xm_expiry_alert_detail').select('*').limit(500)
  q = handled
    ? q.not('acknowledged_at', 'is', null).order('acknowledged_at', { ascending: false })
    : q.is('acknowledged_at', null).order('days_left')
  const { data } = await q
  const rows = (data ?? []) as Row[]

  return (
    <div className="space-y-5">
      <XmHeader
        title="Expiry alerts"
        intro="Each batch is alerted as it enters a window (by default 2 years, 1 year, 6 months, 3 months and 1 month before expiry) and again once expired. Consider pulling means it will not sell before it expires at the current rate of sale."
        readOnly={readOnly}
      />
      <div className="flex gap-2 text-xs font-semibold">
        <a href="?show=open" className={!handled ? 'text-brand' : 'text-muted-foreground hover:underline'}>Open</a>
        <span className="text-muted-foreground">·</span>
        <a href="?show=handled" className={handled ? 'text-brand' : 'text-muted-foreground hover:underline'}>Handled</a>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{handled ? 'Nothing handled yet.' : 'No open expiry alerts.'}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Sells / day</TableHead>
                  <TableHead className="text-right">Days to sell</TableHead>
                  <TableHead>{handled ? 'Handled' : ''}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-semibold">{r.product_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[r.sku, r.batch && `batch ${r.batch}`].filter(Boolean).join(' · ')}
                      </span>
                    </TableCell>
                    <TableCell>{r.outlet_name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {longDate(r.expiry_date)}
                      <span className="mt-1 flex gap-1">
                        <Badge variant={r.window_days <= 30 ? 'destructive' : r.window_days <= 180 ? 'warning' : 'default'}>
                          {r.window_days === 0 ? 'Expired' : `Within ${windowLabel(r.window_days)}`}
                        </Badge>
                        {r.consider_pulling && <Badge variant="destructive">Consider pulling</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{r.units_on_hand}</TableCell>
                    <TableCell className="text-right">{Number(r.daily_velocity).toFixed(1)}</TableCell>
                    <TableCell className="text-right">{r.days_to_sell ?? 'No sales'}</TableCell>
                    <TableCell>
                      {handled ? (
                        <span className="text-xs">
                          {r.acknowledged_by_name} · {longDate(r.acknowledged_at!.slice(0, 10))}
                          {r.note && <span className="block text-muted-foreground">{r.note}</span>}
                        </span>
                      ) : (
                        !readOnly && (
                          <NoteAction
                            url={`/api/admin/metrics/expiry/${r.id}`}
                            label="Mark handled"
                            field="note"
                            placeholder="What was decided (optional)"
                          />
                        )
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
