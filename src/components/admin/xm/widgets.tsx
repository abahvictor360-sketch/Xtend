'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, Download, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Calls an X Metrics admin route; throws the message it sends back. */
export async function xmCall(url: string, method: 'POST' | 'PATCH' | 'PUT', body: unknown = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; data?: unknown }
  if (!res.ok) throw new Error(data.error ?? `That did not work (${res.status})`)
  return data
}

const TABS = [
  { href: '/admin/metrics', label: 'Overview' },
  { href: '/admin/metrics/expiry', label: 'Expiry' },
  { href: '/admin/metrics/grades', label: 'Grades' },
  { href: '/admin/metrics/supplies', label: 'Supplies', adminOnly: true },
  { href: '/admin/metrics/targets', label: 'Targets', adminOnly: true },
  { href: '/admin/metrics/setup', label: 'Products & stores', adminOnly: true },
  { href: '/admin/metrics/settings', label: 'Settings', adminOnly: true },
]

/** The X Metrics sub-navigation, under the page title. */
export function XmTabs({ readOnly = false }: { readOnly?: boolean }) {
  const pathname = usePathname()
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.filter((t) => !readOnly || !t.adminOnly).map((t) => {
        const active = t.href === '/admin/metrics' ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
              active ? 'bg-brand text-primary-foreground' : 'bg-tint text-tint-foreground hover:brightness-95',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function XmHeader({ title, intro, readOnly }: { title: string; intro: string; readOnly?: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      <XmTabs readOnly={readOnly} />
    </div>
  )
}

/** A button that runs one action and refreshes the page. */
export function ActionButton({
  url,
  method = 'POST',
  body,
  children,
  confirm,
  variant = 'outline',
  done,
}: {
  url: string
  method?: 'POST' | 'PATCH' | 'PUT'
  body?: unknown
  children: React.ReactNode
  confirm?: string
  variant?: 'outline' | 'default' | 'secondary' | 'ghost'
  done?: (data: unknown) => string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return
          setBusy(true)
          setMessage(null)
          try {
            const data = await xmCall(url, method, body ?? {})
            setFailed(false)
            setMessage(done ? done(data) : null)
            router.refresh()
          } catch (e) {
            setFailed(true)
            setMessage(e instanceof Error ? e.message : 'That did not work')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </Button>
      {message && <span className={cn('text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>{message}</span>}
    </span>
  )
}

/** Runs reconciliation and the expiry check now. */
export function RunChecksButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const res = await fetch('/api/admin/metrics/run', { method: 'POST' })
            const d = (await res.json().catch(() => ({}))) as { reconciled?: number; new_expiry_alerts?: number; error?: string }
            setMessage(res.ok ? `${d.reconciled ?? 0} counts reconciled, ${d.new_expiry_alerts ?? 0} new expiry alerts.` : (d.error ?? 'Failed'))
            router.refresh()
          } finally {
            setBusy(false)
          }
        }}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /> Run checks now
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  )
}

/** A reason, then the action: for voiding and for notes. */
export function NoteAction({
  url,
  label,
  field,
  extra,
  placeholder,
  required = false,
}: {
  url: string
  label: string
  field: string
  extra?: Record<string, unknown>
  placeholder: string
  required?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await xmCall(url, 'POST', { ...(extra ?? {}), [field]: text })
          setOpen(false)
          setText('')
          router.refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That did not work')
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          className="h-9 min-w-48 px-2 text-xs"
        />
        <Button type="submit" size="iconSm" disabled={busy || (required && text.trim().length < 3)} aria-label={label}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" size="iconSm" variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  )
}

export function VoidButton({ kind, id }: { kind: 'supply' | 'count' | 'sales'; id: string }) {
  return (
    <NoteAction
      url="/api/admin/metrics/void"
      label="Void"
      field="reason"
      extra={{ kind, id }}
      placeholder="Why is it being voided?"
      required
    />
  )
}

/** Download links for an X Metrics report in each format. */
export function ExportLinks({ kind, month, outlet, label }: { kind: string; month?: string; outlet?: string; label?: string }) {
  const q = new URLSearchParams()
  if (month) q.set('month', month.slice(0, 7))
  if (outlet) q.set('outlet', outlet)
  const query = q.toString()
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <Download className="h-3.5 w-3.5 text-muted-foreground" />
      {label && <span className="text-muted-foreground">{label}</span>}
      {(['xlsx', 'docx', 'pdf', 'csv'] as const).map((f) => (
        <a
          key={f}
          href={`/api/admin/metrics/export/${kind}/${f}${query ? `?${query}` : ''}`}
          className="rounded-lg border border-border px-2 py-1 font-semibold uppercase hover:bg-tint"
        >
          {f === 'xlsx' ? 'Excel' : f === 'docx' ? 'Word' : f}
        </a>
      ))}
    </span>
  )
}

/** Chooses the month shown, kept in the address as ?month=YYYY-MM. */
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return (
    <Input
      type="month"
      value={month.slice(0, 7)}
      aria-label="Month"
      className="h-9 w-40 px-2 text-sm"
      onChange={(e) => {
        const next = new URLSearchParams(params.toString())
        if (e.target.value) next.set('month', e.target.value)
        router.push(`${pathname}?${next.toString()}`)
      }}
    />
  )
}
