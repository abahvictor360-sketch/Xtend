'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { SignOutButton } from '@/components/sign-out-button'

/** Checks the 6-digit code; the session then counts as two-step (aal2). */
export function MfaChallenge() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Type the 6 numbers your app shows.')
      return
    }
    setBusy(true)
    try {
      const client = supabase()
      const { data: factors, error: listError } = await client.auth.mfa.listFactors()
      const factor = factors?.totp.find((f) => f.status === 'verified')
      if (listError || !factor) {
        setError('Two-step sign-in is not set up on this account. Ask an admin for help.')
        return
      }
      const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (verifyError) {
        setError('That code is not right, or it has changed. Type the code your app shows now.')
        setCode('')
        return
      }
      await fetch('/api/auth/mfa/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'verify' }),
      }).catch(() => {})
      router.replace('/')
      router.refresh()
    } catch {
      setError('No connection. Try again when you have data.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="space-y-1.5">
        <Label htmlFor="code">6-digit code</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center text-2xl tracking-[0.4em]"
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Checking…' : 'Continue'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Lost your phone or changed it? Ask an admin to reset your two-step sign-in.
      </p>
      <SignOutButton className="w-full" />
    </form>
  )
}
