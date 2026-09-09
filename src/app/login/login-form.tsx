'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      // Staff sign in with an email or a phone number; Supabase needs email.
      const res = await fetch('/api/auth/resolve-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      })
      const { email } = (await res.json()) as { email: string | null }

      if (!email) {
        setError('Those details are not correct.')
        return
      }

      const { error: authError } = await supabase().auth.signInWithPassword({ email, password })
      if (authError) {
        setError('Those details are not correct.')
        return
      }

      const next = params.get('next')
      router.replace(next && next.startsWith('/') ? next : '/')
      router.refresh()
    } catch {
      setError('No connection. Check your data and try again.')
    } finally {
      setBusy(false)
    }
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
          placeholder="you@xpel.ng or 08012345678"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
