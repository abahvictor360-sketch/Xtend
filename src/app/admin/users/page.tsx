import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { StaffManager } from '@/components/admin/staff-manager'
import type { Outlet, Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Staff — Xtend' }

export default async function UsersPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()

  const [{ data: staff }, { data: outlets }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, outlet_id, is_active, must_change_password, created_at, updated_at, avatar_path')
      .order('full_name'),
    supabase.from('outlets').select('*').order('name'),
  ])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Accounts are created here. Deactivation is a soft delete: attendance history is never
            destroyed.
          </p>
        </div>
        <Link href="/admin/users/import" className={buttonVariants({ variant: 'outline' })}>
          Bulk import CSV
        </Link>
      </div>

      <StaffManager staff={(staff ?? []) as Profile[]} outlets={(outlets ?? []) as Outlet[]} />
    </div>
  )
}
