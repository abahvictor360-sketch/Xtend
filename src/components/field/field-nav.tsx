'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, FileText, Home, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/field', label: 'Home', icon: Home },
  { href: '/field/history', label: 'History', icon: CalendarDays },
  { href: '/field/report', label: 'Report', icon: FileText },
  { href: '/field/account', label: 'You', icon: User },
]

/** Floating bottom bar. Thumb-reachable, four targets, nothing else. */
export function FieldNav() {
  const pathname = usePathname()

  return (
    <nav className="safe-bottom sticky bottom-0 z-30 -mt-6 bg-gradient-to-t from-background via-background to-transparent px-4 pt-6">
      <div className="surface flex items-center justify-around rounded-3xl px-2 py-2">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === '/field' ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-[64px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[10px] font-semibold transition-colors',
                active ? 'bg-tint text-brand' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
