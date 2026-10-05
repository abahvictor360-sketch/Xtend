import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { OutletManager } from '@/components/admin/outlet-manager'
import type { Outlet } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Outlets — Xtend' }

export default async function OutletsPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'
  const supabase = await createServerSupabase()

  const { data: outlets } = await supabase.from('outlets').select('*').order('name')
  const { data: counts } = await supabase.from('profiles').select('outlet_id').eq('is_active', true)

  const staffPerOutlet = new Map<string, number>()
  for (const row of (counts ?? []) as { outlet_id: string | null }[]) {
    if (row.outlet_id) staffPerOutlet.set(row.outlet_id, (staffPerOutlet.get(row.outlet_id) ?? 0) + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Outlets</h1>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? 'The stores field staff work in. Only an admin can add or change them.'
              : 'The geofence radius is per outlet: a mall kiosk is not a standalone store.'}
          </p>
        </div>
        {!readOnly && (
          <Link href="/admin/outlets/import" className={buttonVariants({ variant: 'outline' })}>
            Add stores in bulk
          </Link>
        )}
      </div>

      <OutletManager
        outlets={(outlets ?? []) as Outlet[]}
        staffCounts={Object.fromEntries(staffPerOutlet)}
        readOnly={readOnly}
      />
    </div>
  )
}
