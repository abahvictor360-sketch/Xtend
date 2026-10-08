'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatLagos } from '@/lib/utils'

export interface PlaceDueRow {
  id: string
  staff_name: string
  lat: number
  lng: number
  source_kind: 'clock_in' | 'visit'
  due_date: string
  created_at: string
  named_at: string | null
  place_name: string | null
  dismissed_at: string | null
  dismiss_reason: string | null
  dismissed_by_name: string | null
}

/**
 * Places staff had to add in the last week (045): who, where, and what
 * became of it. One still waiting can be dismissed, with a reason, when it
 * was not a shop: until then that person's store work for the day waits.
 */
export function PlaceDues({ dues }: { dues: PlaceDueRow[] }) {
  if (!dues.length) return null
  const open = dues.filter((d) => !d.named_at && !d.dismissed_at).length
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-bold">Places staff had to add</h2>
        <p className="text-xs text-muted-foreground">
          Last 7 days. {open ? `${open} still waiting.` : 'None waiting.'} Dismiss one only when it was not a shop or plaza:
          the person can then carry on.
        </p>
      </div>
      <ul className="divide-y divide-border text-sm">
        {dues.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">{d.staff_name}</span>
              <span className="text-muted-foreground">
                {' '}
                · {d.source_kind === 'visit' ? 'store check-in' : 'clock-in'} · {formatLagos(d.created_at)}
              </span>
              <a
                href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-brand"
              >
                Map <ExternalLink className="h-3 w-3" />
              </a>
            </span>
            {d.named_at ? (
              <Badge variant="success">Added: {d.place_name ?? 'inside a store'}</Badge>
            ) : d.dismissed_at ? (
              <Badge variant="outline">
                Dismissed by {d.dismissed_by_name}: {d.dismiss_reason}
              </Badge>
            ) : (
              <Dismiss id={d.id} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Dismiss({ id }: { id: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) {
    return (
      <span className="flex items-center gap-2">
        <Badge variant="warning">Waiting</Badge>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Dismiss
        </Button>
      </span>
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
          const res = await fetch(`/api/admin/places/due/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          })
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) throw new Error(data.error ?? 'That did not work')
          router.refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That did not work')
        } finally {
          setBusy(false)
        }
      }}
    >
      <span className="flex items-center gap-1">
        <Input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? e.g. clocked in at the depot gate"
          maxLength={300}
          className="h-9 min-w-56 px-2 text-xs"
        />
        <Button type="submit" size="iconSm" disabled={busy || reason.trim().length < 3} aria-label="Dismiss">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button type="button" size="iconSm" variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  )
}
