'use client'

import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

/**
 * "Confirm it is you" before a risky action (zero trust, 0080). The server
 * answers 403 with code 'reconfirm' when the password (and code) were not
 * confirmed in the last 10 minutes; confirmedFetch then opens this box,
 * confirms through /api/auth/reconfirm and sends the action again once.
 */

const EVENT = 'xt-reconfirm'
type Ask = { resolve: (ok: boolean) => void }

/** Opens the box; true once the person confirmed, false if they cancelled. */
export function requestReconfirm(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false)
    window.dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { resolve } }))
  })
}

/** fetch, but a 'reconfirm' refusal asks the person and tries once more. */
export async function confirmedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status !== 403) return res
  const body = (await res.clone().json().catch(() => null)) as { code?: string } | null
  if (body?.code !== 'reconfirm') return res
  if (!(await requestReconfirm())) return res
  return fetch(input, init)
}

/** Mounted once in the dashboard frame. */
export function ReconfirmDialog() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    function onAsk(event: Event) {
      const detail = (event as CustomEvent<Ask>).detail
      setAsk((current) => {
        // Only one box at a time; a second ask waits on the first answer.
        if (current) {
          current.resolve(false)
        }
        return detail
      })
      setPassword('')
      setCode('')
      setNeedCode(false)
      setError(null)
      setTimeout(() => passwordRef.current?.focus(), 0)
    }
    window.addEventListener(EVENT, onAsk)
    return () => window.removeEventListener(EVENT, onAsk)
  }, [])

  function close(ok: boolean) {
    ask?.resolve(ok)
    setAsk(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/auth/reconfirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code: needCode ? code : null }),
      })
      if (res.ok) return close(true)
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (body.code === 'code_needed') {
        if (needCode) setError('That code is not right. Type the code your app shows now.')
        setNeedCode(true)
        setCode('')
        return
      }
      setError(body.error ?? 'That could not be confirmed. Try again.')
    } catch {
      setError('No connection. Try again when you have data.')
    } finally {
      setBusy(false)
    }
  }

  if (!ask) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reconfirm-title">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl bg-background p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="icon-tile">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 id="reconfirm-title" className="font-bold">
              Confirm it is you
            </h2>
            <p className="text-sm text-muted-foreground">This change needs your password again.</p>
          </div>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="space-y-1.5">
          <Label htmlFor="reconfirm-password">Your password</Label>
          <Input
            id="reconfirm-password"
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {needCode && (
          <div className="space-y-1.5">
            <Label htmlFor="reconfirm-code">6-digit code from your authenticator app</Label>
            <Input
              id="reconfirm-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-xl tracking-[0.4em]"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Confirm'}
          </Button>
        </div>
      </form>
    </div>
  )
}
