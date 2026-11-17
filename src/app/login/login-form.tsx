'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Fingerprint, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { loginDestination } from '@/lib/login-destination'
import { HumanCheck, type HumanCheckHandle } from '@/components/human-check'
import { TURNSTILE_ERROR } from '@/lib/turnstile'
import {
  addPasskey,
  appBiometricAvailable,
  appKeySaved,
  declineOffer,
  devicePasskeyAvailable,
  enrolAppKey,
  offerAllowed,
  passkeysSupported,
  signInWithAppKey,
  signInWithPasskey,
  type QuickResult,
} from '@/lib/quick-sign-in-client'
import { isNativeApp } from '@/lib/native'

/** `humanCheckKey`: Turnstile's site key when the human check is on. */
export function LoginForm({ humanCheckKey }: { humanCheckKey?: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [humanToken, setHumanToken] = useState<string | null>(null)
  const humanCheck = useRef<HumanCheckHandle>(null)
  // Fingerprint (app) or passkey (browser) sign-in, when this device has it (0089).
  const [appKey, setAppKey] = useState(false)
  const [passkey, setPasskey] = useState(false)
  // After a password sign-in: "sign in faster next time?"
  const [offer, setOffer] = useState<'app' | 'passkey' | null>(null)

  useEffect(() => {
    let live = true
    void appKeySaved().then((saved) => live && setAppKey(saved))
    setPasskey(passkeysSupported())
    return () => {
      live = false
    }
  }, [])

  function go() {
    const next = params.get('next')
    router.replace(loginDestination(next))
    router.refresh()
  }

  /** What to offer once signed in with the password, if anything. */
  async function offerAfterPassword(): Promise<'app' | 'passkey' | null> {
    if (!offerAllowed()) return null
    const native = isNativeApp()
    if (native ? !(await appBiometricAvailable()) || (await appKeySaved()) : !(await devicePasskeyAvailable())) {
      return null
    }
    // Only when it can be set up now: switched on (0089 run), and no
    // code step still to do. A browser that already has a passkey is not asked.
    try {
      const res = await fetch('/api/auth/keys')
      if (!res.ok) return null
      const body = (await res.json()) as { available?: boolean; keys?: { kind: string }[] }
      if (!body.available) return null
      if (!native && (body.keys ?? []).some((k) => k.kind === 'passkey')) return null
    } catch {
      return null
    }
    return native ? 'app' : 'passkey'
  }

  async function quick(run: () => Promise<QuickResult>) {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      if (result.ok) return go()
      if (!result.cancelled) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  async function acceptOffer() {
    if (!offer) return
    setBusy(true)
    setError(null)
    const result = offer === 'app' ? await enrolAppKey() : await addPasskey()
    setBusy(false)
    if (result.ok || result.cancelled) return go()
    setError(result.error)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (humanCheckKey && !humanToken) {
      setError(TURNSTILE_ERROR)
      return
    }
    setBusy(true)
    setError(null)

    try {
      // The server resolves a phone number and signs in, so the email
      // behind a phone number never reaches the browser.
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, ...(humanToken ? { turnstile: humanToken } : {}) }),
      })
      // A check token works once: get a fresh one for the next try.
      if (humanCheckKey) humanCheck.current?.reset()
      if (!res.ok) {
        const { error: message } = (await res.json().catch(() => ({}))) as { error?: string }
        setError(message ?? 'Those details are not correct.')
        return
      }

      const toOffer = await offerAfterPassword()
      if (toOffer) {
        setOffer(toOffer)
        return
      }
      go()
    } catch {
      setError('No connection. Check your data and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (offer) {
    const app = offer === 'app'
    return (
      <div className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}
        <div className="flex items-start gap-3">
          <span className="icon-tile">{app ? <Fingerprint className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}</span>
          <div>
            <h2 className="font-bold">Sign in faster next time?</h2>
            <p className="text-sm text-muted-foreground">
              {app
                ? 'Use your fingerprint or face instead of typing your password. Your fingerprint stays on this phone.'
                : 'Add a passkey: next time, sign in with this device’s fingerprint, face or screen lock instead of your password.'}
            </p>
          </div>
        </div>
        <Button size="xl" className="w-full" disabled={busy} onClick={() => void acceptOffer()}>
          {busy ? 'Setting up…' : app ? 'Use my fingerprint' : 'Add a passkey'}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => {
            declineOffer()
            go()
          }}
        >
          {error ? 'Continue' : 'Not now'}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="space-y-1.5">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@xpelbeauty.ng or 08012345678"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="pr-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={() => setShow((v) => !v)}
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {humanCheckKey && <HumanCheck ref={humanCheck} siteKey={humanCheckKey} onToken={setHumanToken} />}

      <Button type="submit" size="xl" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>

      {(appKey || passkey) && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          {appKey && (
            <Button type="button" variant="outline" size="xl" className="w-full" disabled={busy} onClick={() => void quick(signInWithAppKey)}>
              <Fingerprint className="h-5 w-5" />
              Sign in with fingerprint
            </Button>
          )}
          {passkey && (
            <Button type="button" variant="outline" size="xl" className="w-full" disabled={busy} onClick={() => void quick(signInWithPasskey)}>
              <KeyRound className="h-5 w-5" />
              Sign in with a passkey
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
