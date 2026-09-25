import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav, AdminSidebarNav } from '@/components/admin/admin-nav'
import { XpelMark } from '@/components/brand/logo'
import { AssistantLauncher } from '@/components/admin/assistant-launcher'
import { assistantConfigured } from '@/lib/assistant'

export const dynamic = 'force-dynamic'

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-card shadow-soft">
        <XpelMark className="h-5 w-5" />
      </span>
      <span className="text-lg font-extrabold tracking-tight">Xtend</span>
    </Link>
  )
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'
  const who = `${session.profile.full_name} · ${readOnly ? 'supervisor' : 'admin'}`

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop: the menu down the left, always in view. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-background lg:flex">
        <div className="px-5 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <AdminSidebarNav readOnly={readOnly} />
        </div>
        <div className="space-y-2 border-t border-border px-4 py-3">
          <p className="truncate text-xs text-muted-foreground" title={who}>
            {who}
          </p>
          <SignOutButton className="h-9 w-full px-3 text-xs" />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone and tablet: a top bar with the menu as a drop-down. */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <Brand />
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">{who}</span>
              <SignOutButton className="h-9 px-3 text-xs" />
            </div>
          </div>
          <AdminNav readOnly={readOnly} />
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 lg:px-8">{children}</main>
      </div>

      {assistantConfigured() && <AssistantLauncher />}
    </div>
  )
}
