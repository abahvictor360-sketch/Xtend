import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { OutletManager } from '@/components/admin/outlet-manager'
import { MapPinOff, Store, Upload, UserX, Users } from 'lucide-react'
import { PageHeader, StatCard, StatGrid } from '@/components/admin/page-kit'
import type { Outlet } from '@/lib/types'
import type { StoreStaffPerson } from '@/components/admin/store-staff'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Outlets — Xtend' }

export default async function OutletsPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'
  const supabase = await createServerSupabase()

  const [{ data: outlets }, { data: counts }, { data: staff }] = await Promise.all([
    supabase
      .from('outlets')
      .select('id, name, address, lat, lng, geofence_radius_m, shift_start, shift_end, is_active, created_at')
      .order('name'),
    supabase.from('profiles').select('outlet_id').eq('is_active', true),
    // Who can be allocated from a store: everyone for an admin, their own
    // team for a supervisor (RLS on profiles narrows the view).
    supabase.from('staff_allocation').select('*').order('staff_name'),
  ])

  const staffPerOutlet = new Map<string, number>()
  for (const row of (counts ?? []) as { outlet_id: string | null }[]) {
    if (row.outlet_id) staffPerOutlet.set(row.outlet_id, (staffPerOutlet.get(row.outlet_id) ?? 0) + 1)
  }
  // Staff on each card also counts people allocated there besides their home store.
  const people = (staff ?? []) as StoreStaffPerson[]
  for (const p of people) {
    if (!p.is_active) continue
    for (const id of p.outlet_ids ?? []) {
      if (id !== p.home_outlet_id) staffPerOutlet.set(id, (staffPerOutlet.get(id) ?? 0) + 1)
    }
  }

  const list = (outlets ?? []) as Outlet[]
  const active = list.filter((o) => o.is_active)
  const unpinned = active.filter((o) => o.lat === null)
  const placed = ((counts ?? []) as { outlet_id: string | null }[]).filter((r) => r.outlet_id).length
  const empty = active.filter((o) => !staffPerOutlet.get(o.id)).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outlets"
        note={
          readOnly
            ? 'The stores field staff work in. Only an admin can add or change a store; use Allocate staff to put your team at a store.'
            : 'Every store, its area and its shift. The area is per store: a mall kiosk is not a standalone store. Allocate staff under a store to put people there.'
        }
        actions={
          !readOnly && (
            <Link href="/admin/outlets/import" className={buttonVariants({ variant: 'outline', className: 'h-11' })}>
              <Upload className="h-4 w-4" /> Add stores in bulk
            </Link>
          )
        }
      />

      <StatGrid>
        <StatCard icon={Store} label="Stores" value={String(list.length)} note={`${active.length} active`} bar={list.length ? (active.length / list.length) * 100 : null} />
        <StatCard
          icon={MapPinOff}
          label="No location yet"
          value={String(unpinned.length)}
          tone={unpinned.length ? 'warn' : 'muted'}
          note={unpinned.length ? 'Pinned from the first clock-in' : 'Every active store is pinned'}
          href={!readOnly && unpinned.length ? '/admin/places' : undefined}
        />
        <StatCard icon={Users} label="Staff placed" value={String(placed)} tone="good" note="Active staff with a store" />
        <StatCard
          icon={UserX}
          label="Stores with nobody"
          value={String(empty)}
          tone={empty ? 'bad' : 'muted'}
          note={empty ? 'Active, with no staff' : 'Every active store is staffed'}
          href={empty ? '/admin/assignments' : undefined}
        />
      </StatGrid>

      <OutletManager
        outlets={list}
        staffCounts={Object.fromEntries(staffPerOutlet)}
        readOnly={readOnly}
        staff={people}
        canAllocate
      />
    </div>
  )
}
