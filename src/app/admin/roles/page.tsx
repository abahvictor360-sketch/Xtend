import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { RoleManager } from '@/components/admin/role-manager'
import type { BuiltInCounts, StaffRole } from '@/lib/staff-roles'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Roles — Xtend' }

/** Roles an admin adds on top of the built-in ones (migration 042). */
export default async function RolesPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const [{ data: roles }, { data: people }, { data: builtIn }] = await Promise.all([
    supabase.from('staff_roles').select('id, name, base_role, is_active, counts_stock').order('name'),
    supabase.from('profiles').select('staff_role_id').not('staff_role_id', 'is', null).eq('is_active', true),
    supabase.from('role_store_counts').select('role, counts_stock'),
  ])
  const builtInCounts: BuiltInCounts = {}
  for (const b of (builtIn ?? []) as { role: 'merchandiser' | 'marketer'; counts_stock: boolean }[]) {
    builtInCounts[b.role] = b.counts_stock
  }
  const counts: Record<string, number> = {}
  for (const p of (people ?? []) as { staff_role_id: string }[]) {
    counts[p.staff_role_id] = (counts[p.staff_role_id] ?? 0) + 1
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Add a role with its own name, such as Account Receivable or Promoter, and choose what it
          works like. People with it can do what that role does, and show by the new name on Staff,
          Teams and the login details. Give someone a role on the Staff page.
        </p>
      </div>
      <RoleManager roles={(roles ?? []) as StaffRole[]} counts={counts} builtInCounts={builtInCounts} />
    </div>
  )
}
