'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/admin', label: 'Overview', adminOnly: false },
  { href: '/admin/attendance', label: 'Attendance', adminOnly: false },
  { href: '/admin/visits', label: 'Store visits', adminOnly: false },
  { href: '/admin/alerts', label: 'Alerts', adminOnly: false },
  { href: '/admin/analytics', label: 'Analytics', adminOnly: false },
  { href: '/admin/notifications', label: 'Notifications', adminOnly: false },
  { href: '/admin/users', label: 'Staff', adminOnly: true },
  { href: '/admin/outlets', label: 'Outlets', adminOnly: true },
  { href: '/admin/audit', label: 'Audit log', adminOnly: true },
]

/**
 * Tabs on a desktop, a dropdown on a phone. Seven tabs in a sideways-scrolling
 * strip hides most of the dashboard from anyone holding a phone.
 */
export function AdminNav({ readOnly }: { readOnly: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement | null>(null)

  const links = LINKS.filter((link) => !link.adminOnly || !readOnly)
  const isActive = (href: string) =>
    href === '/admin' ? pathname === href : pathname.startsWith(href)
  const current = links.find((l) => isActive(l.href))?.label ?? 'Menu'

  // Close on route change, on Escape, and on a click elsewhere.
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <>
      {/* Phone: one button that drops the whole menu down. */}
      <div ref={menu} className="relative px-4 pb-3 md:hidden">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-soft"
        >
          <span className="flex items-center gap-2">
            <Menu className="h-4 w-4 text-brand" />
            {current}
          </span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div
            role="menu"
            className="surface absolute left-4 right-4 top-full z-40 mt-1 animate-fade-up overflow-hidden p-1"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                className={cn(
                  'block rounded-xl px-4 py-2.5 text-sm font-medium',
                  isActive(link.href)
                    ? 'bg-brand text-primary-foreground'
                    : 'text-foreground hover:bg-tint',
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: the tab strip. */}
      <nav className="hidden gap-1 px-2 pb-2 md:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
              isActive(link.href)
                ? 'bg-brand text-primary-foreground shadow-lift'
                : 'text-muted-foreground hover:bg-tint hover:text-tint-foreground',
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
