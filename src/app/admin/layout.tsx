import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav } from '@/components/admin/admin-nav'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              X
            </span>
            <span className="font-semibold">Xtend</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.profile.full_name} · {readOnly ? 'supervisor (read only)' : 'admin'}
            </span>
            <SignOutButton className="h-9 px-3 text-xs" />
          </div>
        </div>
        <AdminNav readOnly={readOnly} />
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
    </div>
  )
}
