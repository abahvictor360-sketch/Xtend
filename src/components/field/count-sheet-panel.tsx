'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, Upload } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { supabase } from '@/lib/supabase/client'

/** A count sheet already sent today. */
export interface SentSheet {
  id: string
  outlet_name: string
  file_name: string
  created_at: string
}

const ACCEPTED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Counting on paper: download the store's count sheet, fill it in (on the
 * phone, or printed and by pen), and send it back as a PDF or a photo. The
 * file is kept with the store's count for the office to open.
 */
export function CountSheetPanel({
  stores,
  sent,
}: {
  stores: { id: string; name: string }[]
  sent: SentSheet[]
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (stores.length === 0) return null
  const storeName = stores.find((s) => s.id === storeId)?.name ?? 'this store'

  async function send(file: File) {
    setError(null)
    setNotice(null)
    const ext = ACCEPTED[file.type]
    if (!ext) {
      setError('Send the count sheet as a PDF, or a photo of it (JPG or PNG).')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('The count sheet must be smaller than 10 MB.')
      return
    }
    try {
      setBusy('Uploading the sheet')
      const client = supabase()
      const {
        data: { user },
      } = await client.auth.getUser()
      if (!user) throw new Error('You are signed out. Sign in and try again.')
      const path = `${user.id}/count-sheet-${crypto.randomUUID()}.${ext}`
      const upload = await client.storage.from('reports').upload(path, file, { contentType: file.type })
      if (upload.error) throw new Error(upload.error.message)

      setBusy('Sending it')
      const res = await fetch('/api/store-counts/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outlet_id: storeId, path, file_name: file.name }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The sheet could not be sent.')
      setNotice(`Sent the count sheet for ${storeName}.`)
      router.refresh()
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'No connection. Try again when you have data.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-brand" />
          Count on paper
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Download the count sheet, fill it in on your phone or print it and fill it by pen, then
          send it back here as a PDF or a photo.
        </p>
      </div>

      {stores.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="sheet-store">Store</Label>
          <Select id="sheet-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href={`/api/store-counts/template?outlet_id=${storeId}`}
          download
          className={buttonVariants({ variant: 'outline', className: 'h-11' })}
        >
          <Download className="h-4 w-4" />
          Download sheet
        </a>
        <Button type="button" className="h-11" disabled={busy !== null} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" />
          {busy ?? 'Upload filled sheet'}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void send(file)
          }}
        />
      </div>

      {sent.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {sent.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Sent today: {s.outlet_name}, {s.file_name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
