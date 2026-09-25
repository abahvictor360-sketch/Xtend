'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShieldAlert } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { FLAG_KINDS } from '@/lib/integrity'
import { cn, formatLagos } from '@/lib/utils'

export interface FlagRow {
  id: string
  staff_name: string
  kind: string
  severity: 'low' | 'medium' | 'high'
  summary: string
  detail: { products?: { product: string; last_left: number; sold: number; left: number; missing: number }[] }
  outlet_name: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by_name: string | null
  review_note: string | null
}

const SEVERITY: Record<FlagRow['severity'], string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning/15 text-foreground',
  low: 'bg-muted text-muted-foreground',
}

export function IntegrityFlags({ flags }: { flags: FlagRow[] }) {
  const router = useRouter()
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [kind, setKind] = useState<string>('all')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const open = flags.filter((f) => !f.reviewed_at)
  const visible = useMemo(
    () =>
      flags.filter(
        (f) => (show === 'all' || !f.reviewed_at) && (kind === 'all' || f.kind === kind),
      ),
    [flags, show, kind],
  )

  // Who has the most open flags: the people to visit first.
  const byPerson = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of open) counts.set(f.staff_name, (counts.get(f.staff_name) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [open])

  async function review(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/integrity/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: notes[id] || null }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That could not be saved.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  if (flags.length === 0) {
    return (
      <Alert variant="success">
        Nothing suspicious in the last 30 days. New flags appear here as clock-ins and store
        counts come in.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {byPerson.length > 0 && (
        <div className="surface p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4 text-brand" />
            Most open flags: visit these first
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {byPerson.map(([name, count]) => (
              <li key={name} className="rounded-full bg-tint px-3 py-1">
                {name} <span className="font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Chip active={show === 'open'} onClick={() => setShow('open')}>
          To review ({open.length})
        </Chip>
        <Chip active={show === 'all'} onClick={() => setShow('all')}>
          All ({flags.length})
        </Chip>
        <span className="mx-1 w-px bg-border" />
        <Chip active={kind === 'all'} onClick={() => setKind('all')}>
          Every kind
        </Chip>
        {Object.entries(FLAG_KINDS)
          .filter(([k]) => flags.some((f) => f.kind === k))
          .map(([k, v]) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {v.label}
            </Chip>
          ))}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <ul className="space-y-3">
        {visible.map((f) => (
          <li key={f.id} className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{f.staff_name}</span>
              <span className="flex items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SEVERITY[f.severity])}>
                  {FLAG_KINDS[f.kind]?.label ?? f.kind}
                </span>
                <span className="text-xs text-muted-foreground">{formatLagos(f.created_at)}</span>
              </span>
            </div>
            <p className="mt-1">
              {f.summary}
              {f.outlet_name ? ` · ${f.outlet_name}` : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{FLAG_KINDS[f.kind]?.meaning}</p>

            {f.detail?.products && f.detail.products.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {f.detail.products.map((p) => (
                  <li key={p.product}>
                    <span className="font-medium">{p.product}</span>: {p.last_left} left last time, {p.sold}{' '}
                    sold, so {p.last_left - p.sold} expected; counted {p.left}.{' '}
                    <span className="font-semibold text-destructive">{p.missing} missing</span>
                  </li>
                ))}
              </ul>
            )}

            {f.reviewed_at ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Reviewed by {f.reviewed_by_name ?? 'someone'} {formatLagos(f.reviewed_at)}
                {f.review_note ? `: ${f.review_note}` : ''}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  value={notes[f.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                  placeholder="What you found (optional)"
                  maxLength={500}
                  className="h-9 min-w-[12rem] flex-1 text-sm"
                />
                <Button size="sm" className="h-9" onClick={() => review(f.id)} disabled={busy === f.id}>
                  <Check className="h-4 w-4" />
                  Mark reviewed
                </Button>
              </div>
            )}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            <Badge variant="outline">Nothing here</Badge>
          </li>
        )}
      </ul>
    </div>
  )
}
