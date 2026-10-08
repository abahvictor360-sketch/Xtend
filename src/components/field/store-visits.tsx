'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CheckCircle2, Clock3, LogOut, MapPin, Store } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CameraCapture } from '@/components/field/camera-capture'
import { SectionHeader } from '@/components/field/screen'
import { TaskRow } from '@/components/field/task-row'
import { deviceInfo } from '@/lib/device'
import { GeoBlocked, haversineMetres, requireFix, type Fix } from '@/lib/geo'
import { processSelfie } from '@/lib/image'
import { supabase } from '@/lib/supabase/client'
import { checkPhoto } from '@/lib/offline/sync'
import { formatLagos, metres } from '@/lib/utils'

export interface VisitOutlet {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  geofence_radius_m: number
}

export interface VisitRow {
  id: string
  outlet_name: string
  /** The outlet's name inside its fence; the map's premises name outside. */
  store_label: string | null
  store_label_source: 'outlet' | 'map' | null
  visit_date: string
  status: 'open' | 'closed' | 'abandoned'
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
  departed_status: string | null
  arrived_distance_m: number | null
  arrived_label: string | null
}

/** Older than this and the fix is read again before it is submitted. */
const STALE_FIX_MS = 90_000

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function namePlace(lat: number, lng: number) {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
    if (!res.ok) return { name: null as string | null, address: null as string | null }
    const data = (await res.json()) as { name: string | null; address: string | null }
    return data
  } catch {
    return { name: null as string | null, address: null as string | null }
  }
}

/**
 * The marketer's day: check in at a store, work, check out, move on. One
 * store at a time — the database refuses a second open visit.
 */
