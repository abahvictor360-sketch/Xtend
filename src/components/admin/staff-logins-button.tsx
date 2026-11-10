'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmedFetch } from '@/components/reconfirm'

/**
 * The staff login sheet (Word, migration 041). It holds temporary
 * passwords, so the server asks for the password again first (0080):
 * fetched here so the "confirm it is you" box can open, then saved.
 */
export function StaffLoginsButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const res = await confirmedFetch('/api/admin/staff-logins')
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'The login sheet could not be made. Try again.')
        return
      }
      const blob = await res.blob()
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Xtend-staff-login-details.docx'
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('No connection. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void download()}>
        <FileText className="h-4 w-4" />
        {busy ? 'Making the sheet…' : 'Login details (Word)'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
