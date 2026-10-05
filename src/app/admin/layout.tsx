import Link from 'next/link'
import { Bell, MessageSquareText } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav, AdminSidebarNav } from '@/components/admin/admin-nav'
import { XpelMark } from '@/components/brand/logo'
import { AssistantLauncher } from '@/components/admin/assistant-launcher'
import { assistantConfigured } from '@/lib/assistant'
import { NativeBridge } from '@/components/native-bridge'
import { TZ } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="brand-surface flex h-10 w-10 items-center justify-center rounded-2xl">
        <XpelMark className="h-5 w-5" tone="light" />
      </span>
      <span className="text-lg font-extrabold tracking-tight">Xtend</span>
    </Link>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()),
  )
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'
  const name = session.profile.full_name
  const role = readOnly ? 'Supervisor' : 'Admin'
  const assistant = assistantConfigured()

  // Open alerts, for the bell. RLS narrows it to a supervisor's own team.
  const supabase = await createServerSupabase()
  const { count: openAlerts } = await supabase
    .from('location_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('is_resolved', false)

  const today = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const bell = (
    <Link
      href="/admin/alerts"
      aria-label={`Alerts${openAlerts ? `, ${openAlerts} open` : ''}`}
      className="relative flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft transition-colors hover:bg-tint"
    >
      <Bell className="h-4 w-4" />
      {Boolean(openAlerts) && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
          {openAlerts! > 99 ? '99+' : openAlerts}
        </span>
      )}
    </Link>
  )

  return (
    <div className="min-h-dvh bg-canvas lg:flex lg:gap-5 lg:p-4">
      {/* Desktop: a floating panel down the left, always in view. */}
      <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-64 shrink-0 flex-col rounded-4xl bg-card shadow-soft lg:flex">
        <div className="px-6 pb-4 pt-6">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <AdminSidebarNav readOnly={readOnly} />
        </div>

        {assistant && (
          // Hidden on short screens, where the menu needs the room.
          <div className="px-4 pb-3 [@media(max-height:820px)]:hidden">
            <div className="brand-surface space-y-2 p-4">
              <MessageSquareText className="h-5 w-5 opacity-90" />
              <p className="font-bold leading-tight">Ask Xtend</p>
              <p className="text-xs leading-snug text-white/85">
                Who clocked in late? Who is off site? Ask in plain words.
              </p>
              <Link
                href="/admin/ask"
                className="block rounded-xl bg-white/95 px-3 py-2 text-center text-xs font-bold text-brand-deep transition-colors hover:bg-white"
              >
                Ask a question
              </Link>
            </div>
          </div>
        )}

        <div className="border-t border-border px-4 py-3">
          <SignOutButton className="h-9 w-full px-3 text-xs" />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phone and tablet: a top bar with the menu as a drop-down. */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Brand />
            <div className="flex items-center gap-2">
              {bell}
              <SignOutButton className="h-9 px-3 text-xs" />
            </div>
          </div>
          <AdminNav readOnly={readOnly} />
        </header>

        {/* Desktop: greeting and date on the left, alerts and who is signed in on the right. */}
        <div className="hidden items-center justify-between gap-4 px-4 pb-2 pt-3 lg:flex">
          <div>
            <p className="text-2xl font-extrabold tracking-tight">
              {greeting()}, {name.split(/\s+/)[0]}
            </p>
            <p className="text-sm text-muted-foreground">{today}</p>
          </div>
          <div className="flex items-center gap-3">
            {bell}
            <div className="flex items-center gap-2.5 rounded-full bg-card py-1.5 pl-1.5 pr-4 shadow-soft">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-xs font-bold text-tint-foreground">
                {initials(name)}
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-bold">{name}</span>
                <span className="block text-xs text-muted-foreground">{role}</span>
              </span>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 lg:pt-4">{children}</main>
      </div>

      {assistant && <AssistantLauncher />}
      <NativeBridge />
    </div>
  )
}
