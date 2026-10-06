import Link from 'next/link'
import { Bell, KeyRound, MessageSquareText, Search, Sparkles, UserPlus } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav, AdminSidebarNav } from '@/components/admin/admin-nav'
import { XpelMark } from '@/components/brand/logo'
import { AssistantLauncher } from '@/components/admin/assistant-launcher'
import { NativeBridge } from '@/components/native-bridge'

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="brand-surface flex h-9 w-9 items-center justify-center rounded-xl">
        <XpelMark className="h-4 w-4" tone="light" />
      </span>
      <span className="text-xl font-extrabold tracking-tight">Xtend</span>
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

/** A square white button in the top bar, as in the reference. */
const squareButton =
  'relative flex h-11 w-11 items-center justify-center rounded-xl border border-border/80 bg-card transition-colors hover:bg-tint'

/** The dashboard's frame: menu, top bar and workspace around a page. */
export function AdminFrame({
  name,
  role,
  readOnly,
  openAlerts,
  assistant,
  children,
}: {
  name: string
  role: string
  readOnly: boolean
  openAlerts: number | null
  assistant: boolean
  children: React.ReactNode
}) {
  const bell = (
    <Link
      href="/admin/alerts"
      aria-label={`Alerts${openAlerts ? `, ${openAlerts} open` : ''}`}
      className={squareButton}
    >
      <Bell className="h-[18px] w-[18px]" />
      {Boolean(openAlerts) && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
          {openAlerts! > 99 ? '99+' : openAlerts}
        </span>
      )}
    </Link>
  )

  return (
    <div className="admin-shell min-h-dvh bg-canvas lg:bg-[hsl(30_5%_88%)] lg:p-5">
      {/* Desktop: one white frame holding the menu and a grey workspace. */}
      <div className="lg:flex lg:min-h-[calc(100dvh-2.5rem)] lg:overflow-clip lg:rounded-[2rem] lg:bg-card lg:shadow-[0_30px_60px_-40px_rgb(24_18_14/0.45)]">
        <aside className="sticky top-5 hidden h-[calc(100dvh-2.5rem)] w-64 shrink-0 flex-col bg-card lg:flex">
          <div className="px-6 pb-6 pt-7">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <AdminSidebarNav readOnly={readOnly} />
          </div>

          {/* Hidden on short screens, where the menu needs the room. */}
          <div className="px-4 pb-3 [@media(max-height:1150px)]:hidden">
            <div className="space-y-2 rounded-2xl border border-border/80 bg-card p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background">
                {assistant ? <Sparkles className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              </span>
              {assistant ? (
                <>
                  <p className="pt-1 text-base font-bold leading-tight">Ask Xtend</p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Who clocked in late? Who is off site? Ask in plain words.
                  </p>
                  <Link
                    href="/admin/ask"
                    className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2.5 text-xs font-bold text-background transition-opacity hover:opacity-90"
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Ask a question
                  </Link>
                </>
              ) : (
                <>
                  <p className="pt-1 text-base font-bold leading-tight">Your account</p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Keep your password private. Change it any time.
                  </p>
                  <Link
                    href="/change-password"
                    className="mt-1 flex items-center justify-center rounded-xl bg-foreground px-3 py-2.5 text-xs font-bold text-background transition-opacity hover:opacity-90"
                  >
                    Change password
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="px-4 pb-5">
            <SignOutButton className="h-10 w-full justify-start px-3 text-sm" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 lg:my-2 lg:mr-2 lg:rounded-[1.6rem] lg:bg-canvas">
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

          {/* Desktop: search on the left; alerts, who is signed in and a quick action on the right. */}
          <div className="hidden items-center justify-between gap-4 px-6 pb-1 pt-5 lg:flex">
            <form action="/admin/users" className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                type="search"
                placeholder="Find staff by name, email or phone"
                aria-label="Find staff"
                className="h-11 w-full rounded-xl border border-border/80 bg-card pl-11 pr-4 text-sm placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
              />
            </form>
            <div className="flex items-center gap-2.5">
              {bell}
              <div className="flex h-11 items-center gap-2.5 rounded-xl border border-border/80 bg-card pl-1.5 pr-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-xs font-bold text-tint-foreground">
                  {initials(name)}
                </span>
                <span className="leading-tight">
                  <span className="block max-w-[11rem] truncate text-sm font-semibold">{name}</span>
                  <span className="block text-xs text-muted-foreground">{role}</span>
                </span>
              </div>
              <Link
                href="/admin/users?new=1"
                className="flex h-11 items-center gap-2 rounded-xl border border-border/80 bg-card px-4 text-sm font-semibold transition-colors hover:bg-tint"
              >
                <UserPlus className="h-4 w-4" />
                Add staff
              </Link>
            </div>
          </div>

          <main className="mx-auto w-full max-w-[1500px] px-4 py-6 pb-24 lg:px-6 lg:pt-4">{children}</main>
        </div>
      </div>

      {assistant && <AssistantLauncher />}
      <NativeBridge />
    </div>
  )
}
