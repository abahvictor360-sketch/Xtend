'use client'

import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { formatLagos } from '@/lib/utils'
import { isNativeApp } from '@/lib/native'
import {
  addPasskey,
  appBiometricAvailable,
  appKeySaved,
  disableAppKey,
  enrolAppKey,
  passkeysSupported,
} from '@/lib/quick-sign-in-client'

interface Key {
  id: string
  kind: 'passkey' | 'app'
  label: string
  created_at: string
  last_used_at: string | null
}

/**
 * "Fingerprint and passkeys" (0089): turn fingerprint sign-in on or off for
 * this phone (in the app), add a passkey (in a browser), and see and remove
 * every one the account has. Shown on the staff You page and the office's
 * sign-in page.
 */
export function QuickSignInSettings() {
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [native, setNative] = useState(false)
  const [canFingerprint, setCanFingerprint] = useState(false)
  const [onThisPhone, setOnThisPhone] = useState(false)
  const [canPasskey, setCanPasskey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/keys', { cache: 'no-store' })
      const body = (await res.json()) as { keys?: Key[]; available?: boolean }
      setKeys(body.keys ?? [])
      setAvailable(body.available !== false)
    } catch {
      setKeys([])
    }
    setOnThisPhone(await appKeySaved())
  }, [])

  useEffect(() => {
    setNative(isNativeApp())
    setCanPasskey(passkeysSupported())
    void appBiometricAvailable().then(setCanFingerprint)
    void load()
  }, [load])

  async function act(run: () => Promise<{ ok: boolean; error?: string; cancelled?: boolean } | void>, done: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await run()
      if (result && !result.ok) {
        if (!result.cancelled) setError(result.error ?? 'That did not work. Try again.')
      } else {
        setNotice(done)
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(key: Key) {
    if (!confirm(`Remove sign-in with ${key.kind === 'app' ? 'fingerprint' : 'passkey'} on ${key.label}?`)) return
    await act(async () => {
      const res = await fetch(`/api/auth/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' })
      if (!res.ok) return { ok: false, error: 'That could not be removed. Try again.' }
    }, 'Removed. That device now needs your password.')
  }

  if (!available) return null

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="icon-tile">
          <Fingerprint className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold">Fingerprint and passkeys</p>
          <p className="text-xs text-muted-foreground">
            Sign in with your fingerprint, face or screen lock instead of your password. Your fingerprint
            never leaves your device. Your password still works.
          </p>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {native ? (
        canFingerprint ? (
          onThisPhone ? (
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void act(disableAppKey, 'Fingerprint sign-in is off for this phone.')}>
              Turn off fingerprint sign-in on this phone
            </Button>
          ) : (
            <Button className="w-full" disabled={busy} onClick={() => void act(enrolAppKey, 'Fingerprint sign-in is on. Use it next time you sign in.')}>
              <Fingerprint className="h-4 w-4" />
              Turn on fingerprint sign-in
            </Button>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            This phone has no fingerprint or face unlock set up. Add one in the phone&apos;s settings, then come back.
          </p>
        )
      ) : canPasskey ? (
        <Button className="w-full" disabled={busy} onClick={() => void act(addPasskey, 'Passkey added. Use it next time you sign in.')}>
          <KeyRound className="h-4 w-4" />
          Add a passkey for this device
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">This browser cannot use passkeys.</p>
      )}

      {keys && keys.length > 0 && (
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2">
              {k.kind === 'app' ? (
                <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{k.label || (k.kind === 'app' ? 'Xtend app' : 'Passkey')}</span>
                <span className="block text-xs text-muted-foreground">
                  {k.kind === 'app' ? 'Fingerprint in the app' : 'Passkey'} · added {formatLagos(k.created_at)}
                  {k.last_used_at ? ` · last used ${formatLagos(k.last_used_at)}` : ''}
                </span>
              </span>
              <button
                type="button"
                aria-label="Remove"
                disabled={busy}
                onClick={() => void remove(k)}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-tint hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
