'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmedFetch } from '@/components/reconfirm'
import { downloadUrl } from '@/lib/save-file'

const SHEET = '/api/admin/staff-logins'

/**
 * The staff login sheet (Word, migration 041). It holds temporary
 * passwords, so the server asks for the password again first (0080): a
 * check call lets the "confirm it is you" box open, then the sheet is a
 * plain download, which browsers and the Android app both save.
 */
export function StaffLoginsButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const res = await confirmedFetch(`${SHEET}?check=1`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'The login sheet could not be made. Try again.')
        return
      }
      downloadUrl(SHEET)
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
