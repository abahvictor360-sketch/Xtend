'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatLagos } from '@/lib/utils'
import { LEAVE_KINDS, LEAVE_STATUS, leaveRangeText, type LeaveKind, type LeaveStatus } from '@/lib/schedule'

export interface LeaveItem {
  id: string
  user_id: string
  staff_name: string
  outlet_name: string | null
  kind: LeaveKind
  from_date: string
  to_date: string
  reason: string
  status: LeaveStatus
  decision_note: string
  decided_by_name: string | null
  decided_at: string | null
  created_at: string
}

const BADGE: Record<LeaveStatus, 'warning' | 'success' | 'destructive' | 'outline'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'outline',
}

/** Each request as a card: who, when, why, and Approve / Reject while it waits. */
export function LeaveDecisions({ rows, selfId, today }: { rows: LeaveItem[]; selfId: string; today: string }) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function decide(row: LeaveItem, decision: 'approve' | 'reject') {
    setBusy(row.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/leave/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[row.id] ?? '' }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That decision could not be saved.')
      setNotice(`${row.staff_name}'s leave was ${decision === 'approve' ? 'approved' : 'rejected'}. They have been told.`)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) return <p className="surface p-4 text-sm text-muted-foreground">No leave requests match.</p>

  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {rows.map((r) => (
        <div key={r.id} className="surface space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">{r.staff_name}</p>
              <p className="text-xs text-muted-foreground">{r.outlet_name ?? 'No store'}</p>
            </div>
            <Badge variant={BADGE[r.status]}>{LEAVE_STATUS[r.status]}</Badge>
          </div>
          <p className="text-sm">
            <span className="font-semibold">{LEAVE_KINDS[r.kind]}</span> · {leaveRangeText(r.from_date, r.to_date)}
            {r.status === 'pending' && r.from_date <= today && (
              <span className="ml-1 text-xs font-semibold text-warning">already started</span>
            )}
          </p>
          <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{r.reason}</p>
          <p className="text-xs text-muted-foreground">
            Asked {formatLagos(r.created_at)}
            {r.decided_at &&
              ` · ${r.status === 'approved' ? 'Approved' : 'Rejected'} by ${r.decided_by_name ?? 'the office'} ${formatLagos(r.decided_at)}`}
          </p>
          {r.decision_note && <p className="text-sm"><span className="font-semibold">Note:</span> {r.decision_note}</p>}
          {r.status === 'pending' && r.user_id !== selfId && (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
              <Input
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                maxLength={500}
                placeholder="Note to them (optional)"
                className="h-10 text-sm sm:flex-1"
                aria-label={`Note to ${r.staff_name}`}
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" className="h-10 flex-1" disabled={busy === r.id} onClick={() => void decide(r, 'approve')}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10 flex-1"
                  disabled={busy === r.id}
                  onClick={() => void decide(r, 'reject')}
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
