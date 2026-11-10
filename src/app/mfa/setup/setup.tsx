'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { SignOutButton } from '@/components/sign-out-button'

type Enrolment = { factorId: string; qr: string; secret: string }

/**
 * Scan the QR code with an authenticator app (Google Authenticator,
 * Microsoft Authenticator, Authy), then type the code it shows. Supabase
 * keeps the secret; Xtend never stores it.
 */
export function MfaSetup({ alreadyOn, required }: { alreadyOn: boolean; required: boolean }) {
  const router = useRouter()
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (alreadyOn || !started) return
    let cancelled = false
    void (async () => {
      try {
        const client = supabase()
        // A half-finished setup from before is removed first.
        const { data: factors } = await client.auth.mfa.listFactors()
        for (const f of factors?.all ?? []) {
          if (f.factor_type === 'totp' && f.status !== 'verified') await client.auth.mfa.unenroll({ factorId: f.id })
        }
        const { data, error: enrollError } = await client.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `Xtend ${new Date().toISOString().slice(0, 16)}`,
        })
        if (cancelled) return
        if (enrollError || !data) {
          setError('Two-step sign-in could not be started. Try again, or ask an admin.')
          return
        }
        setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
      } catch {
        if (!cancelled) setError('No connection. Try again when you have data.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [alreadyOn, started])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!enrolment) return
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Type the 6 numbers your app shows.')
      return
    }
    setBusy(true)
    try {
      const { error: verifyError } = await supabase().auth.mfa.challengeAndVerify({
        factorId: enrolment.factorId,
        code,
      })
      if (verifyError) {
        setError('That code is not right. Check the time on your phone is automatic, then type the code it shows now.')
        setCode('')
        return
      }
      await fetch('/api/auth/mfa/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'enroll' }),
      }).catch(() => {})
      router.replace('/')
      router.refresh()
    } catch {
      setError('No connection. Try again when you have data.')
    } finally {
      setBusy(false)
    }
  }

  if (alreadyOn) {
    return (
      <div className="space-y-4">
        <Alert>Two-step sign-in is on for your account.</Alert>
        <p className="text-sm text-muted-foreground">
          New phone? Ask an admin to reset your two-step sign-in, then set it up again here.
        </p>
        <Button className="w-full" onClick={() => router.replace('/')}>
          Done
        </Button>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Install an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or Authy.</li>
          <li>Tap Start, then scan the square code with the app.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <Button size="lg" className="w-full" onClick={() => setStarted(true)}>
          Start
        </Button>
        {required ? (
          <SignOutButton className="w-full" />
        ) : (
          <Button variant="ghost" className="w-full" onClick={() => router.back()}>
            Not now
          </Button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      {enrolment ? (
        <>
          <div className="flex justify-center rounded-2xl bg-white p-4">
            {/* Supabase gives the code as an SVG data address; it never leaves this page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolment.qr} alt="Code to scan with your authenticator app" width={200} height={200} />
          </div>
          <details className="text-sm text-muted-foreground">
            <summary>Cannot scan? Type this key into the app instead</summary>
            <code className="mt-2 block break-all rounded-lg bg-muted p-2 font-mono text-foreground">
              {enrolment.secret}
            </code>
          </details>
          <div className="space-y-1.5">
            <Label htmlFor="code">6-digit code from the app</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-2xl tracking-[0.4em]"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Checking…' : 'Turn on two-step sign-in'}
          </Button>
        </>
      ) : (
        !error && <p className="text-center text-sm text-muted-foreground">Preparing your code…</p>
      )}
    </form>
  )
}
