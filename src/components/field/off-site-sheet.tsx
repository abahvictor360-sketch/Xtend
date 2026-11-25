'use client'

import Link from 'next/link'
import { BookOpen, MapPin, Navigation, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STAFF_GUIDE_HREF } from '@/lib/field-guide'
import { directionsTo, distanceWords, type OffSite } from '@/lib/on-site'

/**
 * "You are off site" (0106): pops up whenever someone tries to clock in or
 * check in from outside their store, says which store to go to and how far
 * it is, and opens the way there in Google Maps. Nothing goes through until
 * they are there.
 */
export function OffSiteSheet({
  offSite,
  task,
  onRetry,
  onClose,
}: {
  offSite: OffSite | null
  /** "clock in" or "check in". */
  task: string
  onRetry?: () => void
  onClose: () => void
}) {
  if (!offSite) return null
  const { store } = offSite
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="off-site-title"
    >
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <MapPin className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="off-site-title" className="font-bold">
              You are off site
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You are {distanceWords(offSite.distance_m)} from {store.name}. You need to be at the store before you can{' '}
              {task}.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-xl p-1 text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl bg-tint p-4 text-tint-foreground">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Go to</p>
          <p className="mt-1 text-lg font-bold">{store.name}</p>
          {store.address && <p className="text-sm">{store.address}</p>}
        </div>

        <ol className="space-y-2 text-sm">
          {[
            `Go to ${store.name}. Tap Directions to see the way.`,
            'Go inside the store.',
            `Tap I am at the store, then ${task} again.`,
          ].map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <a href={directionsTo(store.lat, store.lng)} target="_blank" rel="noreferrer" className="flex-1">
            <Button className="w-full">
              <Navigation className="h-4 w-4" /> Directions
            </Button>
          </a>
          {onRetry && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                onClose()
                onRetry()
              }}
            >
              I am at the store
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          In the store but still see this? Step near the door or a window so your phone finds you, then try again. If it
          keeps happening, call your supervisor.
        </p>
        <Link href={STAFF_GUIDE_HREF} className="flex items-center justify-center gap-2 text-sm font-semibold text-brand" onClick={onClose}>
          <BookOpen className="h-4 w-4" /> Not sure? Read the staff guide
        </Link>
      </div>
    </div>
  )
}
