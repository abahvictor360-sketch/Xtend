'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Flag, ImageOff, MapPin, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatLagos, metres } from '@/lib/utils'
import { PHOTO_FLAG_LABEL, PHOTO_FLAG_REASONS, type PhotoFlagReason } from '@/lib/photo-flags'

export type PhotoEvent = 'clock_in' | 'clock_out' | 'check_in' | 'check_out'

/** One photo of a person's day, with where and when it was taken. */
export interface DayPhoto {
  /** The stored path (the full photo): what a flag is about. Null once deleted. */
  path: string | null
  /** A short-lived link to the full photo; null when it cannot be shown. */
  url: string | null
  event: PhotoEvent
  at: string
  /** The store the event is about, when there is one. */
  store: string | null
  /** Where the phone was: premises name and street, or coordinates. */
  where: string | null
  distance_m: number | null
  radius_m: number | null
  /** on_site, off_site or flagged (location too rough). */
  status: string | null
  lat: number | null
  lng: number | null
  /** By the office (0090): no photo, no place of their own. */
  byOffice?: boolean
  flag: { reason: PhotoFlagReason; note: string | null } | null
}

export const EVENT_TITLE: Record<PhotoEvent, string> = {
  clock_in: 'Clock-in',
  clock_out: 'Clock-out',
  check_in: 'Store check-in',
  check_out: 'Store check-out',
}

const PLACE: Record<string, { text: string; good: boolean }> = {
  on_site: { text: 'At the store', good: true },
  off_site: { text: 'Away from the store', good: false },
  flagged: { text: 'Location too rough', good: false },
}

/**
 * Every photo of the day, large, by location: the clock-in and clock-out
 * selfies and each store check-in and check-out. An admin, or the
 * person's supervisor, flags one that is not right (0092); the flag goes to
 * Integrity like the automatic ones. Staff are never told.
 */
export function DayPhotoGallery({ photos, canFlag }: { photos: DayPhoto[]; canFlag: boolean }) {
  if (!photos.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No clock-in, clock-out or store visit on this day, so no photos.
      </p>
    )
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {photos.map((p, i) => (
        <PhotoCard key={`${p.event}-${p.at}-${i}`} photo={p} canFlag={canFlag} />
      ))}
    </ul>
  )
}

function PhotoCard({ photo, canFlag }: { photo: DayPhoto; canFlag: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<PhotoFlagReason>(photo.flag?.reason ?? 'not_them')
  const [note, setNote] = useState(photo.flag?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const place = photo.status ? PLACE[photo.status] : null
  const flagged = Boolean(photo.flag)

  async function send(method: 'POST' | 'DELETE') {
    if (!photo.path) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/photo-flags', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'POST' ? { path: photo.path, reason, note } : { path: photo.path }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That did not save.')
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft',
        flagged ? 'border-destructive ring-2 ring-destructive/30' : 'border-border',
      )}
    >
      <div className="relative aspect-[4/5] w-full bg-muted sm:aspect-[3/4]">
        {photo.url ? (
          <a href={photo.url} target="_blank" rel="noreferrer" className="block h-full w-full" title="Open the full photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={`${EVENT_TITLE[photo.event]} photo at ${formatLagos(photo.at, false)}`}
              className="h-full w-full object-cover"
            />
          </a>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            {photo.byOffice
              ? 'Recorded by the office: no photo.'
              : photo.path
                ? 'The photo could not be opened.'
                : 'No photo. Photos are kept for 14 days; store check-outs have one from November 2026.'}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">
          {EVENT_TITLE[photo.event]} · {formatLagos(photo.at, false)}
        </span>
        {flagged && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-xs font-semibold text-white">
            <Flag className="h-3 w-3" /> Flagged
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{photo.store ?? 'No store'}</span>
          {place && <Badge variant={place.good ? 'success' : 'destructive'}>{place.text}</Badge>}
        </div>
        {photo.where && (
          <p className="flex gap-1 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{photo.where}</span>
          </p>
        )}
        <p className="text-xs">
          {photo.distance_m != null
            ? `${metres(photo.distance_m)} from the store${photo.radius_m ? ` (allowed ${photo.radius_m} m)` : ''}`
            : 'No store to measure from'}
          {photo.lat != null && photo.lng != null && (
            <>
              {' · '}
              <a
                href={`https://www.google.com/maps?q=${photo.lat},${photo.lng}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand hover:underline"
              >
                Map
              </a>
            </>
          )}
        </p>

        {flagged && !open && (
          <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <span className="font-semibold">{PHOTO_FLAG_LABEL[photo.flag!.reason]}</span>
            {photo.flag!.note ? `: ${photo.flag!.note}` : ''}
          </p>
        )}

        {canFlag && photo.path && !open && (
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant={flagged ? 'outline' : 'outline'} onClick={() => setOpen(true)}>
              <Flag className="h-3.5 w-3.5" /> {flagged ? 'Change the flag' : 'Flag this photo'}
            </Button>
            {flagged && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send('DELETE')}>
                <X className="h-3.5 w-3.5" /> Remove flag
              </Button>
            )}
          </div>
        )}

        {open && (
          <form
            className="mt-1 space-y-2 rounded-xl border border-border p-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              void send('POST')
            }}
          >
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs font-semibold">What is wrong with this photo?</legend>
              {PHOTO_FLAG_REASONS.map((r) => (
                <label key={r} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`reason-${photo.path}`}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  {PHOTO_FLAG_LABEL[r]}
                </label>
              ))}
            </fieldset>
            <Textarea
              aria-label="Note"
              rows={2}
              maxLength={300}
              placeholder={reason === 'other' ? 'Say what is wrong (needed)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy || (reason === 'other' && !note.trim())}>
                {busy ? 'Saving…' : 'Flag it'}
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              It goes to Integrity with the other flags. The person is not told.
            </p>
          </form>
        )}
        {error && !open && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </li>
  )
}
