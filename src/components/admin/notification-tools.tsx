'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, RotateCcw, Send, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatLagos } from '@/lib/utils'
import { isOverdue } from '@/lib/notification-log'

async function call(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'That did not work. Try again.')
  return data
}

export interface ScheduledItem {
  id: string
  title: string
  body: string
  send_at: string
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
  error: string | null
  audienceText: string
  people: number
  byName: string | null
  canManage: boolean
}

/** Notifications waiting to go, with cancel and send now. */
export function ScheduledList({ items, now }: { items: ScheduledItem[]; now: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const at = new Date(now)

  async function act(id: string, action: 'cancel' | 'send_now') {
    setBusy(id)
    setError(null)
    setDone(null)
    try {
      const data = await call(`/api/admin/notifications/scheduled/${id}`, { action })
      setDone(
        action === 'cancel'
          ? 'Cancelled. It will not be sent.'
          : `Sent to ${String(data.delivered ?? 0)} of ${String(data.recipients ?? 0)}.`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}
      <ul className="divide-y divide-border">
        {items.map((s) => {
          const late = s.status === 'scheduled' && isOverdue(s.send_at, at)
          return (
            <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="icon-tile shrink-0">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.body}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatLagos(s.send_at)} · to {s.audienceText} ({s.people}){s.byName ? ` · by ${s.byName}` : ''}
                  </p>
                  {s.status === 'failed' && s.error && <p className="text-[11px] text-destructive">{s.error}</p>}
                  {late && (
                    <p className="text-[11px] text-destructive">
                      This should have gone by now. The five-minute job may not be running: send it now, and tell
                      whoever looks after the server.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                {s.status === 'scheduled' && !late && <Badge variant="default">Waiting</Badge>}
                {late && <Badge variant="destructive">Late</Badge>}
                {s.status === 'sending' && <Badge variant="warning">Sending</Badge>}
                {s.status === 'failed' && <Badge variant="destructive">Not sent</Badge>}
                {s.status === 'scheduled' && s.canManage && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(s.id, 'send_now')}>
                      <Send className="h-3.5 w-3.5" /> Send now
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(s.id, 'cancel')}>
                      <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Send a notification again to the people it did not reach. Checks first how
 * many of them have since turned notifications on.
 */
export function ResendButton({
  notificationId,
  title,
  body,
  url,
  userIds,
}: {
  notificationId: string
  title: string
  body: string
  url: string | null
  userIds: string[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<'idle' | 'checking' | 'confirm' | 'sending' | 'done'>('idle')
  const [ready, setReady] = useState<{ recipients: number; with_devices: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const payload = (preview: boolean) => ({
    title,
    body,
    url,
    audience: 'users',
    user_ids: userIds,
    preview,
    resend_of: notificationId,
  })

  async function check() {
    setStep('checking')
    setError(null)
    try {
      const data = await call('/api/admin/notifications', payload(true))
      setReady({ recipients: Number(data.recipients ?? 0), with_devices: Number(data.with_devices ?? 0) })
      setStep('confirm')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      setStep('idle')
    }
  }

  async function send() {
    setStep('sending')
    setError(null)
    try {
      const data = await call('/api/admin/notifications', payload(false))
      setMessage(`Sent again: ${String(data.delivered ?? 0)} of ${String(data.recipients ?? 0)} got it this time.`)
      setStep('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      setStep('confirm')
    }
  }

  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive">{error}</Alert>}
      {step === 'done' && message ? (
        <Alert variant="success">{message}</Alert>
      ) : step === 'confirm' && ready ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-3 text-sm">
          <span className="flex-1">
            {ready.with_devices === 0
              ? `None of the ${ready.recipients} has notifications on yet. Ask them to turn them on first.`
              : `${ready.with_devices} of the ${ready.recipients} now have notifications on and should get it.`}
          </span>
          <Button size="sm" disabled={ready.with_devices === 0} onClick={() => void send()}>
            <Send className="h-3.5 w-3.5" /> Send again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStep('idle')}>
            Not now
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={step !== 'idle'} onClick={() => void check()}>
          <RotateCcw className="h-3.5 w-3.5" />
          {step === 'checking' || step === 'sending'
            ? 'Checking…'
            : `Send again to the ${userIds.length} who did not get it`}
        </Button>
      )}
    </div>
  )
}
