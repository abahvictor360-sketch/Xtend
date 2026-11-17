import Link from 'next/link'
import { Bell, ChevronsUpDown, Fingerprint, FlaskConical, KeyRound, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'
import { AdminNav, AdminSidebarNav, type NavBadges } from '@/components/admin/admin-nav'
import { XpelMark } from '@/components/brand/logo'
import { AssistantLauncher } from '@/components/admin/assistant-launcher'
import { NativeBridge } from '@/components/native-bridge'
import { RoleSwitch } from '@/components/role-switch'

function Brand() {
  return (
    <Link href="/admin" className="flex shrink-0 items-center gap-2.5">
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

const accountLink =
  'flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium leading-snug text-foreground/80 hover:bg-muted hover:text-foreground'

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
  xmEnabled = true,
  testMode = false,
  isAdmin = false,
  hr = false,
  badges = {},
  children,
}: {
  name: string
  role: string
  readOnly: boolean
  openAlerts: number | null
  assistant: boolean
  /** X Metrics switched on (0063). */
  xmEnabled?: boolean
  /** Test mode is on (0066): admins see a banner across the top. */
  testMode?: boolean
  /** Only an admin gets the "view as" role switch. */
  isAdmin?: boolean
  /** HR (0072): a shorter menu, people only. */
  hr?: boolean
  /** Counts beside menu links: open location alerts, flags to review. */
  badges?: NavBadges
  children: React.ReactNode
}) {
  const bell = hr ? null : (
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
    <div className="admin-shell min-h-dvh bg-canvas">
      <a href="#dashboard-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-card focus:p-4">Skip to dashboard content</a>
      {/* Desktop: the menu down the left, edge to edge, beside a grey workspace. */}
      <div className="lg:flex lg:min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
          <div className="px-5 pb-4 pt-6">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <AdminSidebarNav readOnly={readOnly} xmEnabled={xmEnabled} hr={hr} badges={badges} />
          </div>

          <div className="space-y-3 border-t border-border p-3">
            {isAdmin && (
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">View as</p>
                <RoleSwitch current="admin" />
              </div>
            )}
            {/* Who is signed in, and their account: one card that opens upwards. */}
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-tint-foreground">
                  {initials(name)}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-semibold">{name}</span>
                  <span className="block text-xs text-muted-foreground">{role}</span>
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </summary>
              <div className="absolute bottom-full left-0 right-0 z-30 mb-2 space-y-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-lg">
                <Link href="/mfa/setup" className={accountLink}>
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Two-step sign-in
                </Link>
                <Link href="/admin/sign-in-methods" className={accountLink}>
                  <Fingerprint className="h-4 w-4 text-muted-foreground" /> Fingerprint and passkeys
                </Link>
                <Link href="/change-password" className={accountLink}>
                  <KeyRound className="h-4 w-4 text-muted-foreground" /> Change password
                </Link>
                <SignOutButton className="mt-1 h-10 w-full justify-start px-3 text-sm" />
              </div>
            </details>
          </div>
        </aside>

        <div className="min-w-0 flex-1 bg-canvas">
          {testMode && (
            <Link
              href="/admin/system"
              className="flex items-center justify-center gap-2 bg-brand-deep px-4 py-2 text-center text-xs font-bold text-white hover:bg-[#52281a] sm:text-sm"
            >
              <FlaskConical className="h-4 w-4 shrink-0" />
              Test mode: records can be reset
            </Link>
          )}
          {/* Phone and tablet: a top bar with the menu as a drop-down. */}
          <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <Brand />
              <div className="flex items-center gap-2">
                {bell}
                <SignOutButton className="h-11 px-3 text-xs" />
              </div>
            </div>
            <AdminNav readOnly={readOnly} xmEnabled={xmEnabled} hr={hr} badges={badges} />
            {isAdmin && (
              <div className="px-4 pb-3">
                <RoleSwitch current="admin" />
              </div>
            )}
          </header>

          {/* Desktop: search on the left; alerts, who is signed in and a quick action on the right. */}
          <div className="hidden flex-wrap items-center justify-between gap-4 px-6 pb-1 pt-5 lg:flex">
            <form action="/admin/users" className="relative min-w-48 flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                type="search"
                placeholder="Find staff by name, email or phone"
                aria-label="Find staff"
                className="h-11 w-full rounded-xl border border-border/80 bg-card pl-11 pr-4 text-sm placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
              />
            </form>
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
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

          <main id="dashboard-content" className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-24 lg:px-8 lg:pt-8">{children}</main>
        </div>
      </div>

      {assistant && <AssistantLauncher />}
      <NativeBridge />
    </div>
  )
}
