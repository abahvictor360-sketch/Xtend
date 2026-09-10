import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { OutletAllocator, type Allocation, type AllocatableOutlet } from '@/components/admin/outlet-allocator'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store allocation — Xtend' }

export default async function AssignmentsPage() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  // RLS narrows both lists: a supervisor sees their own team, an admin
  // everyone. Nothing here has to know which of the two is reading.
  const [{ data: allocations }, { data: outlets }] = await Promise.all([
    supabase.from('staff_allocation').select('*').order('staff_name'),
    supabase.from('outlets').select('id, name, address').eq('is_active', true).order('name'),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store allocation</h1>
        <p className="text-sm text-muted-foreground">
          Give a marketer or merchandiser the stores they are responsible for. Allocated stores
          are the ones they can check into, and the daily clock measures against whichever of
          them they are nearest.
        </p>
      </div>

      <OutletAllocator
        allocations={(allocations ?? []) as Allocation[]}
        outlets={(outlets ?? []) as AllocatableOutlet[]}
      />
    </div>
  )
}
