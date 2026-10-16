'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { writtenText } from '@/lib/fields'
import { addDays, cn } from '@/lib/utils'
import {
  LEAVE_KINDS,
  LEAVE_LIMITS,
  LEAVE_STATUS,
  leaveDateProblem,
  leaveRangeText,
  type LeaveKind,
  type LeaveRow,
  type LeaveStatus,
} from '@/lib/schedule'

const reasonField = writtenText(LEAVE_LIMITS.reasonMax, LEAVE_LIMITS.reasonMin, 'the reason')

export const STATUS_BADGE: Record<LeaveStatus, 'warning' | 'success' | 'destructive' | 'outline'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'outline',
}

/** Ask for leave: the type, the first and last day, and why. */
export function LeaveForm({ today, existing }: { today: string; existing: LeaveRow[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<LeaveKind>('annual')
  const [from, setFrom] = useState(addDays(today, 1))
  const [to, setTo] = useState(addDays(today, 1))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const dateProblem = leaveDateProblem(from, to, today, existing)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSent(false)
    if (dateProblem) return setError(dateProblem)
    const checked = reasonField.safeParse(reason)
    if (!checked.success) return setError(checked.error.issues[0]?.message ?? 'Say why you need the leave')
    if (!checked.data) return setError('Say why you need the leave')
    setBusy(true)
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, from, to, reason: checked.data }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'Your request could not be sent. Try again.')
        return
      }
      setSent(true)
      setReason('')
      router.refresh()
    } catch {
      setError('No network. Try again when you have signal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="surface space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="leave-kind" className="field-label">
          Type of leave
        </Label>
        <Select id="leave-kind" value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>
          {(Object.keys(LEAVE_KINDS) as LeaveKind[]).map((k) => (
            <option key={k} value={k}>
              {LEAVE_KINDS[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="leave-from" className="field-label">
            First day
          </Label>
          <Input
            id="leave-from"
            type="date"
            value={from}
            min={addDays(today, -LEAVE_LIMITS.backDays)}
            max={addDays(today, LEAVE_LIMITS.aheadDays)}
            onChange={(e) => {
              setFrom(e.target.value)
              if (!to || e.target.value > to) setTo(e.target.value)
            }}
            className="px-3"
            required
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="leave-to" className="field-label">
            Last day
          </Label>
          <Input
            id="leave-to"
            type="date"
            value={to}
            min={from || addDays(today, -LEAVE_LIMITS.backDays)}
            max={addDays(today, LEAVE_LIMITS.aheadDays)}
            onChange={(e) => setTo(e.target.value)}
            className="px-3"
            required
          />
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        {dateProblem ?? leaveRangeText(from, to)}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="leave-reason" className="field-label">
          Reason
        </Label>
        <Textarea
          id="leave-reason"
          value={reason}
          maxLength={LEAVE_LIMITS.reasonMax}
          onChange={(e) => setReason(e.target.value)}
          placeholder="For example: my sister's wedding in Enugu."
          rows={3}
          required
        />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {sent && <Alert variant="success">Sent. Your supervisor will look at it.</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        <Send className="h-4 w-4" />
        {busy ? 'Sending…' : 'Send request'}
      </Button>
    </form>
  )
}

/** Your requests, newest first, with a way to cancel one still waiting. */
export function LeaveList({ rows }: { rows: LeaveRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cancel(id: string) {
    if (!window.confirm('Cancel this leave request?')) return
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/leave/${id}/cancel`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(body.error ?? 'It could not be cancelled. Try again.')
      else router.refresh()
    } catch {
      setError('No network. Try again when you have signal.')
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) {
    return <p className="surface p-4 text-sm text-muted-foreground">You have not asked for leave yet.</p>
  }
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      {rows.map((r) => (
        <div key={r.id} className="surface flex items-start gap-3 p-3">
          <span className={cn('icon-tile', r.status === 'cancelled' && 'bg-muted text-muted-foreground')}>
            <CalendarDays className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn('text-sm font-bold', r.status === 'cancelled' && 'text-muted-foreground')}>
                {LEAVE_KINDS[r.kind]}
              </p>
              <Badge variant={STATUS_BADGE[r.status]}>{LEAVE_STATUS[r.status]}</Badge>
            </div>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{leaveRangeText(r.from_date, r.to_date)}</p>
            <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">{r.reason}</p>
            {r.decision_note && (
              <p className="mt-1 break-words text-xs text-foreground">
                <span className="font-semibold">Reply:</span> {r.decision_note}
              </p>
            )}
            {r.status === 'pending' && (
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void cancel(r.id)}
                className="mt-2 text-xs font-semibold text-destructive disabled:opacity-50"
              >
                {busy === r.id ? 'Cancelling…' : 'Cancel request'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
