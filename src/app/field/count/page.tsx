import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { StoreCountForm, type CountLine } from '@/components/field/store-count-form'
import { Alert } from '@/components/ui/alert'
import { getCountStatus } from '@/lib/store-count-status'
import { longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store count — Xtend' }

export default async function StoreCountPage() {
  const session = await requireSession()
  const supabase = await createServerSupabase()

  const status = await getCountStatus(supabase)
  if (status.reason === 'not_allowed') redirect('/field')

  if (!status.open) {
    return (
      <SheetScreen title="Store count" back="/field">
        <Alert variant="info">
          No store count is due. You count when your supervisor asks for one, and at the end of
          every month. The next month-end count opens on {longDate(status.next_month_end)}.
        </Alert>
      </SheetScreen>
    )
  }

  const { data: today } = await supabase.rpc('business_date')
  const businessDate = (today as string) ?? ''

  // Today's figures, the products from their last count at each store, and
  // every name counted so far, for suggestions while typing.
  const [{ data: outlets }, { data: mine }, { data: names }] = await Promise.all([
    supabase.rpc('my_outlets'),
    supabase
      .from('store_count_detail')
      .select('outlet_id, product_name, in_store, sold, count_date')
      .eq('user_id', session.userId)
      .order('count_date', { ascending: false })
      .order('product_name')
      .limit(1000),
    supabase.rpc('counted_product_names'),
  ])

  const rows = (mine ?? []) as {
    outlet_id: string
    product_name: string
    in_store: number
    sold: number
    count_date: string
  }[]
  const todays: CountLine[] = rows
    .filter((r) => r.count_date === businessDate)
    .map((r) => ({ outlet_id: r.outlet_id, product: r.product_name, in_store: r.in_store, sold: r.sold }))
  const previous: Record<string, string[]> = {}
  const lastDate: Record<string, string> = {}
  for (const r of rows) {
    if (r.count_date === businessDate) continue
    // Rows come newest first: the first date seen per store is its last count.
    lastDate[r.outlet_id] ??= r.count_date
    if (r.count_date === lastDate[r.outlet_id]) {
      ;(previous[r.outlet_id] ??= []).push(r.product_name)
    }
  }

  const stores = ((outlets ?? []) as { id: string; name: string }[]).map((o) => ({
    id: o.id,
    name: o.name,
  }))

  return (
    <SheetScreen
      title={status.reason === 'request' ? 'Requested store count' : 'Month-end store count'}
      back="/field"
      header={
        <>
          {status.reason === 'request' && (
            <HeaderField label="Asked by" value={status.requested_by} />
          )}
          <HeaderField label="Due" value={longDate(status.due_date)} />
          {status.reason === 'request' && status.note && (
            <HeaderField label="Note" value={status.note} />
          )}
        </>
      }
    >
      <StoreCountForm
        stores={stores}
        today={todays}
        previous={previous}
        suggestions={((names ?? []) as { name: string }[]).map((n) => n.name)}
      />
    </SheetScreen>
  )
}
