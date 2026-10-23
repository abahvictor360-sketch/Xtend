'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Rocket } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ALWAYS_KEPT,
  LIVE_WORDS,
  RESET_CATEGORIES,
  RESET_KEYS,
  RESET_WORD,
  addedBy,
  categoryLabel,
  confirmMatches,
  isEverything,
  resolveCategories,
  type ResetCategoryKey,
  type ResetSummary,
} from '@/lib/system-reset'
import { cn } from '@/lib/utils'

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(json.error ?? 'That did not work. Try again.')
  return json
}

interface FilesState {
  removed: number
  left: number
  failed?: boolean
}

/** Pick what to clear, review it, then type RESET and your password. */
export function ResetPanel() {
  const router = useRouter()
  const [picked, setPicked] = useState<ResetCategoryKey[]>([])
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ summary: ResetSummary; files: FilesState } | null>(null)

  const resolved = useMemo(() => (picked.length ? resolveCategories(picked) : []), [picked])
  const added = useMemo(() => addedBy(picked), [picked])
  const everything = resolved.length > 0 && isEverything(resolved)
  const kept = RESET_CATEGORIES.filter((c) => !resolved.includes(c.key))

  function toggle(key: ResetCategoryKey) {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await post<{ summary: ResetSummary; files: FilesState }>('/api/admin/system/reset', {
        confirm: typed,
        password,
        categories: everything ? ['everything'] : picked,
      })
      setDone(res)
      setPicked([])
      setTyped('')
      setPassword('')
      setStep('choose')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The reset did not run.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Alert variant="success">
          <p className="flex items-start gap-2 font-semibold">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            {done.summary.headline}
          </p>
        </Alert>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {done.summary.lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{l.label}</span>
              <span className="font-semibold tabular-nums">{l.count.toLocaleString('en-NG')}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{done.summary.files}</p>
        {done.files.left > 0 && <FinishFiles left={done.files.left} />}
        <Button variant="outline" onClick={() => setDone(null)}>
          Reset something else
        </Button>
      </div>
    )
  }

  if (step === 'confirm') {
    const ready = confirmMatches(typed, RESET_WORD) && password.length > 0
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            {everything ? 'Everything below will be deleted. Xtend starts completely fresh.' : 'This will be deleted for good'}
          </p>
          <ul className="mt-2 space-y-2">
            {resolved.map((k) => {
              const c = RESET_CATEGORIES.find((x) => x.key === k)!
              return (
                <li key={k} className="text-sm">
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-muted-foreground"> — {c.line}</span>
                  {c.files && <span className="block text-xs text-muted-foreground">Stored files: {c.files}.</span>}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-bold">This stays</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {ALWAYS_KEPT.map((k) => (
              <li key={k}>{k}</li>
            ))}
            {kept.map((c) => (
              <li key={c.key}>
                {c.label}
                {c.key === 'audit' ? ' (with one new row recording this reset)' : ''}
                {resolved.includes('staff') && c.key !== 'audit' ? ' (except what belonged to the staff removed)' : ''}
              </li>
            ))}
          </ul>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !busy) void run()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reset-word">Type {RESET_WORD} to confirm</Label>
            <Input
              id="reset-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={RESET_WORD}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Your password</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={!ready || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {busy ? 'Resetting…' : 'Reset now'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep('choose')}>
              Back
            </Button>
          </div>
          {busy && (
            <p className="text-xs text-muted-foreground">This can take up to a minute. Keep this page open.</p>
          )}
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <label
        className={cn(
          'flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-4',
          everything ? 'border-brand bg-tint' : 'border-border bg-card',
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#d1511a]"
          checked={everything}
          onChange={() => setPicked(everything ? [] : [...RESET_KEYS])}
        />
        <span>
          <span className="block text-sm font-bold">Select everything (start completely fresh)</span>
          <span className="block text-xs text-muted-foreground">
            Only admin accounts, the product list and settings are left.
          </span>
        </span>
      </label>

      <ul className="grid gap-2 md:grid-cols-2">
        {RESET_CATEGORIES.map((c) => {
          const chosen = picked.includes(c.key)
          const by = added.get(c.key)
          const on = chosen || Boolean(by)
          return (
            <li key={c.key}>
              <label
                className={cn(
                  'flex h-full min-h-11 items-start gap-3 rounded-2xl border p-3.5',
                  on ? 'border-brand/50 bg-tint/60' : 'border-border bg-card',
                  by && !chosen ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#d1511a]"
                  checked={on}
                  disabled={Boolean(by) && !chosen}
                  onChange={() => toggle(c.key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.line}</span>
                  {by && !chosen && (
                    <span className="mt-1 block text-xs font-semibold text-brand-deep">
                      Included because you chose {by.map(categoryLabel).join(' and ')}.
                    </span>
                  )}
                  {chosen && c.requires && (
                    <span className="mt-1 block text-xs font-semibold text-brand-deep">{c.requires.note}</span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={resolved.length === 0} onClick={() => setStep('confirm')}>
          Review what will be deleted
        </Button>
        <span className="text-xs text-muted-foreground">
          {resolved.length === 0
            ? 'Nothing chosen yet.'
            : `${resolved.length} of ${RESET_KEYS.length} areas chosen.`}
        </span>
      </div>
    </div>
  )
}

/** Removes the stored files a reset could not finish in one go. */
export function FinishFiles({ left }: { left: number }) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(left)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const res = await post<{ files: FilesState }>('/api/admin/system/reset/files')
      setRemaining(res.files.left)
      if (res.files.left === 0) router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (remaining === 0) return <Alert variant="success">All stored files from the reset are removed.</Alert>
  return (
    <div className="space-y-2">
      <Alert variant="warning">
        {remaining.toLocaleString('en-NG')} stored {remaining === 1 ? 'file is' : 'files are'} still to be removed.
      </Alert>
      <Button variant="outline" disabled={busy} onClick={go}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Finish removing files
      </Button>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  )
}

/** Test mode off, for good. */
export function GoLivePanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = confirmMatches(typed, LIVE_WORDS)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await post('/api/admin/system/go-live', { confirm: typed })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="deep" onClick={() => setOpen(true)}>
        <Rocket className="h-4 w-4" />
        We are live — turn off test mode
      </Button>
    )
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) void go()
      }}
    >
      <Alert variant="warning">
        <p className="font-semibold">This cannot be undone.</p>
        <p className="mt-1">
          Once test mode is off, the Reset card disappears for good and nobody can reset Xtend again, not even an admin.
          Reset the test run first if you have not.
        </p>
      </Alert>
      <div className="space-y-1.5">
        <Label htmlFor="live-words">Type {LIVE_WORDS} to confirm</Label>
        <Input
          id="live-words"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={LIVE_WORDS}
        />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="deep" disabled={!ready || busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Turn off test mode for good
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
