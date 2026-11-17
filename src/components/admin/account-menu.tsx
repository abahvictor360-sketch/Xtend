'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronsUpDown, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'
import { cn } from '@/lib/utils'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

const item =
  'flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium leading-snug text-foreground/80 hover:bg-muted hover:text-foreground'

/**
 * Who is signed in, as a button that opens their account: two-step sign-in,
 * fingerprint and passkeys, password and sign out. `variant` places it:
 * the bottom of the side menu (opens upwards), the desktop top bar, or the
 * phone top bar (initials only). Closes on a tap outside, Escape or a new page.
 */
export function AccountMenu({
  name,
  role,
  variant,
}: {
  name: string
  role: string
  variant: 'sidebar' | 'topbar' | 'phone'
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const badge = (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-tint-foreground',
        variant === 'topbar' ? 'h-8 w-8' : 'h-9 w-9',
      )}
    >
      {initials(name)}
    </span>
  )

  return (
    <div ref={box} className={cn('relative', variant === 'sidebar' && 'w-full')}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={variant === 'phone' ? `${name}, ${role}: your account` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center text-left transition-colors',
          variant === 'sidebar' && 'w-full gap-3 rounded-xl p-2 hover:bg-muted',
          variant === 'topbar' && 'h-11 gap-2.5 rounded-xl border border-border/80 bg-card pl-1.5 pr-3 hover:bg-tint',
          variant === 'phone' && 'h-11 w-11 justify-center rounded-xl border border-border/80 bg-card hover:bg-tint',
          open && variant !== 'sidebar' && 'border-brand bg-tint',
          open && variant === 'sidebar' && 'bg-muted',
        )}
      >
        {badge}
        {variant !== 'phone' && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className={cn('block truncate text-sm font-semibold', variant === 'topbar' && 'max-w-[11rem]')}>{name}</span>
            <span className="block text-xs text-muted-foreground">{role}</span>
          </span>
        )}
        {variant === 'sidebar' && <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
        {variant === 'topbar' && (
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-40 space-y-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-lg',
            variant === 'sidebar' ? 'bottom-full left-0 right-0 mb-2' : 'right-0 top-full mt-2 w-64',
          )}
        >
          {variant !== 'sidebar' && (
            <div className="border-b border-border px-3 pb-2.5 pt-1.5">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">{role}</p>
            </div>
          )}
          <Link role="menuitem" href="/mfa/setup" className={item}>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Two-step sign-in
          </Link>
          <Link role="menuitem" href="/admin/sign-in-methods" className={item}>
            <Fingerprint className="h-4 w-4 text-muted-foreground" /> Fingerprint and passkeys
          </Link>
          <Link role="menuitem" href="/change-password" className={item}>
            <KeyRound className="h-4 w-4 text-muted-foreground" /> Change password
          </Link>
          <SignOutButton className="mt-1 h-10 w-full justify-start px-3 text-sm" />
        </div>
      )}
    </div>
  )
}
