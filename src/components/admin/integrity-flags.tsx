'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, MapPin, Smartphone } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PhoneCheck } from '@/components/admin/phone-check'
import { FLAG_KINDS } from '@/lib/integrity'
import {
  SEVERITY_LABEL,
  detailFacts,
  flagLinks,
  kindLabel,
  type FlagRow,
  type ReviewStatus,
} from '@/lib/integrity-review'
import { cn, formatLagos, longDate } from '@/lib/utils'

const BADGE = { high: 'destructive', medium: 'warning', low: 'outline' } as const
const DOT = { high: 'bg-[#9b3517]', medium: 'bg-[#d1511a]', low: 'bg-[#f2b48a]' } as const
/** Rendered at once; more on request, so a long range stays quick on a phone. */
const PAGE = 100

export function IntegrityFlags({ flags, status }: { flags: FlagRow[]; status: ReviewStatus }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  const open = useMemo(() => flags.filter((f) => !f.reviewed_at), [flags])
  const visible = flags.slice(0, shown)
  const openVisible = visible.filter((f) => !f.reviewed_at)
  const allPicked = openVisible.length > 0 && openVisible.every((f) => selected.has(f.id))

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string; reviewed?: number; asked?: number }
    if (!res.ok) throw new Error(json.error ?? 'That could not be saved.')
    return json
  }

  async function reviewOne(id: string) {
    setBusy(id)
    setError(null)
    setDone(null)
    try {
      await post(`/api/admin/integrity/${id}/review`, { note: notes[id] || null })
      setSelected((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  async function reviewSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy('bulk')
    setError(null)
    setDone(null)
    try {
      const json = await post('/api/admin/integrity/review', { ids, note: bulkNote || null })
      const n = json.reviewed ?? 0
      setDone(
        n === ids.length
          ? `${n} flag${n === 1 ? '' : 's'} marked reviewed.`
          : `${n} of ${ids.length} marked reviewed. The rest were already reviewed or are not in your team.`,
      )
      setSelected(new Set())
      setBulkNote('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {status === 'open'
            ? 'Nothing left to review for these filters. New flags appear here as clock-ins and counts come in.'
            : 'No flags match these filters.'}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {flags.length} flag{flags.length === 1 ? '' : 's'}
          {open.length !== flags.length ? `, ${open.length} not reviewed` : ''}. Tap one for the detail.
        </p>
        {openVisible.length > 0 && (
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() =>
                setSelected(allPicked ? new Set() : new Set([...selected, ...openVisible.map((f) => f.id)]))
              }
              className="h-4 w-4 accent-[hsl(var(--brand))]"
            />
            Select all {openVisible.length} to review
          </label>
        )}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}

      <ul className="space-y-2">
        {visible.map((f) => (
          <FlagItem
            key={f.id}
            flag={f}
            picked={selected.has(f.id)}
            onPick={() => toggle(f.id)}
            note={notes[f.id] ?? ''}
            onNote={(v) => setNotes((n) => ({ ...n, [f.id]: v }))}
            onReview={() => reviewOne(f.id)}
            busy={busy === f.id || busy === 'bulk'}
          />
        ))}
      </ul>

      {flags.length > shown && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, flags.length - shown)} more of {flags.length - shown}
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-3 z-20 rounded-2xl border border-brand/40 bg-card p-3 shadow-lift">
          <p className="mb-2 text-sm font-semibold">
            {selected.size} selected
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="One note for all of them (optional)"
              maxLength={500}
              className="h-10 min-w-[12rem] flex-1 text-sm"
            />
            <Button className="h-10" onClick={reviewSelected} disabled={busy === 'bulk'}>
              <Check className="h-4 w-4" />
              {busy === 'bulk' ? 'Saving…' : `Mark ${selected.size} reviewed`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function FlagItem({
  flag: f,
  picked,
  onPick,
  note,
  onNote,
  onReview,
  busy,
}: {
  flag: FlagRow
  picked: boolean
  onPick: () => void
  note: string
  onNote: (v: string) => void
  onReview: () => void
  busy: boolean
}) {
  const [phone, setPhone] = useState(false)
  const { facts, products, map } = detailFacts(f.kind, f.detail)
  const links = flagLinks(f)

  return (
    <li className={cn('flex gap-2 rounded-xl border bg-card', picked ? 'border-brand' : 'border-border')}>
      <div className="flex w-9 shrink-0 justify-center pt-3.5">
        {!f.reviewed_at && (
          <input
            type="checkbox"
            checked={picked}
            onChange={onPick}
            aria-label={`Select ${f.staff_name}: ${kindLabel(f.kind)}`}
            className="h-4 w-4 accent-[hsl(var(--brand))]"
          />
        )}
        {f.reviewed_at && <Check className="h-4 w-4 text-success" aria-label="Reviewed" />}
      </div>
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-3 gap-y-1 py-3 pr-3 text-sm [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">{f.staff_name}</span>
              <Badge variant={BADGE[f.severity]}>
                <span className={cn('h-1.5 w-1.5 rounded-full', DOT[f.severity])} />
                {kindLabel(f.kind)}
              </Badge>
              {f.reviewed_at && <Badge variant="success">Reviewed</Badge>}
            </p>
            <p className="mt-1 break-words">
              {f.summary}
              {f.outlet_name ? <span className="text-muted-foreground"> · {f.outlet_name}</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatLagos(f.created_at)}</span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="space-y-3 border-t border-border py-3 pr-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {SEVERITY_LABEL[f.severity]} · {FLAG_KINDS[f.kind]?.meaning ?? 'A check Xtend raised.'}
          </p>

          {facts.length > 0 && (
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {facts.map((x, i) => (
                <div key={i} className="min-w-0 break-words">
                  <dt className="inline font-semibold text-muted-foreground">{x.label}: </dt>
                  <dd className="inline">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <FlagPhoto kind={f.kind} detail={f.detail} />

          {products.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">Product</th>
                    <th className="py-1 pr-2 text-right font-semibold">Left last time</th>
                    <th className="py-1 pr-2 text-right font-semibold">Sold</th>
                    <th className="py-1 pr-2 text-right font-semibold">Counted</th>
                    <th className="py-1 text-right font-semibold">Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 pr-2">{p.product}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{p.last_left}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{p.sold}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{p.left}</td>
                      <td className="py-1 text-right font-semibold tabular-nums text-destructive">{p.missing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 text-xs">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                {l.label}
              </Link>
            ))}
            {map && (
              <a
                href={map}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                <MapPin className="h-3 w-3" />
                The GPS point
              </a>
            )}
            <button
              type="button"
              onClick={() => setPhone((v) => !v)}
              aria-expanded={phone}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold hover:border-brand hover:bg-tint',
                phone ? 'border-brand bg-tint' : 'border-border bg-card',
              )}
            >
              <Smartphone className="h-3 w-3" />
              Is their phone on now?
            </button>
          </div>

          {phone && (
            <div className="rounded-xl bg-tint/50 p-3">
              <PhoneCheck userId={f.user_id} name={f.staff_name} />
            </div>
          )}

          {f.reviewed_at ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Reviewed by {f.reviewed_by_name ?? 'someone'} {formatLagos(f.reviewed_at)}
              {f.review_note ? `: ${f.review_note}` : ''}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Input
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder="What you found (optional)"
                maxLength={500}
                className="h-9 min-w-[12rem] flex-1 text-sm"
              />
              <Button size="sm" className="h-9" onClick={onReview} disabled={busy}>
                <Check className="h-4 w-4" />
                Mark reviewed
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Flag day: {longDate(f.flag_date)}</p>
        </div>
      </details>
    </li>
  )
}

/** The kinds of flag that are about a photo the person should look at. */
const PHOTO_KINDS = new Set(['photo_unchecked', 'photo_rejected', 'selfie_at_home'])

/**
 * The photo behind a photo flag, opened on request through a short-lived
 * link (the same /api/signed-url the other pages use; storage lets a
 * supervisor open their own team's photos, HR and admins anyone's, 0083).
 * When the automatic photo check could not run, this is how a person checks
 * it: is it a live face, taken just now, at the place? Then they mark the
 * flag reviewed with what they found.
 */
function FlagPhoto({ kind, detail }: { kind: string; detail: Record<string, unknown> | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const path = typeof detail?.path === 'string' ? detail.path : null
  const bucket = detail?.bucket === 'reports' ? 'reports' : 'selfies'
  if (!PHOTO_KINDS.has(kind) || !path) return null

  async function show() {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, paths: [path] }),
      })
      const json = (await res.json().catch(() => ({}))) as { urls?: Record<string, string>; error?: string }
      const link = path ? json.urls?.[path] : undefined
      if (!res.ok || !link) throw new Error(json.error ?? 'The photo could not be opened. It may have been deleted.')
      setUrl(link)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The photo could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {kind === 'photo_unchecked' && (
        <p className="text-xs">
          The automatic photo check was not available, so this photo was let through unseen. Look at it:
          is it a live face, taken now, at the place? Then mark the flag reviewed with what you found.
        </p>
      )}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="The photo to check" className="max-h-72 max-w-full rounded-xl border border-border object-contain" />
        </a>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => void show()} disabled={busy}>
          {busy ? 'Opening…' : 'Show photo'}
        </Button>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  )
}
