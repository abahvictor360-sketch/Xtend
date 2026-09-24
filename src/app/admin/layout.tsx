import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav } from '@/components/admin/admin-nav'
import { XpelMark } from '@/components/brand/logo'
import { AssistantLauncher } from '@/components/admin/assistant-launcher'
import { assistantConfigured } from '@/lib/assistant'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-card shadow-soft">
              <XpelMark className="h-5 w-5" />
            </span>
            <span className="text-lg font-extrabold tracking-tight">Xtend</span>
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

      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24">{children}</main>

      {assistantConfigured() && <AssistantLauncher />}
    </div>
  )
}
