'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Smartphone } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Requires the phone app for every active merchandiser and marketer, or lets
 * them use a browser again, in one go (migration 0084). One person at a time
 * is the button on their own row. Admins only.
 */
export function AppOnlyBulk() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function apply(value: boolean) {
    if (
      value &&
      !confirm(
        'Make every merchandiser and marketer use the Xtend app only? They can no longer sign in or use Xtend in a browser, and are told to download the app. Office accounts are not affected.',
      )
    )
      return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/app-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, role: 'all' }),
      })
      const json = (await res.json().catch(() => ({}))) as { changed?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That did not save. Try again.')
      const n = json.changed ?? 0
      setMessage(
        value
          ? `${n} ${n === 1 ? 'person now uses' : 'people now use'} the app only.`
          : `${n} ${n === 1 ? 'person can' : 'people can'} use a browser again.`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void apply(true)}>
        <Smartphone className="h-4 w-4" />
        Require the app for all field staff
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void apply(false)}>
        Allow the web again
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  )
}
