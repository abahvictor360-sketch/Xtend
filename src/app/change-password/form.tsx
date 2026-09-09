'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'

const MIN_LENGTH = 8

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const client = supabase()
      const { error: authError } = await client.auth.updateUser({ password })
      if (authError) {
        setError(authError.message)
        return
      }

      const {
        data: { user },
      } = await client.auth.getUser()
      if (user) {
        await client.from('profiles').update({ must_change_password: false }).eq('id', user.id)
      }

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
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm">Repeat it</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </Button>

      {!forced && (
        <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()}>
          Cancel
        </Button>
      )}
    </form>
  )
}
