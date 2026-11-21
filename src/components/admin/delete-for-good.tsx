'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { confirmedFetch } from '@/components/reconfirm'
import { describeRecords, nameMatches, type DeleteKind } from '@/lib/delete-for-good'

/**
 * "Are you sure?" for removing a store or a person that has records (0098).
 * Shows what goes with them, asks for the name to be typed, then deletes
 * everything for good. Deactivating stays the way to keep the records.
 */
export function DeleteForGoodDialog({
  kind,
  id,
  name,
  onClose,
  onDeleted,
  onDeactivate,
}: {
  kind: DeleteKind
  id: string
  name: string
  onClose: () => void
  onDeleted: (message: string) => void
  /** Offered as the safer choice, when it can still be deactivated. */
  onDeactivate?: () => void
}) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const what = kind === 'outlet' ? 'store' : 'person'

  useEffect(() => {
    let live = true
    fetch(`/api/admin/delete-for-good?kind=${kind}&id=${id}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { records?: Record<string, number>; error?: string }
        if (!live) return
        if (!res.ok) {
          setError(body.error ?? 'Could not check what would be deleted.')
          setLines([])
        } else {
          setLines(describeRecords(body.records))
        }
      })
      .catch(() => {
        if (live) {
          setError('Could not reach Xtend. Check your connection and try again.')
          setLines([])
        }
      })
    return () => {
      live = false
    }
  }, [kind, id])

  async function remove(event: React.FormEvent) {
    event.preventDefault()
    if (!nameMatches(typed, name)) return
    setBusy(true)
    setError(null)
    try {
      const res = await confirmedFetch('/api/admin/delete-for-good', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, confirm: typed }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; files_left?: number }
      if (!res.ok) {
        setError(body.error ?? 'That could not be deleted. Try again.')
        return
      }
      onDeleted(
        `${name} was deleted for good, with ${kind === 'outlet' ? 'its' : 'their'} records.` +
          (body.files_left ? ' Some photos are still being removed: finish on System.' : ''),
      )
    } catch {
      setError('Could not reach Xtend. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-for-good-title"
    >
      <form onSubmit={remove} className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="delete-for-good-title" className="font-bold">
              Delete {name} for good?
            </h2>
            <p className="text-sm text-muted-foreground">
              This {what} has records. Are you sure you want to delete {kind === 'outlet' ? 'it' : 'them'}? Everything
              below is removed from Xtend with {kind === 'outlet' ? 'it' : 'them'}, and it cannot be undone.
            </p>
          </div>
        </div>

        {lines === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the records…
          </p>
        ) : lines.length > 0 ? (
          <ul className="space-y-1 rounded-xl bg-destructive/5 p-3 text-sm">
            {lines.map((l) => (
              <li key={l}>• {l}</li>
            ))}
            <li className="text-xs text-muted-foreground">
              {kind === 'staff' ? 'Their photos and sign-in go too.' : 'Photos taken there go too.'} The audit log keeps a note of
              this.
            </li>
          </ul>
        ) : null}

        {kind === 'outlet' && (
          <p className="text-xs text-muted-foreground">
            People based at this store keep their accounts; they just have no home store until you give them one.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Only do this for a {what} added by mistake or for testing. For a real {what}, choose{' '}
          <strong>Deactivate</strong>: the records stay.
        </p>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="delete-for-good-name">
            Type <strong className="select-all">{name}</strong> to confirm
          </Label>
          <Input
            id="delete-for-good-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={busy || lines === null || !nameMatches(typed, name)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {busy ? 'Deleting…' : 'Yes, delete for good'}
          </Button>
          {onDeactivate && (
            <Button type="button" variant="outline" disabled={busy} onClick={onDeactivate}>
              Deactivate instead
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
