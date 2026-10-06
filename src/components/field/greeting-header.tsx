'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, BookOpen, KeyRound, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

/**
 * "Hi, John" beside a round avatar that opens the account menu, with the
 * messages bell on the right, as in the reference.
 */
export function GreetingHeader({ fullName, subtitle }: { fullName: string; subtitle: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const firstName = fullName.split(' ')[0] ?? fullName

  return (
    <header className="safe-top relative">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-primary-foreground ring-4 ring-card"
        >
          {initials(fullName)}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-muted-foreground">Hi {firstName}</p>
          <p className="truncate text-base font-bold leading-tight">{subtitle}</p>
        </div>
        <Link
          href="/field/account"
          aria-label="Messages and account"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-tint"
        >
          <Bell className="h-5 w-5" />
        </Link>
      </div>

      {open && (
        <div className="surface absolute left-0 top-16 z-40 w-56 animate-fade-up p-2">
          <Link
            href="/field/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-tint"
          >
            <KeyRound className="h-4 w-4 text-brand" />
            Account and password
          </Link>
          <Link
            href="/guide"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-tint"
          >
            <BookOpen className="h-4 w-4 text-brand" />
            How to use Xtend
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
