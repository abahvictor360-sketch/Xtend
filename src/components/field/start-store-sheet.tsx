'use client'

import Link from 'next/link'
import { BookOpen, MapPin, MessagesSquare, Store, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { haversineMetres } from '@/lib/geo'
import { metres } from '@/lib/utils'
import { STAFF_GUIDE_HREF } from '@/lib/field-guide'

export interface StartStore {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number
}

/**
 * A marketer starts the day at a store (0101). Clock in first matches the
 * store from where they stand (src/lib/start-store-match.ts); this list is
 * shown only when no store of theirs matched (noMatch), to pick the one
 * they are at. Clocking in there checks them in there too. With no stores
 * allocated, it tells them to ask the admin for one: no clock-in until then.
 */
export function StartStoreSheet({
  stores,
  currentFix,
  noMatch = false,
  onPick,
  onClose,
}: {
  stores: StartStore[]
  currentFix: { lat: number; lng: number } | null
  /** Their location matched none of their stores. */
  noMatch?: boolean
  onPick: (store: StartStore) => void
  onClose: () => void
}) {
  const away = (s: StartStore) =>
    currentFix && s.lat !== null && s.lng !== null ? haversineMetres(currentFix.lat, currentFix.lng, s.lat, s.lng) : null
  const sorted = [...stores].sort((a, b) => (away(a) ?? Infinity) - (away(b) ?? Infinity) || a.name.localeCompare(b.name))

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-store-title"
    >
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="icon-tile">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="start-store-title" className="font-bold">
              {stores.length ? 'Pick the store you are at' : 'No store is allocated to you'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {stores.length
                ? noMatch
                  ? 'Your location does not match any of your stores. Pick the store you are at. Clocking in also checks you in there.'
                  : 'Your day starts when you clock in at a store. Clocking in also checks you in there. If you do not clock in at a store, today does not count.'
                : 'Ask your admin to allocate a store to you. You can clock in once a store is allocated.'}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-xl p-1 text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {stores.length > 0 ? (
          <div className="space-y-2">
            {sorted.map((s) => {
              const d = away(s)
              const here = d !== null && d <= s.geofence_radius_m
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick(s)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-tint"
                >
                  <span className={`icon-tile ${here ? '' : 'bg-muted text-muted-foreground'}`}>
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {d === null ? (s.address ?? '') : `${metres(d)} away`}
                    </span>
                  </span>
                  {here && <Badge variant="success">Here</Badge>}
                </button>
              )
            })}
            <p className="rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
              At a store that is not on your list? Message the office its name and its Google Maps link (open the store in
              Google Maps, tap Share, copy the link) so they can add it.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {[
              'Message your admin or supervisor: ask them to allocate your store to you.',
              'Send the names of the stores you visit, and for each one its Google Maps link (open it in Google Maps, tap Share, copy the link), so they can add it.',
              'When a store is allocated to you, come back and clock in.',
            ].map((step, i) => (
              <li key={step} className="flex gap-3 rounded-2xl bg-tint p-3 text-sm text-tint-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap gap-2">
          {stores.length === 0 && (
            <Link href="/field/messages" className="flex-1">
              <Button className="w-full">
                <MessagesSquare className="h-4 w-4" /> Message the admin
              </Button>
            </Link>
          )}
          <Button variant="ghost" onClick={onClose} className={stores.length === 0 ? '' : 'w-full'}>
            {stores.length ? 'Not now' : 'Close'}
          </Button>
        </div>
        <Link href={STAFF_GUIDE_HREF} className="flex items-center justify-center gap-2 text-sm font-semibold text-brand">
          <BookOpen className="h-4 w-4" /> Not sure? Read the staff guide
        </Link>
      </div>
    </div>
  )
}
