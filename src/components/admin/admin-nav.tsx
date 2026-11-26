'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BadgeCheck, BarChart3, Bell, BookOpen, Bot, CalendarCheck, CalendarDays, ChevronDown, ClipboardList, FileClock, FileText, Gauge, Headset, LayoutDashboard, MapPin, MapPinned, Menu, MessageSquareText, MessagesSquare, PackageSearch, PhoneOff, RefreshCw, Route, Search, ShieldAlert, Siren, Store, UserCog, Users, UsersRound, Wrench, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { xmMenuItem, XM_ALL_ON } from '@/lib/metrics/features'

interface NavLink {
  href: string
  label: string
  icon: LucideIcon
  adminOnly: boolean
  /** Shown to supervisors only (admins have their own version). */
  supervisorOnly?: boolean
}

/** The dashboard, grouped the way people look for things. */
const GROUPS: { title: string | null; links: NavLink[] }[] = [
  {
    title: null,
    links: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, adminOnly: false },
      { href: '/admin/ask', label: 'Ask Xtend', icon: MessageSquareText, adminOnly: false },
      { href: '/admin/guide', label: 'Admin guide', icon: BookOpen, adminOnly: true },
      { href: '/admin/supervisor-guide', label: 'Guide', icon: BookOpen, adminOnly: false, supervisorOnly: true },
    ],
  },
  {
    title: 'Attendance',
    links: [
      { href: '/admin/attendance', label: 'Attendance', icon: ClipboardList, adminOnly: false },
      { href: '/admin/tracking', label: 'Movement', icon: Route, adminOnly: false },
      { href: '/admin/visits', label: 'Store visits', icon: MapPin, adminOnly: false },
      { href: '/admin/marketer-reports', label: 'Marketer reports', icon: FileText, adminOnly: false },
      { href: '/admin/alerts', label: 'Alerts', icon: Siren, adminOnly: false },
      { href: '/admin/messages', label: 'Messages', icon: MessagesSquare, adminOnly: false },
      { href: '/admin/support', label: 'Support', icon: Headset, adminOnly: false },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, adminOnly: false },
    ],
  },
  {
    title: 'Stock',
    links: [
      { href: '/admin/store-counts', label: 'Stock count', icon: PackageSearch, adminOnly: false },
      { href: '/admin/metrics', label: 'X Metrics', icon: Gauge, adminOnly: false },
    ],
  },
  {
    title: 'Checks',
    links: [
      { href: '/admin/integrity', label: 'Integrity', icon: ShieldAlert, adminOnly: false },
      { href: '/admin/excuses', label: 'Check an excuse', icon: PhoneOff, adminOnly: false },
    ],
  },
  {
    title: 'People',
    links: [
      { href: '/admin/users', label: 'Staff', icon: Users, adminOnly: false },
      { href: '/admin/teams', label: 'Teams', icon: UsersRound, adminOnly: true },
      { href: '/admin/schedules', label: 'Schedules', icon: CalendarDays, adminOnly: false },
      { href: '/admin/leave', label: 'Leave', icon: CalendarCheck, adminOnly: false },
      { href: '/admin/roles', label: 'Roles', icon: BadgeCheck, adminOnly: true },
      { href: '/admin/assignments', label: 'Store allocation', icon: UserCog, adminOnly: false },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell, adminOnly: false },
    ],
  },
  {
    title: 'Setup',
    links: [
      { href: '/admin/outlets', label: 'Outlets', icon: Store, adminOnly: false },
      { href: '/admin/places', label: 'Places', icon: MapPinned, adminOnly: true },
      { href: '/admin/audit', label: 'Audit log', icon: FileClock, adminOnly: true },
      { href: '/admin/activity', label: 'Activity log', icon: Activity, adminOnly: true },
      { href: '/admin/updates', label: 'Updates', icon: RefreshCw, adminOnly: true },
      { href: '/admin/ai', label: 'AI keys', icon: Bot, adminOnly: true },
      { href: '/admin/system', label: 'System', icon: Wrench, adminOnly: true },
    ],
  },
]

/** What HR (0072) uses: people, not stock, locations or settings. */
const HR_LINKS = new Set([
  '/admin/guide',
  '/admin/attendance',
  '/admin/analytics',
  '/admin/messages',
  '/admin/users',
  '/admin/schedules',
  '/admin/leave',
])

/** Counts shown beside a menu link (open alerts, flags to review), by href. */
export type NavBadges = Partial<Record<string, number | null>>

