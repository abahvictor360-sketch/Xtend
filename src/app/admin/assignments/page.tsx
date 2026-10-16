import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import {
  OutletAllocator,
  type Allocation,
  type AllocatableOutlet,
  type AllocationTeam,
} from '@/components/admin/outlet-allocator'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store allocation — Xtend' }

export default async function AssignmentsPage() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  // RLS narrows both lists: a supervisor sees their own team, an admin
  // everyone. Nothing here has to know which of the two is reading.
  const [{ data: allocations }, { data: outlets }, { data: staff }, { data: supervisors }] =
    await Promise.all([
      supabase.from('staff_allocation').select('*').order('staff_name'),
      supabase.from('outlets').select('id, name, address').eq('is_active', true).order('name'),
      // Who each person reports to, to group them by team.
      supabase.rpc('my_staff'),
      // Empty for a supervisor, who only ever sees their own team.
      supabase.rpc('available_supervisors'),
    ])

  const teamOf = new Map(
    ((staff ?? []) as Profile[]).map((p) => [p.id, p.supervisor_id ?? null] as const),
  )
  const people = ((allocations ?? []) as Omit<Allocation, 'supervisor_id'>[]).map((a) => ({
    ...a,
    supervisor_id: teamOf.get(a.user_id) ?? null,
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store allocation</h1>
        <p className="text-sm text-muted-foreground">
          Choose which stores each person works. A marketer with stores here can only check in at
          those (and their home store), and the app lists only those; with none, they check in
          wherever they are. A merchandiser is measured against their store.
          Allocating also puts someone on a supervisor&rsquo;s team.
        </p>
      </div>

      <OutletAllocator
        allocations={people}
        teams={((supervisors ?? []) as { id: string; full_name: string }[]).map((s) => ({
          id: s.id,
          name: s.full_name,
        })) as AllocationTeam[]}
        outlets={(outlets ?? []) as AllocatableOutlet[]}
      />
    </div>
  )
}
