'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, ImagePlus, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { processReportPhoto } from '@/lib/image'
import { CameraCapture } from '@/components/field/camera-capture'
import { submitOrQueue, PermanentJobError } from '@/lib/offline/sync'
import { cn } from '@/lib/utils'
import { writtenText } from '@/lib/fields'

const MAX_PHOTOS = 5

export interface ReportFields {
  body: string
  sales_summary: string
  stock_status: string
  competitor_activity: string
  issues: string
}

const SECTIONS: {
  key: keyof ReportFields
  label: string
  hint: string
  placeholder: string
  /** The day, sales and stock must be filled in; the rest may be empty. */
  required: boolean
  max: number
}[] = [
  {
    key: 'body',
    label: 'The day',
    hint: 'How the day went',
    placeholder: 'Footfall, staffing, anything notable.',
    required: true,
    max: 4000,
  },
  {
    key: 'sales_summary',
    label: 'Sales',
    hint: 'What moved',
    placeholder: 'Units sold, best sellers, value.',
    required: true,
    max: 2000,
  },
  {
    key: 'stock_status',
    label: 'Stock',
    hint: 'What is on the shelf',
    placeholder: 'What is low, what is out, what arrived.',
    required: true,
    max: 2000,
  },
  {
    key: 'competitor_activity',
    label: 'Competitors',
    hint: 'What they are doing',
    placeholder: 'Promos, new SKUs, price moves. Leave empty if nothing.',
    required: false,
    max: 2000,
  },
  {
    key: 'issues',
    label: 'Issues',
    hint: 'What needs the office',
    placeholder: 'Anything head office has to act on. Leave empty if nothing.',
    required: false,
    max: 2000,
  },
]

/** The server's own rules (lib/fields.ts), checked before anything is saved. */
const RULES = Object.fromEntries(
  SECTIONS.map((s) => [s.key, writtenText(s.max, s.required ? 10 : 0, `"${s.label}"`)]),
) as Record<keyof ReportFields, ReturnType<typeof writtenText>>

const EMPTY: ReportFields = {
  body: '',
  sales_summary: '',
  stock_status: '',
  competitor_activity: '',
  issues: '',
}

/**
 * One section at a time. Five stacked textareas is a wall on a 360px screen;
 * the chips make it a five-step form that still submits as one report.
 */
export function ReportForm({
  existing,
  photosAlready,
}: {
  existing: ReportFields | null
  photosAlready: number
}) {
  const router = useRouter()
  const [fields, setFields] = useState<ReportFields>(existing ?? EMPTY)
  const [active, setActive] = useState<keyof ReportFields>('body')
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([])
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const remaining = Math.max(0, MAX_PHOTOS - photosAlready - photos.length)
  const section = SECTIONS.find((s) => s.key === active)!
  const filled = SECTIONS.filter((s) => fields[s.key].trim()).length

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

  async function addFromCamera(photo: Blob) {
    setCamera(false)
    setError(null)
    try {
      const blob = await processReportPhoto(photo)
      setPhotos((current) => [...current, { blob, url: URL.createObjectURL(blob) }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be read.')
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
    setError(null)
    setNotice(null)
    // Checked here as the server will: a report saved offline is only sent
    // later, when a refusal would reach nobody.
    for (const s of SECTIONS) {
      const check = RULES[s.key].safeParse(fields[s.key])
      if (!check.success) {
        setActive(s.key)
        setError(check.error.issues[0]?.message ?? `Check "${s.label}".`)
        return
      }
    }
    setBusy(true)

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
          : 'Report saved. You can keep editing it until midnight.',
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
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="field-label">Section</Label>
          <span className="text-[11px] font-semibold text-muted-foreground">
            {filled}/{SECTIONS.length} filled
          </span>
        </div>

        <div className="no-scrollbar -mx-4 flex flex-wrap gap-2 px-4">
          {SECTIONS.map((item) => {
            const done = Boolean(fields[item.key].trim())
            const isActive = item.key === active
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(item.key)}
                aria-pressed={isActive}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all active:scale-95',
                  isActive
                    ? 'bg-brand text-primary-foreground shadow-lift'
                    : 'bg-tint text-tint-foreground',
                )}
              >
                {done && <Check className={cn('h-3 w-3', isActive ? 'text-white' : 'text-brand')} />}
                {item.label}
                {item.required && !done && <span aria-label="required">*</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={active}>
          {section.hint}
          <span className="ml-1 font-normal text-muted-foreground">
            {section.required ? '(required)' : '(optional)'}
          </span>
        </Label>
        <Textarea
          id={active}
          key={active}
          autoFocus
          value={fields[active]}
          placeholder={section.placeholder}
          maxLength={section.max}
          onChange={(e) => setFields((f) => ({ ...f, [active]: e.target.value }))}
          className="min-h-[132px]"
        />
      </div>

      <div className="space-y-2">
        <Label className="field-label">
          Photos ({photosAlready + photos.length}/{MAX_PHOTOS})
        </Label>

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" className="h-24 w-full rounded-2xl object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removePhoto(index)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 shadow-soft"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {remaining > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCamera(true)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-sm font-semibold text-primary-foreground"
            >
              <Camera className="h-4 w-4" />
              Take photo
            </button>
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/35 bg-tint/50 text-sm font-semibold text-brand">
              <ImagePlus className="h-4 w-4" />
              From gallery
              <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
            </label>
          </div>
        )}

        <CameraCapture
          open={camera}
          title="Report photo"
          onCapture={(photo) => void addFromCamera(photo)}
          onClose={() => setCamera(false)}
        />
      </div>

      <Button type="submit" size="xl" className="w-full" disabled={busy}>
        <Send className="h-4 w-4" />
        {busy ? 'Saving…' : existing ? 'Update report' : 'Submit report'}
      </Button>

      <p className="pb-2 text-center text-[11px] text-muted-foreground">
        One report per day. Editable until midnight, not after.
      </p>
    </form>
  )
}
