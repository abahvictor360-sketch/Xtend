'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/** "Tell the supervisor after N minutes with location off" (migration 0115). */
export function LocationOffSetting({ minutes }: { minutes: number | null }) {
  const router = useRouter()
  const [value, setValue] = useState(String(minutes ?? 15))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (minutes === null) return <p className="text-xs text-muted-foreground">Run migration 0115 in Supabase to use this.</p>

  async function save() {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0 || n > 600) {
      setMessage({ ok: false, text: 'Give the minutes as a number from 0 to 600.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/location-off', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: n }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'It could not be saved.')
      setMessage({ ok: true, text: n === 0 ? 'Saved. Nobody is told; it still shows here.' : `Saved. Told after ${n} minutes.` })
      router.refresh()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'It could not be saved.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="loc-off-min" className="text-xs font-medium">
            Tell their supervisor after this many minutes (0: never)
          </label>
          <input
            id="loc-off-min"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))}
            className="h-10 w-28 rounded-lg border border-border bg-background px-3"
          />
        </div>
        <Button type="button" variant="secondary" className="h-10" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {message && <p className={message.ok ? 'text-success' : 'text-destructive'}>{message.text}</p>}
    </div>
  )
}
