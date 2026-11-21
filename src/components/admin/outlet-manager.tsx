'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock3, Crosshair, ExternalLink, Link2, Loader2, MapPin, MapPinned, Plus, Radius, Search, Store, Trash2, Users, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Outlet } from '@/lib/types'
import { address, thingName } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'
import { mapsLink, readMapLink } from '@/lib/map-link'

interface FoundPlace {
  name: string | null
  address: string | null
  lat: number
  lng: number
  source: 'google_places' | 'google_geocode' | 'osm'
}

interface Draft {
  name: string
  address: string
  lat: string
  lng: string
  geofence_radius_m: string
  shift_start: string
  shift_end: string
}

const EMPTY: Draft = {
  name: '',
  address: '',
  lat: '',
  lng: '',
  geofence_radius_m: '150',
  shift_start: '08:00',
  shift_end: '18:00',
}

export function OutletManager({
  outlets,
  staffCounts,
  readOnly = false,
}: {
  outlets: Outlet[]
  staffCounts: Record<string, number>
  /** Supervisors see the stores but cannot add or change them. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<FoundPlace[] | null>(null)
  const [mapLink, setMapLink] = useState('')
  const [readingLink, setReadingLink] = useState(false)
  const [pinNote, setPinNote] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const shown = q
    ? outlets.filter(
        (o) => o.name.toLowerCase().includes(q) || (o.address ?? '').toLowerCase().includes(q),
      )
    : outlets

  /**
   * Standing in the shop is the most accurate way there is to place a
   * geofence — better than any geocoder — so this also asks what the
   * place is called and fills the name and address in, leaving only the
   * radius to confirm.
   */
  function useMyLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        setDraft((d) => ({
          ...d,
          lat: latitude.toFixed(6),
          lng: longitude.toFixed(6),
        }))
        if (accuracy > 100) {
          setError(
            `Your location is only accurate to ${Math.round(accuracy)} m. Step outside and try again, or the fence will be in the wrong place.`,
          )
        }
        try {
          const res = await fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`)
          if (res.ok) {
            const place = (await res.json()) as { name: string | null; address: string | null }
            setDraft((d) => ({
              ...d,
              name: d.name || (place.name ?? ''),
              address: d.address || (place.address ?? ''),
            }))
          }
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        setError('Could not read your location. Type the coordinates instead.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  function clearMapHelp() {
    setFound(null)
    setMapLink('')
    setPinNote(null)
  }

  function placePin(lat: number, lng: number, note: string) {
    setDraft((d) => ({ ...d, lat: lat.toFixed(6), lng: lng.toFixed(6) }))
    setPinNote(note)
  }

  /** Searches Google Maps (then OpenStreetMap) for the address typed. */
  async function findOnMap() {
    const query = [draft.name, draft.address].map((x) => x.trim()).filter(Boolean).join(', ')
    if (query.length < 3) {
      setError('Type the store\'s address first, then press Find on map.')
      return
    }
    setFinding(true)
    setError(null)
    setFound(null)
    try {
      let res = await fetch('/api/admin/outlets/locate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      let body = (await res.json().catch(() => ({}))) as { places?: FoundPlace[]; error?: string }
      // Nothing for name + address together: try the address alone.
      if (res.ok && !body.places?.length && draft.name.trim() && draft.address.trim()) {
        res = await fetch('/api/admin/outlets/locate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: draft.address.trim() }),
        })
        body = (await res.json().catch(() => ({}))) as { places?: FoundPlace[]; error?: string }
      }
      if (!res.ok || !body.places?.length) {
        setError(body.error ?? 'No place found for that address. Add the area and city, or paste a Google Maps link.')
        return
      }
      if (body.places.length === 1) {
        pick(body.places[0])
      } else {
        setFound(body.places)
      }
    } catch {
      setError('Could not reach the map. Check your connection and try again.')
    } finally {
      setFinding(false)
    }
  }

  function pick(place: FoundPlace) {
    placePin(place.lat, place.lng, `Pinned at ${place.name ?? place.address ?? 'the place found'}. Check it on Google Maps before saving.`)
    setDraft((d) => ({
      ...d,
      address: d.address.trim() ? d.address : (place.address ?? ''),
      name: d.name.trim() ? d.name : (place.name ?? ''),
    }))
    setFound(null)
  }

  /** Reads the position out of a pasted Google Maps link or "lat, lng". */
  async function applyMapLink(text = mapLink) {
    const value = text.trim()
    if (!value) return
    setError(null)
    setFound(null)
    // Most links carry the position: no need to ask the server.
    const local = readMapLink(value)
    if (local.point) {
      placePin(local.point.lat, local.point.lng, 'Position taken from the link. Check it on Google Maps before saving.')
      return
    }
    setReadingLink(true)
    try {
      const res = await fetch('/api/admin/outlets/locate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: value }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        point?: { lat: number; lng: number } | null
        places?: FoundPlace[]
        error?: string
      }
      if (body.point) {
        placePin(body.point.lat, body.point.lng, 'Position taken from the link. Check it on Google Maps before saving.')
      } else if (body.places?.length === 1) {
        pick(body.places[0])
      } else if (body.places?.length) {
        setFound(body.places)
      } else {
        setError(body.error ?? 'No position in that link.')
      }
    } catch {
      setError('Could not read that link. Check your connection and try again.')
    } finally {
      setReadingLink(false)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const problem =
      problemWith(thingName(160, 'store name'), draft.name) ?? problemWith(address, draft.address)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)

    const payload = {
      name: draft.name,
      address: draft.address || null,
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      geofence_radius_m: Number(draft.geofence_radius_m),
      shift_start: draft.shift_start,
      shift_end: draft.shift_end,
    }

    try {
      const res = await fetch(editing ? `/api/admin/outlets/${editing}` : '/api/admin/outlets', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That outlet did not save.')
        return
      }
      setDraft(EMPTY)
      setAdding(false)
      clearMapHelp()
      setEditing(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(outlet: Outlet) {
    setBusy(true)
    try {
      await fetch(`/api/admin/outlets/${outlet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !outlet.is_active }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(outlet: Outlet) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/outlets/${outlet.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'That outlet could not be deleted.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  function edit(outlet: Outlet) {
    clearMapHelp()
    setEditing(outlet.id)
    setAdding(true)
    setDraft({
      name: outlet.name,
      address: outlet.address ?? '',
      lat: outlet.lat?.toString() ?? '',
      lng: outlet.lng?.toString() ?? '',
      geofence_radius_m: String(outlet.geofence_radius_m),
      shift_start: outlet.shift_start.slice(0, 5),
      shift_end: outlet.shift_end.slice(0, 5),
    })
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
      {outlets.length > 4 && (
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search outlets by name or address"
            className="h-11 bg-card pl-9"
            aria-label="Search outlets"
          />
        </div>
      )}
      {!readOnly && (
        <Button
          className="h-11"
          onClick={() => {
            setAdding((a) => !a)
            setEditing(null)
            setDraft(EMPTY)
            clearMapHelp()
          }}
          variant={adding ? 'outline' : 'default'}
        >
          <Plus className="h-4 w-4" />
          {adding ? 'Cancel' : 'Add outlet'}
        </Button>
      )}
      </div>

      {adding && !readOnly && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 lg:col-span-2">
                <Label>Name</Label>
                <Input
                  required
                  maxLength={160}
                  placeholder="Justrite Ogba"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Address</Label>
                <div className="flex gap-2">
                  <Input
                    maxLength={400}
                    placeholder="124 Oba Akran Ave, Ogba, Lagos"
                    value={draft.address}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void findOnMap()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" disabled={finding} onClick={() => void findOnMap()} className="shrink-0">
                    {finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />}
                    {finding ? 'Searching…' : 'Find on map'}
                  </Button>
                </div>
              </div>
              {found && found.length > 0 && (
                <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                  <p className="text-xs font-medium text-muted-foreground">Pick the right place:</p>
                  <ul className="divide-y rounded-lg border">
                    {found.map((p, i) => (
                      <li key={`${p.lat},${p.lng},${i}`}>
                        <button
                          type="button"
                          onClick={() => pick(p)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-orange-950/30"
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                          <span className="min-w-0">
                            <span className="block font-medium">{p.name ?? p.address ?? 'Unnamed place'}</span>
                            {p.name && p.address && <span className="block truncate text-xs text-muted-foreground">{p.address}</span>}
                            <span className="block text-[11px] text-muted-foreground">
                              {p.lat.toFixed(5)}, {p.lng.toFixed(5)} · {p.source === 'osm' ? 'OpenStreetMap' : 'Google Maps'}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setFound(null)}>
                    None of these
                  </button>
                </div>
              )}
              <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                <Label>Or paste a Google Maps link</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://maps.app.goo.gl/… or 6.6019, 3.3516"
                    value={mapLink}
                    onChange={(e) => setMapLink(e.target.value)}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text')
                      if (text) {
                        e.preventDefault()
                        setMapLink(text)
                        void applyMapLink(text)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void applyMapLink()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" disabled={readingLink || !mapLink.trim()} onClick={() => void applyMapLink()} className="shrink-0">
                    {readingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    {readingLink ? 'Reading…' : 'Use link'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  In Google Maps, open the store (or press and hold on it to drop a pin), tap Share and copy the link.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Latitude</Label>
                <Input
                  required
                  inputMode="decimal"
                  value={draft.lat}
                  onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Longitude</Label>
                <Input
                  required
                  inputMode="decimal"
                  value={draft.lng}
                  onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
                />
              </div>
              {pinNote && draft.lat && draft.lng && Number.isFinite(Number(draft.lat)) && Number.isFinite(Number(draft.lng)) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
                  <span>{pinNote}</span>
                  <a
                    href={mapsLink(Number(draft.lat), Number(draft.lng))}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-orange-700 underline dark:text-orange-400"
                  >
                    Check on Google Maps <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              <div className="space-y-1">
                <Label>Geofence radius (m)</Label>
                <Input
                  required
                  type="number"
                  min={25}
                  max={2000}
                  value={draft.geofence_radius_m}
                  onChange={(e) => setDraft({ ...draft, geofence_radius_m: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={locating}
                  onClick={useMyLocation}
                  className="w-full"
                >
                  <Crosshair className={cn('h-4 w-4', locating && 'animate-pulse')} />
                  {locating ? 'Reading…' : 'I am standing here'}
                </Button>
              </div>
              <div className="space-y-1">
                <Label>Clock-in time</Label>
                <Input
                  required
                  type="time"
                  value={draft.shift_start}
                  onChange={(e) => setDraft({ ...draft, shift_start: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Clock-out time</Label>
                <Input
                  required
                  type="time"
                  value={draft.shift_end}
                  onChange={(e) => setDraft({ ...draft, shift_end: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create outlet'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {shown.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {q ? 'No outlets match your search.' : 'No outlets yet.'}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((outlet) => (
          <div key={outlet.id} className={cn('surface flex min-w-0 flex-col gap-3 p-4', !outlet.is_active && 'opacity-70')}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{outlet.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{outlet.address ?? 'No address'}</p>
                </div>
                {!outlet.is_active ? (
                  <Badge variant="outline">Inactive</Badge>
                ) : outlet.lat === null ? (
                  <Badge variant="warning">No location yet</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Fact icon={Radius} label="Area" value={`${outlet.geofence_radius_m} m`} />
                <Fact icon={Clock3} label="Shift" value={`${outlet.shift_start.slice(0, 5)}–${outlet.shift_end.slice(0, 5)}`} />
                <Fact
                  icon={MapPin}
                  label="Location"
                  value={
                    outlet.lat !== null && outlet.lng !== null
                      ? `${outlet.lat.toFixed(5)}, ${outlet.lng.toFixed(5)}`
                      : 'From a clock-in, on Places'
                  }
                />
                <Fact icon={Users} label="Staff" value={String(staffCounts[outlet.id] ?? 0)} />
              </dl>

              {!readOnly && confirmDelete === outlet.id && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2 text-xs">
                  <span className="flex-1 text-foreground">Delete this outlet for good?</span>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove(outlet)}>
                    {busy ? 'Deleting…' : 'Delete'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {!readOnly && confirmDelete !== outlet.id && (
                <div className="mt-auto flex gap-1 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => edit(outlet)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggleActive(outlet)}>
                    {outlet.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    aria-label={`Delete ${outlet.name}`}
                    disabled={busy}
                    onClick={() => {
                      setError(null)
                      setConfirmDelete(outlet.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-muted/50 px-2.5 py-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="truncate font-semibold">{value}</dd>
      </div>
    </div>
  )
}
