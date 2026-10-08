'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Expand, MessageCircle, X } from 'lucide-react'
import { AttendanceAssistant } from '@/components/admin/attendance-assistant'
import { cn } from '@/lib/utils'

/**
 * The Ask Xtend chat as a floating button on every dashboard page. It lives
 * in the admin layout, so the conversation survives moving between tabs.
 * A full-screen sheet on a phone, a panel in the corner on a desktop.
 */
export function AssistantLauncher() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // The Ask Xtend page is already the chat; a second one on top is noise.
  if (pathname.startsWith('/admin/ask')) return null

  return (
    <>
      {/* Kept mounted while closed so the conversation is still there on reopen. */}
      <div
        role="dialog"
        aria-label="Ask Xtend"
        aria-hidden={!open}
        className={cn(
          'fixed z-50 flex flex-col bg-background',
          'inset-0 md:inset-auto md:bottom-24 md:right-6 md:h-[min(640px,calc(100dvh-8rem))] md:w-[400px]',
          'md:rounded-3xl md:border md:border-border md:shadow-[0_20px_50px_-20px_rgb(24_18_14/0.45)]',
          open ? 'animate-fade-up' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Ask Xtend</p>
            <p className="text-xs text-muted-foreground">Attendance, visits, stock, integrity and more</p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/admin/ask"
              onClick={() => setOpen(false)}
              className="rounded-xl p-2 text-muted-foreground hover:bg-tint hover:text-tint-foreground"
              aria-label="Open full page"
              title="Open full page"
            >
              <Expand className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl p-2 text-muted-foreground hover:bg-tint hover:text-tint-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-4">
          <AttendanceAssistant configured compact />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close Ask Xtend' : 'Ask Xtend'}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-primary-foreground shadow-lift transition-transform hover:bg-brand-deep active:scale-95 md:bottom-6 md:right-6',
          open && 'hidden md:flex',
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        <span className={cn(open && 'sr-only')}>Ask Xtend</span>
      </button>
    </>
  )
}
