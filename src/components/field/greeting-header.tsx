'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound, LogOut, Menu, X } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { XpelMark } from '@/components/brand/logo'

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

/**
 * "Hello, John!" with the avatar acting as the account menu, the way the
 * reference lays it out.
 */
export function GreetingHeader({ fullName, subtitle }: { fullName: string; subtitle: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const firstName = fullName.split(' ')[0] ?? fullName

  return (
    <header className="safe-top relative">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-foreground shadow-soft"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <XpelMark className="h-7 w-7" />

        <Link
          href="/field/account"
          aria-label="Your account"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-lift"
        >
          {initials(fullName)}
        </Link>
      </div>

      <div className="mt-5">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
          Hello, <span className="text-brand">{firstName}!</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {open && (
        <div className="surface absolute left-0 top-12 z-40 w-56 animate-fade-up p-2">
          <Link
            href="/field/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-tint"
          >
            <KeyRound className="h-4 w-4 text-brand" />
            Account and password
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10"
            onClick={async () => {
              await supabase().auth.signOut()
              router.replace('/login')
              router.refresh()
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </header>
  )
}
