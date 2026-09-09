'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { processReportPhoto } from '@/lib/image'
import { submitOrQueue, PermanentJobError } from '@/lib/offline/sync'

const MAX_PHOTOS = 5

export interface ReportFields {
  body: string
  sales_summary: string
  stock_status: string
  competitor_activity: string
  issues: string
}

const FIELDS: { key: keyof ReportFields; label: string; placeholder: string }[] = [
  { key: 'body', label: 'How the day went', placeholder: 'Footfall, staffing, anything notable.' },
  { key: 'sales_summary', label: 'Sales summary', placeholder: 'Units moved, best sellers, value.' },
  { key: 'stock_status', label: 'Stock status', placeholder: 'What is low, what is out, what arrived.' },
  { key: 'competitor_activity', label: 'Competitor activity', placeholder: 'Promos, new SKUs, price moves.' },
  { key: 'issues', label: 'Issues', placeholder: 'Anything that needs the office to act.' },
]

export function ReportForm({
  existing,
  photosAlready,
}: {
  existing: ReportFields | null
  photosAlready: number
}) {
  const router = useRouter()
  const [fields, setFields] = useState<ReportFields>(
    existing ?? {
      body: '',
      sales_summary: '',
      stock_status: '',
      competitor_activity: '',
      issues: '',
    },
  )
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const remaining = Math.max(0, MAX_PHOTOS - photosAlready - photos.length)

  async function addPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, remaining)
    event.target.value = ''
    setError(null)

    for (const file of files) {
      try {
        const blob = await processReportPhoto(file)
        setPhotos((current) => [...current, { blob, url: URL.createObjectURL(blob) }])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That photo could not be read.')
      }
    }
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].url)
      return current.filter((_, i) => i !== index)
    })
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const result = await submitOrQueue({
        kind: 'report',
        ...fields,
        photos: photos.map((p) => p.blob),
        client_captured_at: new Date().toISOString(),
      })

      setNotice(
        result.queued
          ? 'No data right now. Your report is saved on this phone and will send itself when you get signal.'
          : 'Report saved.',
      )
      setPhotos([])
      router.refresh()
    } catch (err) {
      if (err instanceof PermanentJobError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'That did not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={key}>{label}</Label>
          <Textarea
            id={key}
            value={fields[key]}
            placeholder={placeholder}
            onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="space-y-2">
        <Label>Photos ({photosAlready + photos.length}/{MAX_PHOTOS})</Label>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" className="h-24 w-full rounded-md object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removePhoto(index)}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {remaining > 0 && (
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
            Add photo
            <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
          </label>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? 'Saving…' : existing ? 'Update report' : 'Submit report'}
      </Button>
    </form>
  )
}
