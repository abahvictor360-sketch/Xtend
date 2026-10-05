'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crosshair, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Outlet } from '@/lib/types'

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

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

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

  function edit(outlet: Outlet) {
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

      {!readOnly && (
        <Button
          onClick={() => {
            setAdding((a) => !a)
            setEditing(null)
            setDraft(EMPTY)
          }}
          variant={adding ? 'outline' : 'default'}
        >
          <Plus className="h-4 w-4" />
          {adding ? 'Cancel' : 'Add outlet'}
        </Button>
      )}

      {adding && !readOnly && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 lg:col-span-2">
                <Label>Name</Label>
                <Input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Address</Label>
                <Input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
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
                <Label>Shift start</Label>
                <Input
                  required
                  type="time"
                  value={draft.shift_start}
                  onChange={(e) => setDraft({ ...draft, shift_start: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Shift end</Label>
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

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {outlets.map((outlet) => (
          <Card key={outlet.id}>
            <CardContent className="space-y-2 p-4 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{outlet.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{outlet.address ?? '—'}</p>
                </div>
                {!outlet.is_active ? (
                  <Badge variant="outline">Inactive</Badge>
                ) : outlet.lat === null ? (
                  <Badge variant="warning">No location yet</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <div>Geofence: {outlet.geofence_radius_m} m</div>
                <div>
                  Shift: {outlet.shift_start.slice(0, 5)}–{outlet.shift_end.slice(0, 5)}
                </div>
                <div>
                  {outlet.lat !== null && outlet.lng !== null
                    ? `${outlet.lat.toFixed(5)}, ${outlet.lng.toFixed(5)}`
                    : 'Pinned from a clock-in, on Places'}
                </div>
                <div>Staff: {staffCounts[outlet.id] ?? 0}</div>
              </dl>

              {!readOnly && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => edit(outlet)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggleActive(outlet)}>
                    {outlet.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
