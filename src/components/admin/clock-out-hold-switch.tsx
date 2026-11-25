'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

/**
 * "Hold clock-out until their time" (0111), on a person's day: on, they
 * cannot clock out before their clock-out time; off, they can clock out
 * now. The person is told when it goes off.
 */
export function ClockOutHoldSwitch({
  personId,
  personName,
  hold,
  opensAt,
}: {
  personId: string
  personName: string
  hold: boolean
  /** Their clock-out time, "HH:MM", when known. */
  opensAt: string | null
}) {
  const router = useRouter()
  const [on, setOn] = useState(hold)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = personName.split(' ')[0]

  async function flip() {
    const next = !on
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/clock-out-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: personId, hold: next }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'That did not work. Try again.')
        return
      }
      setOn(next)
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
          <LogOut className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Hold clock-out until their time</h2>
          <p className="text-sm text-muted-foreground">
            {on
              ? `On: ${first} cannot clock out before ${opensAt ?? 'their clock-out time'}. Turn it off to let them clock out now.`
              : `Off: ${first} can clock out now. Turn it on again to hold their clock-out until ${opensAt ?? 'their time'}.`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Hold clock-out until their time"
          disabled={busy}
          onClick={() => void flip()}
          className={cn(
            'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
            on ? 'bg-brand' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'inline-block h-6 w-6 rounded-full bg-white shadow transition-transform',
              on ? 'translate-x-7' : 'translate-x-1',
            )}
          />
        </button>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
    </section>
  )
}
