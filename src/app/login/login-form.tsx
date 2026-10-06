'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      // The server resolves a phone number and signs in, so the email
      // behind a phone number never reaches the browser.
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      if (!res.ok) {
        const { error: message } = (await res.json().catch(() => ({}))) as { error?: string }
        setError(message ?? 'Those details are not correct.')
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
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" size="xl" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  )
}
