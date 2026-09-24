import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { StoreCountForm, type CountLine, type CountProduct } from '@/components/field/store-count-form'
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

  const [{ data: outlets }, { data: products }, { data: counted }] = await Promise.all([
    supabase.rpc('my_outlets'),
    supabase.from('products').select('id, name, sku').eq('is_active', true).order('name'),
    supabase
      .from('store_counts')
      .select('outlet_id, product_id, in_store, sold')
      .eq('user_id', session.userId)
      .eq('count_date', businessDate),
  ])

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
        products={(products ?? []) as CountProduct[]}
        counted={(counted ?? []) as CountLine[]}
      />
    </SheetScreen>
  )
}
