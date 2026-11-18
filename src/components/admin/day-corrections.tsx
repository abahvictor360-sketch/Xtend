'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CORRECTION_LABELS, type CorrectionAction } from '@/lib/field-corrections'

export interface FixVisit {
  id: string
  name: string
  status: string
}

/**
 * "Fix today's record" on a person's day (0090): the office records a
 * clock-in, clock-out, check-in or check-out for them, or asks them to do
 * one again. Every one needs a reason; the database keeps them all.
 */
export function DayCorrections({
  personId,
  personName,
  date,
  marketer,
  clockedIn,
  clockedOut,
  stores,
  homeStoreId,
  visits,
}: {
  personId: string
  personName: string
  /** Today's date, 'YYYY-MM-DD' (Lagos). */
  date: string
  marketer: boolean
  clockedIn: boolean
  clockedOut: boolean
  stores: { id: string; name: string }[]
  homeStoreId: string | null
  visits: FixVisit[]
}) {
  const router = useRouter()
  const [action, setAction] = useState<CorrectionAction | null>(null)
  const [visitId, setVisitId] = useState<string | null>(null)
  const [storeId, setStoreId] = useState(homeStoreId && stores.some((s) => s.id === homeStoreId) ? homeStoreId : (stores[0]?.id ?? ''))
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openVisit = visits.find((v) => v.status === 'open') ?? null
  const first = personName.split(' ')[0]

  const choices: { action: CorrectionAction; label: string; visit?: string }[] = [
    { action: 'office_clock_in', label: clockedIn ? `Clock ${first} in again (replace)` : `Clock ${first} in` },
    ...(clockedIn ? [{ action: 'redo_clock_in' as const, label: 'Ask them to clock in again' }] : []),
    ...(clockedIn ? [{ action: 'office_clock_out' as const, label: clockedOut ? `Clock ${first} out again (replace)` : `Clock ${first} out` }] : []),
    ...(clockedOut ? [{ action: 'reset_clock_out' as const, label: `Undo ${first}'s clock-out (back on shift)` }] : []),
    ...(clockedOut ? [{ action: 'redo_clock_out' as const, label: 'Ask them to clock out again' }] : []),
    ...(marketer && clockedIn && !clockedOut && !openVisit ? [{ action: 'office_check_in' as const, label: `Check ${first} in at a store` }] : []),
    ...(marketer && openVisit ? [{ action: 'office_check_out' as const, label: `Check ${first} out of ${openVisit.name}` }] : []),
    ...visits
      .filter((v) => v.status !== 'abandoned')
      .map((v) => ({ action: 'redo_check_in' as const, label: `Ask them to check in again (${v.name})`, visit: v.id })),
    ...visits
      .filter((v) => v.status === 'closed')
      .map((v) => ({ action: 'redo_check_out' as const, label: `Ask them to check out again (${v.name})`, visit: v.id })),
  ]

  const needsStore = action === 'office_clock_in' || action === 'office_clock_out' || action === 'office_check_in'
  const needsTime = action === 'office_clock_in' || action === 'office_clock_out'

  function pick(next: CorrectionAction, visit?: string) {
    setAction(next)
    setVisitId(visit ?? null)
    setError(null)
    setNotice(null)
    setReason('')
    setTime('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!action) return
    setBusy(true)
    setError(null)
    try {
      // A time typed as HH:MM is today's, in Lagos (UTC+1, no summer time).
      const at = needsTime && time ? `${date}T${time}:00+01:00` : null
      const res = await fetch('/api/admin/field-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: personId,
          action,
          reason,
          outlet_id: needsStore ? storeId : null,
          at,
          visit_id: visitId,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'That did not work. Try again.')
        return
      }
      setNotice(`${CORRECTION_LABELS[action]}. ${first} has been told.`)
      setAction(null)
      router.refresh()
    } catch {
      setError('No connection. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="icon-tile">
          <Wrench className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-bold">Fix today&apos;s record</h2>
          <p className="text-sm text-muted-foreground">
            When the app did not work for {first}, record it for them once you are sure they are at the store,
            ask them to do it again, or undo a clock-out made by mistake. They are told, and the old record is kept.
          </p>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {!action ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Button key={c.action + (c.visit ?? '')} variant="outline" size="sm" onClick={() => pick(c.action, c.visit)}>
              {c.label}
            </Button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm font-semibold">{choices.find((c) => c.action === action && (c.visit ?? null) === visitId)?.label}</p>
          {action === 'reset_clock_out' && (
            <p className="rounded-xl bg-tint px-3 py-2 text-xs text-tint-foreground">
              Their clock-out is taken off and they are on shift again: their location is followed again and they are
              reminded to clock out. They get a notification asking them to clock out at the end of the shift. The old
              clock-out is kept in the record.
            </p>
          )}
          {needsStore && (
            <div className="space-y-1">
              <Label htmlFor="fix-store">Store</Label>
              {stores.length ? (
                <Select id="fix-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-destructive">They have no store with a location. Set one on Outlets first.</p>
              )}
            </div>
          )}
          {needsTime && (
            <div className="space-y-1">
              <Label htmlFor="fix-time">Time today (leave empty for now)</Label>
              <Input id="fix-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-[10rem]" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="fix-reason">Why</Label>
            <Input
              id="fix-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === 'reset_clock_out'
                  ? 'e.g. Clocked out by mistake; still at the store until 6 pm'
                  : action.startsWith('redo')
                    ? 'What they should do, e.g. clock in with your selfie at the store'
                    : 'e.g. Phone would not open; I called them at the store'
              }
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || (needsStore && !storeId)}>
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
