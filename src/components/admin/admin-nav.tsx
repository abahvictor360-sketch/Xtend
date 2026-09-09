'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/admin', label: 'Overview', adminOnly: false },
  { href: '/admin/attendance', label: 'Attendance', adminOnly: false },
  { href: '/admin/alerts', label: 'Alerts', adminOnly: false },
  { href: '/admin/analytics', label: 'Analytics', adminOnly: false },
  { href: '/admin/users', label: 'Staff', adminOnly: true },
  { href: '/admin/outlets', label: 'Outlets', adminOnly: true },
  { href: '/admin/audit', label: 'Audit log', adminOnly: true },
]

export function AdminNav({ readOnly }: { readOnly: boolean }) {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
      {LINKS.filter((link) => !link.adminOnly || !readOnly).map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
              active ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
