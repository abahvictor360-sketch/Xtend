import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { StoreCountForm, type CountLine, type SheetProduct } from '@/components/field/store-count-form'
import { CountSheetPanel, type SentSheet } from '@/components/field/count-sheet-panel'
import { Alert } from '@/components/ui/alert'
import { getCountStatus } from '@/lib/store-count-status'
import { longDate } from '@/lib/utils'
import { countMonth } from '@/lib/count-sheet'

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

  // Today's figures, the Xpel count sheet's products (040), and every name
  // counted so far, for suggestions when adding one not on the sheet.
  const [{ data: outlets }, { data: mine }, { data: sheetProducts }, { data: names }, { data: sheets }, { count: templates }] =
    await Promise.all([
      supabase.rpc('my_outlets'),
      supabase
        .from('store_count_detail')
        .select('outlet_id, product_name, back_store, shop_floor, in_store, sold, expiry_date')
        .eq('user_id', session.userId)
        .eq('count_date', businessDate)
        .order('product_name')
        .limit(1000),
      supabase
        .from('products')
        .select('name, barcode')
        .not('sheet_order', 'is', null)
        .eq('is_active', true)
        .order('sheet_order'),
      supabase.rpc('counted_product_names'),
      // Paper count sheets sent today (migration 035).
      supabase
        .from('store_count_sheet_detail')
        .select('id, outlet_name, file_name, created_at')
        .eq('user_id', session.userId)
        .eq('count_date', businessDate)
        .order('created_at', { ascending: false }),
      // Whether an admin has uploaded their own blank count sheet.
      supabase.from('count_sheet_templates').select('id', { count: 'exact', head: true }),
    ])

  const todays: CountLine[] = (
    (mine ?? []) as {
      outlet_id: string
      product_name: string
      back_store: number | null
      shop_floor: number | null
      in_store: number
      sold: number
      expiry_date: string | null
    }[]
  ).map((r) => ({
    outlet_id: r.outlet_id,
    product: r.product_name,
    back_store: r.back_store,
    shop_floor: r.shop_floor,
    in_store: r.in_store,
    sold: r.sold,
    expiry_date: r.expiry_date,
  }))
  const products = (sheetProducts ?? []) as SheetProduct[]
  const onSheet = new Set(products.map((p) => p.name.toLowerCase()))

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
      <div className="space-y-4">
        <CountSheetPanel
          stores={stores}
          sent={(sheets ?? []) as SentSheet[]}
          hasTemplate={products.length > 0 || (templates ?? 0) > 0}
          month={countMonth(businessDate)}
        />
        <StoreCountForm
          stores={stores}
          products={products}
          today={todays}
          suggestions={((names ?? []) as { name: string }[])
            .map((n) => n.name)
            .filter((n) => !onSheet.has(n.toLowerCase()))}
        />
      </div>
    </SheetScreen>
  )
}
