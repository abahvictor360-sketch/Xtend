'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Clock, FileText, History } from 'lucide-react'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/field', label: 'Clock', icon: Clock },
  { href: '/field/report', label: 'Report', icon: FileText },
  { href: '/field/history', label: 'History', icon: History },
]

export function FieldNav() {
  const pathname = usePathname()

  return (
    <nav className="safe-bottom sticky bottom-0 grid grid-cols-3 border-t border-border bg-background">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 text-xs',
              active ? 'font-medium text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
