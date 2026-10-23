'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type Role = 'admin' | 'merchandiser' | 'marketer'

const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'merchandiser', label: 'Merchandiser' },
  { value: 'marketer', label: 'Marketer' },
]

/**
 * The admin's "view as" switch. Picking a field role sends the admin into the
 * field app in that role; picking Admin brings them back to the dashboard.
 * Only ever rendered for an admin (the server enforces that too).
 */
export function RoleSwitch({ current, className }: { current: Role; className?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<Role | null>(null)

  async function pick(role: Role) {
    if (role === current || busy) return
    setBusy(role)
    try {
      const res = await fetch('/api/admin/acting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = (await res.json().catch(() => ({}))) as { to?: string }
      if (res.ok && data.to) {
        startTransition(() => {
          router.push(data.to!)
          router.refresh()
        })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="group"
      aria-label="View the app as"
      className={cn('inline-flex w-full rounded-xl bg-muted p-1', className)}
    >
      {ROLES.map(({ value, label }) => {
        const active = value === current
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            disabled={pending || busy !== null}
            onClick={() => void pick(value)}
            className={cn(
              'min-h-11 flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-70',
              active ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {busy === value ? '…' : label}
          </button>
        )
      })}
    </div>
  )
}
