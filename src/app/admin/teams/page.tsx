import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { TeamManager, type TeamMember, type TeamSupervisor } from '@/components/admin/team-manager'
import type { Profile } from '@/lib/types'
import { roleLabel, type StaffRole } from '@/lib/staff-roles'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Teams — Xtend' }

export default async function TeamsPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()

  const [{ data: staff }, { data: supervisors }, { data: outlets }, { data: roles }] = await Promise.all([
    supabase.rpc('my_staff'),
    supabase.rpc('available_supervisors'),
    supabase.from('outlets').select('id, name'),
    supabase.from('staff_roles').select('id, name, base_role, is_active'),
  ])
  const roleById = new Map(((roles ?? []) as StaffRole[]).map((r) => [r.id, r]))

  const outletName = new Map(((outlets ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
  const members: TeamMember[] = ((staff ?? []) as Profile[])
    .filter((p) => p.is_active && (p.role === 'merchandiser' || p.role === 'marketer'))
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      role: p.role as TeamMember['role'],
      role_label: roleLabel(p, roleById),
      store: p.outlet_id ? (outletName.get(p.outlet_id) ?? null) : null,
      supervisor_id: p.supervisor_id ?? null,
    }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Put merchandisers and marketers on a supervisor&apos;s team. A supervisor sees their
          team&apos;s attendance, reports and counts, and manages their accounts. Pick a category,
          tick several people (or select all shown) and move them at once.
        </p>
      </div>
      <TeamManager members={members} supervisors={(supervisors ?? []) as TeamSupervisor[]} />
    </div>
  )
}
