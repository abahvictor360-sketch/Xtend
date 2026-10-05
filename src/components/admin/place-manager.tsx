'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BadgeCheck,
  ExternalLink,
  Image as ImageIcon,
  MapPinned,
  Search,
  Store,
  Trash2,
} from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { cn, formatLagos } from '@/lib/utils'

export interface KnownPlace {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  radius_m: number
  source: 'google' | 'osm' | 'staff' | 'admin' | 'clock_in'
  verified: boolean
  times_seen: number
  created_at: string
  last_seen_at: string
  named_by_name: string | null
  /** From migration 025; absent before it. */
  photo_path?: string | null
  visitor_count?: number | null
  only_namer_visits?: boolean | null
  /** Stores waiting for a location that this spot could be (034). */
  candidate_stores?: { id: string; name: string }[] | null
  /** Who has clocked in or checked in here (034). */
  visitor_names?: string[] | null
}

export interface WaitingStore {
  id: string
  name: string
  address: string | null
}

const SOURCE: Record<KnownPlace['source'], string> = {
  google: 'Named by Google',
  osm: 'Named by OpenStreetMap',
  staff: 'Named by staff',
  admin: 'Added by an admin',
  clock_in: 'Seen at a clock-in',
}

export function PlaceManager({
  places,
  photoUrls = {},
  waitingStores = [],
}: {
  places: KnownPlace[]
  /** Signed links to the shop-front photos, by storage path. */
  photoUrls?: Record<string, string>
  /** Stores with no location yet, which a place can be confirmed as. */
  waitingStores?: WaitingStore[]
}) {
  const router = useRouter()
  // Spots staff clocked in at that could be a store waiting for its location.
  const toPin = places.filter((p) => (p.candidate_stores ?? []).length > 0)
  const [filter, setFilter] = useState<'stores' | 'check' | 'all'>(
    toPin.length > 0 ? 'stores' : 'check',
  )
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Staff-typed names that nobody has checked yet come first.
  const toCheck = places.filter((p) => !p.verified && p.source === 'staff')
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (filter === 'stores' ? toPin : filter === 'check' ? toCheck : places).filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        (p.address ?? '').toLowerCase().includes(needle),
    )
  }, [filter, places, search, toCheck, toPin])

  async function call(id: string, url: string, method: string, body?: unknown, done?: string) {
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That change could not be saved.')
      if (done) setNotice(done)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  if (places.length === 0) {
    return (
      <Alert variant="info">
        No places learned yet. They appear here as staff clock in and check in at places that are
        not one of your stores.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(toPin.length > 0 || waitingStores.length > 0) && (
          <Chip active={filter === 'stores'} onClick={() => setFilter('stores')}>
            Store locations to confirm ({toPin.length})
          </Chip>
        )}
        <Chip active={filter === 'check'} onClick={() => setFilter('check')}>
          Names to check ({toCheck.length})
        </Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All places ({places.length})
        </Chip>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a place"
            className="h-9 pl-9 text-sm"
            aria-label="Find a place"
          />
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <ul className="space-y-3">
        {visible.map((p) => {
          const draft = names[p.id] ?? p.name
          const photo = p.photo_path ? photoUrls[p.photo_path] : undefined
          // Somebody's house, named as a shop, is visited by nobody else.
          const suspect = !p.verified && p.only_namer_visits && p.times_seen >= 3
          // The stores this spot could be first, then any other waiting store.
          const candidates = p.candidate_stores ?? []
          const storeOptions = [
            ...candidates,
            ...waitingStores.filter((w) => !candidates.some((c) => c.id === w.id)),
          ]
          const pick = picks[p.id] ?? (candidates.length === 1 ? candidates[0].id : '')
          const pickName = storeOptions.find((o) => o.id === pick)?.name
          return (
            <li key={p.id} className="rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {p.name}
                    {p.verified && (
                      <BadgeCheck className="h-4 w-4 text-brand" aria-label="Verified" />
                    )}
                  </p>
                  {p.address && <p className="text-xs text-muted-foreground">{p.address}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {SOURCE[p.source]}
                    {p.named_by_name ? ` (${p.named_by_name})` : ''} · seen {p.times_seen}{' '}
                    {p.times_seen === 1 ? 'time' : 'times'} · last {formatLagos(p.last_seen_at)} ·{' '}
                    {p.radius_m} m around
                    {p.visitor_count != null &&
                      ` · ${p.visitor_count} ${p.visitor_count === 1 ? 'person' : 'people'}`}
                  </p>
                  {(p.visitor_names ?? []).length > 0 && p.source === 'clock_in' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Clocked in here: {(p.visitor_names ?? []).join(', ')}
                    </p>
                  )}
                  {suspect && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Only ever used by the person who named it. Check the photo before verifying.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {photo && (
                    <a
                      href={photo}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold text-brand"
                    >
                      Photo of the place <ImageIcon className="h-3 w-3" />
                    </a>
                  )}
                  <a
                    href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-semibold text-brand"
                  >
                    See on map <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {storeOptions.length > 0 && (candidates.length > 0 || p.source === 'clock_in') && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2">
                  <select
                    value={pick}
                    onChange={(e) => setPicks((m) => ({ ...m, [p.id]: e.target.value }))}
                    className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label={`Which store is at ${p.name}`}
                  >
                    <option value="">Which store is this?</option>
                    {candidates.length > 0 && (
                      <optgroup label="Allocated to whoever clocked in here">
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {storeOptions.length > candidates.length && (
                      <optgroup label="Other stores with no location">
                        {storeOptions.slice(candidates.length).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button
                    size="sm"
                    className="h-9"
                    disabled={busy === p.id || !pick}
                    onClick={() => {
                      if (
                        !confirm(
                          `Is this where ${pickName} is? Check the map first. Clock-ins there will be measured against this spot from now on.`,
                        )
                      )
                        return
                      void call(
                        p.id,
                        `/api/admin/places/${p.id}/pin`,
                        'POST',
                        { outlet_id: pick },
                        `${pickName} now has its location.`,
                      )
                    }}
                  >
                    <MapPinned className="h-4 w-4" />
                    Confirm store location
                  </Button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))}
                  maxLength={120}
                  className="h-9 min-w-[12rem] flex-1 text-sm"
                  aria-label={`Name for ${p.name}`}
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={busy === p.id || draft.trim().length < 2}
                  onClick={() =>
                    call(
                      p.id,
                      `/api/admin/places/${p.id}`,
                      'PATCH',
                      { name: draft.trim(), verified: true },
                      `"${draft.trim()}" is verified.`,
                    )
                  }
                >
                  <BadgeCheck className="h-4 w-4" />
                  {draft.trim() === p.name
                    ? p.verified
                      ? 'Verified'
                      : 'Verify'
                    : 'Save and verify'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={busy === p.id}
                  onClick={() => {
                    if (
                      !confirm(
                        `Make "${p.name}" one of your stores? Staff can then be allocated to it.`,
                      )
                    )
                      return
                    void call(
                      p.id,
                      `/api/admin/places/${p.id}/store`,
                      'POST',
                      {},
                      `"${p.name}" is now a store.`,
                    )
                  }}
                >
                  <Store className="h-4 w-4" />
                  Make it a store
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn('h-9 text-destructive')}
                  disabled={busy === p.id}
                  onClick={() => {
                    if (!confirm(`Forget "${p.name}"?`)) return
                    void call(
                      p.id,
                      `/api/admin/places/${p.id}`,
                      'DELETE',
                      undefined,
                      `"${p.name}" was removed.`,
                    )
                  }}
                  aria-label={`Remove ${p.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          )
        })}
        {visible.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            {filter === 'stores'
              ? waitingStores.length > 0
                ? `${waitingStores.length} ${waitingStores.length === 1 ? 'store is' : 'stores are'} waiting for a location. Spots appear here when staff allocated to them clock in.`
                : 'Every store has its location.'
              : filter === 'check'
                ? 'No names waiting to be checked.'
                : 'No place matches.'}
          </li>
        )}
      </ul>
    </div>
  )
}