/** Lower case, accents off: "Store visits" matches "store", "visit", "STÓRE". */
function fold(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Every word typed must be in the link's name or its group's. */
export function matchesQuery(label: string, group: string | null, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fold(`${label} ${group ?? ''}`)
  return words.every((w) => text.includes(w))
}

function useLinks(readOnly: boolean, xmEnabled: boolean, hr = false) {
  const pathname = usePathname()
  // X Metrics switched off (0063): gone for supervisors; admins keep it,
  // marked off, opening Settings so they can switch it back on.
  const xm = xmMenuItem({ ...XM_ALL_ON, enabled: xmEnabled }, !readOnly)
  const groups = GROUPS.map((g) => ({
    ...g,
    links: g.links
      .filter((link) =>
        hr
          ? HR_LINKS.has(link.href)
          : (!link.adminOnly || !readOnly) && (!link.supervisorOnly || readOnly),
      )
      .filter((link) => link.href !== '/admin/metrics' || xm.show)
      .map((link) =>
        link.href === '/admin/metrics' && xm.off ? { ...link, href: xm.href, label: `${link.label} (off)` } : link,
      ),
  })).filter((g) => g.links.length > 0)
  const isActive = (href: string) =>
    href === '/admin' ? pathname === href : pathname.startsWith(href)
  return { pathname, groups, isActive }
}

const OPEN_KEY = 'xt_nav_open'

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function Count({ n, active }: { n: number | null | undefined; active?: boolean }) {
  if (!n) return null
  return (
    <span
      className={cn(
        'ml-auto min-w-6 rounded-full px-1.5 py-0.5 text-center text-[0.6875rem] font-bold tabular-nums',
        active ? 'bg-brand text-primary-foreground' : 'bg-destructive/10 text-destructive',
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

function FindPage({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        type="text"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find a page"
        aria-label="Find a page in the menu"
        className="h-10 w-full rounded-xl border border-border/80 bg-muted/40 pl-9 pr-8 text-sm placeholder:text-muted-foreground focus-visible:border-brand focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Desktop: a menu down the left side, always in view, grouped. Rendered in
 * the layout's sidebar column, which only exists on large screens. A box at
 * the top finds a page; each group folds away, the one holding the current
 * page open (what the person opened is remembered in this browser); open
 * alerts and flags to review show as counts.
 */
export function AdminSidebarNav({
  readOnly,
  xmEnabled = true,
  hr = false,
  badges = {},
}: {
  readOnly: boolean
  xmEnabled?: boolean
  hr?: boolean
  badges?: NavBadges
}) {
  const { groups, isActive } = useLinks(readOnly, xmEnabled, hr)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const searchId = useId()
  useEffect(() => setOpen(readOpen()), [])

  const toggle = (title: string, now: boolean) =>
    setOpen((o) => {
      const next = { ...o, [title]: !now }
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next))
      } catch {
        // Private mode: groups simply start as they are.
      }
      return next
    })

  const searching = query.trim().length > 0
  const shown = groups
    .map((g) => ({ ...g, links: g.links.filter((l) => matchesQuery(l.label, g.title, query)) }))
    .filter((g) => g.links.length > 0)

  return (
    <nav aria-label="Dashboard" className="space-y-4">
      <FindPage value={query} onChange={setQuery} id={searchId} />
      {shown.length === 0 && <p className="px-3 text-sm text-muted-foreground">No page matches.</p>}
      <div className="space-y-2">
        {shown.map((group, i) => {
          const holdsCurrent = group.links.some((l) => isActive(l.href))
          const groupCount = group.links.reduce((n, l) => n + (badges[l.href] ?? 0), 0)
          const isOpen = !group.title || searching || (open[group.title] ?? (holdsCurrent || group.title === 'Attendance'))
          return (
            <div key={group.title ?? i}>
              {group.title && (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => !searching && toggle(group.title!, isOpen)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  {group.title}
                  {!isOpen && groupCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-label="Something to look at" />}
                  <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', !isOpen && '-rotate-90')} />
                </button>
              )}
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {group.links.map((link) => {
                    const active = isActive(link.href)
                    const Icon = link.icon
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-tint font-semibold text-brand before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-brand'
                            : 'font-medium text-foreground/75 hover:bg-muted/70 hover:text-foreground',
                        )}
                      >
                        <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-brand' : 'text-muted-foreground')} />
                        <span className="truncate">{link.label}</span>
                        <Count n={badges[link.href]} active={active} />
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * Phone and tablet: one button that drops the whole menu down. A long tab
 * strip hides most of the dashboard from anyone holding a phone.
 */
export function AdminNav({
  readOnly,
  xmEnabled = true,
  hr = false,
  badges = {},
}: {
  readOnly: boolean
  xmEnabled?: boolean
  hr?: boolean
  badges?: NavBadges
}) {
  const { pathname, groups, isActive } = useLinks(readOnly, xmEnabled, hr)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchId = useId()
  const shown = groups
    .map((g) => ({ ...g, links: g.links.filter((l) => matchesQuery(l.label, g.title, query)) }))
    .filter((g) => g.links.length > 0)
  const menu = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const current =
    groups.flatMap((g) => g.links).find((l) => isActive(l.href))?.label ?? 'Menu'

  // Close on route change, on Escape, and on a click elsewhere.
  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const onClick = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onClick)
    }
  }, [open])

  return (
    <div ref={menu} className="relative px-4 pb-3 lg:hidden">
      <button
        type="button"
        ref={trigger}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between min-h-11 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-soft"
      >
        <span className="flex items-center gap-2">
          <Menu className="h-4 w-4 text-brand" />
          {current}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          id={menuId}
          role="navigation"
          aria-label="Dashboard pages"
          className="surface absolute left-4 right-4 top-full z-40 mt-1 max-h-[75dvh] animate-fade-up overflow-y-auto p-2"
        >
          <FindPage value={query} onChange={setQuery} id={searchId} />
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No page matches.</p>}
          {shown.map((group, i) => (
            <div key={group.title ?? i}>
              {group.title && (
                <p className="px-4 pb-1 pt-3 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </p>
              )}
              {group.links.map((link) => {
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={isActive(link.href) ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium',
                      isActive(link.href)
                        ? 'bg-brand text-primary-foreground'
                        : 'text-foreground hover:bg-tint',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{link.label}</span>
                    <Count n={badges[link.href]} />
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