export function StoreVisits({
  outlets,
  visits,
  currentFix,
}: {
  outlets: VisitOutlet[]
  visits: VisitRow[]
  currentFix: { lat: number; lng: number } | null
}) {
  const router = useRouter()
  const open = visits.find((v) => v.status === 'open') ?? null
  const done = visits.filter((v) => v.status !== 'open')

  const [picking, setPicking] = useState(false)
  // Set once the location is in hand; that is what opens the camera. The
  // outlet is null when they let Xtend work out which store they are at.
  const [pending, setPending] = useState<{
    outlet: VisitOutlet | null
    fix: Fix
    place: { name: string | null; address: string | null }
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Nearest store first: the one they are standing in should be the easy tap.
  const sorted = useMemo(() => {
    if (!currentFix) return outlets
    return [...outlets].sort(
      (a, b) =>
        haversineMetres(currentFix.lat, currentFix.lng, a.lat, a.lng) -
        haversineMetres(currentFix.lat, currentFix.lng, b.lat, b.lng),
    )
  }, [outlets, currentFix])

  /**
   * Display only. Which store the visit is actually recorded against is
   * decided by the database from the fix taken at the moment of capture,
   * not from this.
   */
  const here = useMemo(() => {
    if (!currentFix) return null
    return (
      sorted.find(
        (outlet) =>
          haversineMetres(currentFix.lat, currentFix.lng, outlet.lat, outlet.lng) <=
          outlet.geofence_radius_m,
      ) ?? null
    )
  }, [sorted, currentFix])

  /**
   * Location first, camera second: there is no point taking a selfie to
   * find out afterwards that the fix was refused, and a location read
   * after the photo is a location read from wherever they were by then.
   */
  const beginCheckIn = useCallback(async (outlet: VisitOutlet | null) => {
    setError(null)
    setNotice(null)
    try {
      setBusy('Getting your location')
      const fix = await requireFix()

      setBusy('Naming the place')
      const place = await namePlace(fix.lat, fix.lng)

      setPending({ outlet, fix, place })
      setPicking(false)
    } catch (err) {
      if (err instanceof GeoBlocked) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setBusy(null)
    }
  }, [])

  const checkIn = useCallback(
    async (photo: Blob) => {
      const started = pending
      setPending(null)
      if (!started) return
      const outlet = started.outlet

      setError(null)
      setNotice(null)
      try {
        let fix = started.fix
        let place = started.place
        if (Date.now() - Date.parse(fix.captured_at) > STALE_FIX_MS) {
          setBusy('Checking your location again')
          fix = await requireFix()
          place = await namePlace(fix.lat, fix.lng)
        }

        setBusy('Compressing your selfie')
        const { full, thumb } = await processSelfie(photo)

        setBusy('Uploading')
        const client = supabase()
        const {
          data: { user },
        } = await client.auth.getUser()
        if (!user) throw new Error('Signed out')

        const id = uuid()
        const selfie_path = `${user.id}/${id}.jpg`
        const thumb_path = `${user.id}/${id}_thumb.jpg`
        const up1 = await client.storage
          .from('selfies')
          .upload(selfie_path, full, { contentType: 'image/jpeg', upsert: true })
        if (up1.error) throw new Error(up1.error.message)
        const up2 = await client.storage
          .from('selfies')
          .upload(thumb_path, thumb, { contentType: 'image/jpeg', upsert: true })
        if (up2.error) throw new Error(up2.error.message)

        setBusy('Checking the photo')
        try {
          await checkPhoto('selfies', selfie_path, thumb_path)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That photo could not be checked.')
          return
        }

        setBusy('Checking in')
        const res = await fetch('/api/visits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Left out when they did not pick one: the database works out
            // which of their stores they are standing in.
            outlet_id: outlet?.id ?? null,
            lat: fix.lat,
            lng: fix.lng,
            accuracy_m: fix.accuracy_m,
            address: place.address,
            place_name: place.name,
            selfie_path,
            thumb_path,
            device_info: { ...deviceInfo(), selfie_source: 'in_app_camera' },
            client_captured_at: fix.captured_at,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'That check-in did not go through.')
          return
        }

        const distance = data.visit?.arrived_distance_m
        const nearest = data.visit?.outlet_name ?? outlet?.name ?? 'your store'
        const label = data.visit?.store_label ?? nearest
        setNotice(
          data.visit?.arrived_status === 'on_site'
            ? `Checked in at ${label}. You were ${metres(distance)} from the door.`
            : data.visit?.arrived_status === 'off_site'
              ? `Checked in, but you are ${metres(distance)} from ${nearest}.`
              : `Checked in at ${label}.`,
        )
        router.refresh()
      } catch (err) {
        if (err instanceof GeoBlocked) setError(err.message)
        else setError(err instanceof Error ? err.message : 'That did not go through.')
      } finally {
        setBusy(null)
      }
    },
    [router, pending],
  )

  const checkOut = useCallback(async () => {
    if (!open) return
    setError(null)
    setNotice(null)
    try {
      setBusy('Checking your location')
      const fix = await requireFix()

      setBusy('Naming the place')
      const place = await namePlace(fix.lat, fix.lng)

      setBusy('Checking out')
      const res = await fetch(`/api/visits/${open.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          address: place.address,
          place_name: place.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That check-out did not go through.')
        return
      }

      setNotice(
        `Checked out of ${open.store_label ?? open.outlet_name} after ${data.visit?.minutes ?? open.minutes} minutes.`,
      )
      router.refresh()
    } catch (err) {
      if (err instanceof GeoBlocked) setError(err.message)
      else setError(err instanceof Error ? err.message : 'That did not go through.')
    } finally {
      setBusy(null)
    }
  }, [open, router])

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Store visits"
        action={
          <span className="text-xs font-semibold text-muted-foreground">
            {done.length} done today
          </span>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {open ? (
        <Card className="border border-brand/30">
          <CardContent className="space-y-3 pt-5">
            <div className="flex items-start gap-3">
              <span className="icon-tile">
                <Store className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-bold">
                  {open.store_label ?? open.outlet_name}
                  <Badge variant={open.arrived_status === 'on_site' ? 'success' : 'destructive'}>
                    {open.arrived_status === 'on_site' ? 'On site' : 'Off site'}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  In store since {formatLagos(open.arrived_at, false)} · {open.minutes} min
                </p>
              </div>
            </div>

            <Button size="xl" className="w-full" disabled={Boolean(busy)} onClick={checkOut}>
              <LogOut className="h-5 w-5" />
              {busy ?? `Check out of ${open.store_label ?? open.outlet_name}`}
            </Button>
          </CardContent>
        </Card>
      ) : picking ? (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold">Which store are you at?</p>
            <p className="text-xs text-muted-foreground">
              Only needed if Xtend did not recognise the shop you are in.
            </p>
            {sorted.map((outlet) => {
              const away = currentFix
                ? haversineMetres(currentFix.lat, currentFix.lng, outlet.lat, outlet.lng)
                : null
              const near = away !== null && away <= outlet.geofence_radius_m
              return (
                <button
                  key={outlet.id}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void beginCheckIn(outlet)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-tint"
                >
                  <span className={`icon-tile ${near ? '' : 'bg-muted text-muted-foreground'}`}>
                    <MapPin className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{outlet.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {away === null ? (outlet.address ?? '') : `${metres(away)} away`}
                    </span>
                  </span>
                  {near && <Badge variant="success">Here</Badge>}
                </button>
              )
            })}
            <Button variant="ghost" className="w-full" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button
            size="xl"
            className="w-full"
            disabled={Boolean(busy)}
            onClick={() => void beginCheckIn(null)}
          >
            <Camera className="h-5 w-5" />
            {busy ?? 'Check in here'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            {here ? `You are at ${here.name}.` : 'Xtend will work out where you are.'}
          </p>

          {outlets.length > 1 && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={Boolean(busy)}
              onClick={() => setPicking(true)}
            >
              Pick the store myself
            </Button>
          )}
        </div>
      )}

      <CameraCapture
        open={pending !== null}
        title={
          pending?.outlet
            ? `Check in at ${pending.outlet.name}`
            : here
              ? `Check in at ${here.name}`
              : 'Check in'
        }
        subtitle={pending?.place.name ?? pending?.place.address ?? null}
        onCapture={(photo) => void checkIn(photo)}
        onClose={() => setPending(null)}
      />

      {done.map((visit) => (
        <TaskRow
          key={visit.id}
          icon={<Store className="h-5 w-5" />}
          title={visit.store_label ?? visit.outlet_name}
          meta={
            <>
              {formatLagos(visit.arrived_at, false)}
              {visit.departed_at && ` – ${formatLagos(visit.departed_at, false)}`} · {visit.minutes}{' '}
              min
              {visit.arrived_distance_m !== null && ` · ${metres(visit.arrived_distance_m)} from door`}
            </>
          }
          trailing={
            visit.status === 'abandoned' ? (
              <Clock3 className="h-5 w-5 text-warning" />
            ) : visit.arrived_status === 'on_site' ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <Clock3 className="h-5 w-5 text-destructive" />
            )
          }
        />
      ))}
    </section>
  )
}
