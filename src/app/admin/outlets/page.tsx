import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { OutletManager } from '@/components/admin/outlet-manager'
import type { Outlet } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Outlets — Xtend' }

export default async function OutletsPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()

  const { data: outlets } = await supabase.from('outlets').select('*').order('name')
  const { data: counts } = await supabase.from('profiles').select('outlet_id').eq('is_active', true)

  const staffPerOutlet = new Map<string, number>()
  for (const row of (counts ?? []) as { outlet_id: string | null }[]) {
    if (row.outlet_id) staffPerOutlet.set(row.outlet_id, (staffPerOutlet.get(row.outlet_id) ?? 0) + 1)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Outlets</h1>
        <p className="text-sm text-muted-foreground">
          The geofence radius is per outlet: a mall kiosk is not a standalone store.
        </p>
      </div>

      <OutletManager
        outlets={(outlets ?? []) as Outlet[]}
        staffCounts={Object.fromEntries(staffPerOutlet)}
      />
    </div>
  )
}
