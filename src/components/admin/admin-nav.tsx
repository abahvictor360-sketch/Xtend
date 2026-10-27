'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BarChart3,
  BookOpen,
  Bell,
  CalendarDays,
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  FileClock,
  FileText,
  LayoutDashboard,
  MapPin,
  MapPinned,
  Headset,
  Menu,
  MessageSquareText,
  MessagesSquare,
  PackageSearch,
  PhoneOff,
  Route,
  ShieldAlert,
  Siren,
  Store,
  UserCog,
  Users,
  UsersRound,
  BadgeCheck,
  Gauge,
  type LucideIcon,
  RefreshCw,
  Wrench,
} from 'lucide-react'
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

/**
 * Desktop: a menu down the left side, always in view, grouped. Rendered in
 * the layout's sidebar column, which only exists on large screens.
 */
export function AdminSidebarNav({
  readOnly,
  xmEnabled = true,
  hr = false,
}: {
  readOnly: boolean
  xmEnabled?: boolean
  hr?: boolean
}) {
  const { groups, isActive } = useLinks(readOnly, xmEnabled, hr)

  return (
    <nav aria-label="Dashboard" className="space-y-6">
      {groups.map((group, i) => (
        <div key={group.title ?? i} className="space-y-1">
          {group.title && (
            <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
          )}
          {group.links.map((link) => {
            const active = isActive(link.href)
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                  active
                    ? 'bg-muted text-foreground before:absolute before:-left-4 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-brand'
                    : 'text-foreground/75 hover:bg-muted/70 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-brand')} />
                {link.label}
              </Link>
            )
          })}
        </div>
      ))}
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
}: {
  readOnly: boolean
  xmEnabled?: boolean
  hr?: boolean
}) {
  const { pathname, groups, isActive } = useLinks(readOnly, xmEnabled, hr)
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const current =
    groups.flatMap((g) => g.links).find((l) => isActive(l.href))?.label ?? 'Menu'

  // Close on route change, on Escape, and on a click elsewhere.
  useEffect(() => setOpen(false), [pathname])
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
          className="surface absolute left-4 right-4 top-full z-40 mt-1 max-h-[70dvh] animate-fade-up overflow-y-auto p-1"
        >
          {groups.map((group, i) => (
            <div key={group.title ?? i}>
              {group.title && (
                <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
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
                    {link.label}
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
