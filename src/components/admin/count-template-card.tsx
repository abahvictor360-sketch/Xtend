'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileSpreadsheet, FileText, Upload } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { formatLagos } from '@/lib/utils'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * The blank count sheet staff download. It is the Xpel stock count sheet
 * (migration 038), built as Excel from the product list and named for the
 * month being counted. Only while no product is on the sheet can an admin
 * upload a PDF to use instead.
 */
export function CountTemplateCard({
  month,
  products,
  current,
  canUpload,
}: {
  /** The month being counted, e.g. "OCTOBER 2026". */
  month: string
  /** How many products are on the Xpel stock count sheet. */
  products: number
  current: { file_name: string; created_at: string } | null
  canUpload: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    setNotice(null)
    if (file.type !== 'application/pdf') {
      setError('The count sheet must be a PDF.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('The count sheet must be smaller than 10 MB.')
      return
    }
    setBusy(true)
    try {
      const client = supabase()
      const {
        data: { user },
      } = await client.auth.getUser()
      if (!user) throw new Error('You are signed out. Sign in and try again.')
      const path = `${user.id}/count-template-${crypto.randomUUID()}.pdf`
      const up = await client.storage.from('reports').upload(path, file, { contentType: 'application/pdf' })
      if (up.error) throw new Error(up.error.message)

      const res = await fetch('/api/admin/count-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, file_name: file.name }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The count sheet could not be saved.')
      setNotice(`"${file.name}" is now the count sheet staff download.`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The count sheet could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  if (products > 0) {
    return (
      <section className="surface flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="h-4 w-4 text-brand" />
            Xpel {month} stock count sheet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {products} products, with barcodes. Staff count them in the app, or download this
            sheet as Excel with their store&apos;s name on it, fill it in and send it back. Each
            month the sheet carries that month&apos;s name.
          </p>
        </div>
        <a
          href="/api/store-counts/template"
          download
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-10' })}
        >
          <Download className="h-4 w-4" />
          Download sheet
        </a>
      </section>
    )
  }

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-brand" />
            Count sheet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {current
              ? `Staff download "${current.file_name}", uploaded ${formatLagos(current.created_at)}, fill it in and send it back from the store count screen.`
              : canUpload
                ? 'Upload your blank count sheet as a PDF. Staff download it from the store count screen, fill it in and send it back.'
                : 'No count sheet has been uploaded yet. An admin uploads it here.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current && (
            <a
              href="/api/store-counts/template"
              download
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-10' })}
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          )}
          {canUpload && (
            <>
              <Button size="sm" className="h-10" disabled={busy} onClick={() => input.current?.click()}>
                <Upload className="h-4 w-4" />
                {busy ? 'Uploading…' : current ? 'Replace sheet' : 'Upload sheet'}
              </Button>
              <input
                ref={input}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void upload(file)
                }}
              />
            </>
          )}
        </div>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
    </section>
  )
}
