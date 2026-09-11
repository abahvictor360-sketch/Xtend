import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { StaffManager } from '@/components/admin/staff-manager'
import type { Outlet, Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Staff — Xtend' }

export default async function UsersPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const supabase = await createServerSupabase()

  // my_staff() is the whole list for an admin and the supervisor's own
  // team for a supervisor, decided in Postgres rather than here.
  const [{ data: staff }, { data: outlets }, { data: supervisors }] = await Promise.all([
    supabase.rpc('my_staff'),
    supabase.from('outlets').select('*').order('name'),
    // Empty for a supervisor: only an admin assigns a reporting line.
    supabase.rpc('available_supervisors'),
  ])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'Accounts are created here. Deactivation is a soft delete: attendance history is never destroyed.'
              : 'Your team. People you add here report to you, and you can reset a password or deactivate an account.'}
          </p>
        </div>
        {isAdmin && (
          <Link href="/admin/users/import" className={buttonVariants({ variant: 'outline' })}>
            Bulk import CSV
          </Link>
        )}
      </div>

      <StaffManager
        staff={(staff ?? []) as Profile[]}
        outlets={(outlets ?? []) as Outlet[]}
        isAdmin={isAdmin}
        supervisors={(supervisors ?? []) as { id: string; full_name: string; role: string }[]}
      />
    </div>
  )
}
