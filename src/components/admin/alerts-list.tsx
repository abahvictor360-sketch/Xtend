'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { AutoRefresh } from '@/components/admin/movement-map'
import { PhoneCheck } from '@/components/admin/phone-check'
import { ALERT_SHORT, STALE_HOURS, ageText, alertAgeMinutes, alertLabel, alertLinks, isAlertType } from '@/lib/alert-review'
import { cn, formatLagos, metres } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'

const box = 'h-4 w-4 shrink-0 accent-[hsl(var(--brand))]'

/**
 * The alerts on screen. Admins tick several and resolve them with one note
 * (/api/admin/alerts), or resolve one at a time as before. While nothing is
 * ticked or typed, the list refreshes itself every minute.
 */
export function AlertsList({
  alerts,
  canResolve,
  autoRefresh,
  now,
  emptyText,
}: {
  alerts: AlertDetail[]
  canResolve: boolean
  autoRefresh: boolean
  /** The server's clock, so the ages read the same on the server and in the browser. */
  now: number
  emptyText: string
}) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const open = alerts.filter((a) => !a.is_resolved)
  // Only what is still on screen counts as picked.
  const chosen = open.filter((a) => picked.has(a.id)).map((a) => a.id)
  const typing = bulkNote !== '' || Object.values(notes).some(Boolean)

  function toggle(id: string, on: boolean) {
    setPicked((p) => {
      const next = new Set(p)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string; resolved?: number }
    if (!res.ok) throw new Error(data.error ?? 'Could not resolve that.')
    return data
  }

  async function resolve(id: string) {
    setBusy(id)
    setError(null)
    setDone(null)
    try {
      await post(`/api/admin/alerts/${id}`, { note: notes[id] ?? '' })
      setNotes((n) => ({ ...n, [id]: '' }))
      toggle(id, false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve that alert.')
    } finally {
      setBusy(null)
    }
  }

  async function resolvePicked() {
    if (!chosen.length) return
    setBusy('bulk')
    setError(null)
    setDone(null)
    try {
      const data = await post('/api/admin/alerts', { ids: chosen, note: bulkNote })
      const n = data.resolved ?? chosen.length
      setDone(
        n === chosen.length
          ? `${n} alert${n === 1 ? '' : 's'} resolved.`
          : `${n} of ${chosen.length} resolved; the others had already been resolved by someone else.`,
      )
      setPicked(new Set())
      setBulkNote('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve those alerts.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {autoRefresh && chosen.length === 0 && !typing && <AutoRefresh seconds={60} />}
      {error && <Alert variant="destructive">{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}

      {canResolve && open.length > 1 && (
        <label className="flex items-center gap-2 px-1 text-sm font-semibold">
          <input
            type="checkbox"
            className={box}
            checked={chosen.length === open.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(open.map((a) => a.id)) : new Set())}
          />
          Pick all {open.length} open alerts shown
        </label>
      )}

      {alerts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const links = alertLinks(alert)
            const stale = !alert.is_resolved && alertAgeMinutes(alert, now) >= STALE_HOURS * 60
            const selectable = canResolve && !alert.is_resolved
            return (
              <Card key={alert.id} className={cn(picked.has(alert.id) && !alert.is_resolved && 'border-brand/60')}>
                <CardContent className="flex gap-3 p-4 pt-4">
                  {selectable && (
                    <input
                      type="checkbox"
                      className={cn(box, 'mt-1')}
                      aria-label={`Pick the alert for ${alert.staff_name}`}
                      checked={picked.has(alert.id)}
                      onChange={(e) => toggle(alert.id, e.target.checked)}
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 font-medium">
                        {alert.staff_name}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {alert.outlet_name ?? 'No home store'}
                        </span>
                      </p>
                      <span className="flex flex-wrap gap-1">
                        {isAlertType(alert.alert_type) && <Badge variant="default">{ALERT_SHORT[alert.alert_type]}</Badge>}
                        <Badge variant={alert.is_resolved ? 'success' : stale ? 'destructive' : 'warning'}>
                          {ageText(alert, now)}
                        </Badge>
                      </span>
                    </div>
                    <p className="text-sm">{alertLabel(alert.alert_type)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatLagos(alert.created_at)}
                      {alert.distance_m !== null && ` · ${metres(alert.distance_m)} from the store`}
                    </p>
                    {alert.location_label && (
                      <p className="flex items-start gap-1 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0">{alert.location_label}</span>
                        {alert.lat !== null && alert.lng !== null && (
                          <a
                            className="shrink-0 font-semibold text-brand"
                            href={`https://www.google.com/maps/search/?api=1&query=${alert.lat},${alert.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            map
                          </a>
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                      <Link href={links.movement} className="text-brand hover:underline">
                        Movement that day
                      </Link>
                      <Link href={links.excuse} className="text-brand hover:underline">
                        Check an excuse
                      </Link>
                      {alert.staff_phone && (
                        <a href={`tel:${alert.staff_phone}`} className="text-brand hover:underline">
                          Call {alert.staff_phone}
                        </a>
                      )}
                    </div>
                    {!alert.is_resolved && (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-semibold text-muted-foreground">
                          Is their phone on right now?
                        </summary>
                        <div className="mt-2">
                          <PhoneCheck userId={alert.user_id} name={alert.staff_name} />
                        </div>
                      </details>
                    )}
                    {alert.is_resolved && (
                      <p className="text-xs text-muted-foreground">
                        Resolved by {alert.resolved_by_name ?? 'an admin'} {formatLagos(alert.resolved_at)}
                        {alert.note ? ` — “${alert.note}”` : ''}
                      </p>
                    )}
                    {selectable && (
                      <div className="flex w-full gap-2 pt-1 sm:max-w-md">
                        <Input
                          placeholder="Resolution note"
                          maxLength={1000}
                          value={notes[alert.id] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [alert.id]: e.target.value }))}
                        />
                        <Button variant="outline" onClick={() => resolve(alert.id)} disabled={busy !== null}>
                          {busy === alert.id ? '…' : 'Resolve'}
                        </Button>
                      </div>
                    )}
                    {!alert.is_resolved && !canResolve && (
                      <p className="text-xs text-muted-foreground">Open. An admin resolves alerts.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {canResolve && chosen.length > 0 && (
        <div className="sticky bottom-3 z-10 rounded-2xl border border-brand/40 bg-card p-3 shadow-lift">
          <p className="mb-2 text-sm font-semibold">
            {chosen.length} alert{chosen.length === 1 ? '' : 's'} picked. Resolve them together with one note:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="What was done, e.g. “Called them, they were at the bank for the store”"
              maxLength={1000}
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => void resolvePicked()} disabled={busy !== null} className="flex-1 sm:flex-none">
                {busy === 'bulk' ? 'Resolving…' : `Resolve ${chosen.length}`}
              </Button>
              <Button variant="outline" onClick={() => setPicked(new Set())} disabled={busy !== null}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
