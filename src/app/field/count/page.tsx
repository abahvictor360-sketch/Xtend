import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { StoreCountForm, type CountLine, type CountProduct } from '@/components/field/store-count-form'
import { longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store count — Xtend' }

export default async function StoreCountPage() {
  const session = await requireSession()
  const supabase = await createServerSupabase()

  const { data: allowed } = await supabase.rpc('can_count_stock')
  if (allowed !== true) redirect('/field')

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
      title="Store count"
      back="/field"
      header={
        <>
          <HeaderField label="Counted by" value={session.profile.full_name} />
          <HeaderField label="Date" value={businessDate ? longDate(businessDate) : 'Today'} />
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
