'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, ClipboardList, FileText, Home, User } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A floating dark bar at the bottom, thumb-reachable. The current tab opens
 * into a white pill with its name; the others are round icons. The Report
 * and Count tabs only exist for the people who use them.
 */
export function FieldNav({
  canFileReport,
  canCountStock,
}: {
  canFileReport: boolean
  canCountStock: boolean
}) {
  const pathname = usePathname()

  const links = [
    { href: '/field', label: 'Home', icon: Home },
    { href: '/field/history', label: 'History', icon: CalendarDays },
    ...(canFileReport ? [{ href: '/field/report', label: 'Report', icon: FileText }] : []),
    ...(canCountStock ? [{ href: '/field/count', label: 'Count', icon: ClipboardList }] : []),
    { href: '/field/account', label: 'You', icon: User },
  ]

  return (
    <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-2">
      <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-1 rounded-full bg-[hsl(24_14%_11%)] p-1.5 shadow-[0_18px_40px_-16px_rgb(24_18_14/0.6)]">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/field' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all',
                active
                  ? 'flex-[2] bg-white px-4 text-foreground'
                  : 'w-12 flex-1 bg-white/10 text-white/75 hover:bg-white/15 hover:text-white',
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active && 'text-brand')} strokeWidth={active ? 2.3 : 1.9} />
              {active && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
