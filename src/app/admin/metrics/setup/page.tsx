import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { XmHeader } from '@/components/admin/xm/widgets'
import { ProductManager, StoreEnrolment } from '@/components/admin/xm/forms'
import type { XmProduct } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Products & stores — X Metrics' }

export default async function SetupPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const [{ data: products }, { data: outlets }, { data: enrolled }, { data: counted }] = await Promise.all([
    supabase.from('products').select('id, name, sku, category, unit, is_active').order('is_active', { ascending: false }).order('name').limit(2000),
    supabase.from('outlets').select('id, name').eq('is_active', true).order('name').limit(2000),
    supabase.from('xm_stores').select('outlet_id').eq('is_active', true),
    supabase.from('xm_counts').select('outlet_id').is('voided_at', null).limit(20000),
  ])
  const inXm = new Set(((enrolled ?? []) as { outlet_id: string }[]).map((s) => s.outlet_id))
  const hasCount = new Set(((counted ?? []) as { outlet_id: string }[]).map((c) => c.outlet_id))

  return (
    <div className="space-y-5">
      <XmHeader
        title="Products & stores"
        intro="The products counted and sold, and which of your existing stores are in X Metrics. Stores and staff allocations are the ones already in Xtend."
      />
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>Name, SKU, category and unit. A retired product stays on every record that has it.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductManager products={(products ?? []) as XmProduct[]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Stores</CardTitle>
        </CardHeader>
        <CardContent>
          <StoreEnrolment
            outlets={((outlets ?? []) as { id: string; name: string }[]).map((o) => ({
              ...o,
              enrolled: inXm.has(o.id),
              hasCount: hasCount.has(o.id),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
