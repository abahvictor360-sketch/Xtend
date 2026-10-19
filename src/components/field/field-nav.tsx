'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, CalendarDays, ClipboardList, FileText, Home, User } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A floating dark bar at the bottom, thumb-reachable. Every destination has a visible label
 * and an equal-width touch target. The Report
 * and Count tabs only exist for the people who use them.
 */
export function FieldNav({
  canFileReport,
  canCountStock,
  hasMetrics = false,
}: {
  canFileReport: boolean
  canCountStock: boolean
  /** X Metrics stock and sales, once one of their stores is in it. */
  hasMetrics?: boolean
}) {
  const pathname = usePathname()

  const links = [
    { href: '/field', label: 'Home', icon: Home },
    { href: '/field/history', label: 'History', icon: CalendarDays },
    ...(canFileReport ? [{ href: '/field/report', label: 'Report', icon: FileText }] : []),
    ...(canCountStock ? [{ href: '/field/count', label: 'Count', icon: ClipboardList }] : []),
    ...(hasMetrics ? [{ href: '/field/metrics', label: 'Metrics', icon: BarChart3 }] : []),
    { href: '/field/account', label: 'You', icon: User },
  ]

  return (
    <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-2">
      <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-1 rounded-3xl bg-[hsl(24_14%_11%)] p-1.5 shadow-[0_18px_40px_-16px_rgb(24_18_14/0.6)]">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/field' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                active
                  ? 'bg-white text-foreground'
                  : 'bg-white/10 text-white/90 hover:bg-white/15 hover:text-white',
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active && 'text-brand')} strokeWidth={active ? 2.3 : 1.9} />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
