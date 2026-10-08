'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookmarkPlus, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Keeps this check on the person's record, with an optional note. */
export function SaveExcuseCheck({ userId, claim, from, to }: { userId: string; claim: string; from: string; to: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (saved) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-deep">
        <Check className="h-4 w-4" /> Kept on their record.
      </p>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const res = await fetch('/api/admin/excuses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, claim, from, to, note }),
          })
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) throw new Error(data.error ?? 'It could not be kept')
          setSaved(true)
          router.refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'It could not be kept')
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note (optional): what they said, what you decided"
        className="h-9 min-w-64 flex-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
        Keep on record
      </Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </form>
  )
}
